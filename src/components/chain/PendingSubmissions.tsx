"use client";

import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import Link from "next/link";
import { AlertTriangle, Check, Flag, Loader2, PackageSearch, RefreshCw, Truck, Vault, Warehouse } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePublicClient } from "wagmi";
import { getListing } from "@/lib/catalog";
import { CUSTODY, DEPLOY_BLOCK, OPEN_SUBMISSION, chain, contracts, type CustodyName } from "@/lib/chain/config";
import { useOnchainAccount } from "@/lib/chain/useOnchainAccount";
import { useSlabChain, type MintOutcome } from "@/lib/chain/useSlabChain";
import { useStore } from "@/lib/store";
import type { Grader, Listing } from "@/lib/types";
import { Button } from "../ui/primitives";
import { CopyText } from "./ChainConsole";
import { usd } from "@/lib/format";
import { EvidencePanel } from "./EvidencePanel";
import { Fn, OnChainNote } from "./ui";

interface Pending {
  submissionId: string;
  grader: Grader;
  certNumber: string;
  /** SubmissionStatus: 1 Pending, 2 ReceivedByPokechain, 3 AtCustodian */
  status: number;
  /** the NFT's custody: Posted to Pokechain, At Pokechain, Sent to Collector Crypt, or Lost */
  custody: CustodyName;
  /** keccak256(salt ‖ parcel details); the details themselves are only on-chain encrypted */
  forwardCommitment: string;
  declaredValueCents: number;
  evidenceHash: string;
  inboundCarrier: string;
  inboundTracking: string;
}

/**
 * Slabs still on their way into the vault, read from the chain: every SubmissionRequested event for
 * this wallet whose `submissionOf(id).status` is still open. The NFT already exists (minted, locked,
 * at submission), so each card shows the token, where the parcel is (you → Pokechain → Collector
 * Crypt → vaulted), the call that moves it on, and a lost report while it is in the post.
 */
export function PendingSubmissions({ onMinted }: { onMinted?: (listing: Listing | null) => void }) {
  const { address } = useOnchainAccount();
  const client = usePublicClient();

  const { data: pending = [], refetch } = useQuery({
    queryKey: ["pending-submissions", address],
    enabled: Boolean(address && client),
    refetchInterval: 10_000,
    queryFn: async (): Promise<Pending[]> => {
      const events = await client!.getContractEvents({
        ...contracts.slabVault,
        eventName: "SubmissionRequested",
        args: { owner: address },
        fromBlock: DEPLOY_BLOCK,
      });
      const [subs, slabs] = await Promise.all([
        Promise.all(events.map((e) => client!.readContract({ ...contracts.slabVault, functionName: "submissionOf", args: [e.args.submissionId!] }))),
        Promise.all(events.map((e) => client!.readContract({ ...contracts.slabVault, functionName: "slabOf", args: [e.args.submissionId!] }))),
      ]);
      return events
        .map((e, i) => ({ e, s: subs[i], custody: CUSTODY[slabs[i].custody] }))
        .filter(({ s }) => OPEN_SUBMISSION.has(s.status))
        .map(({ e, s, custody }) => ({
          submissionId: e.args.submissionId!.toString(),
          grader: s.grader as Grader,
          certNumber: s.certNumber,
          status: s.status,
          custody,
          forwardCommitment: s.forwardCommitment,
          declaredValueCents: Number(s.declaredValueCents),
          evidenceHash: s.evidenceHash,
          inboundCarrier: s.inboundCarrier,
          inboundTracking: s.inboundTracking,
        }));
    },
  });

  if (!pending.length) return null;
  return (
    <div className="space-y-3">
      {pending.map((p) => (
        <PendingCard
          key={p.submissionId}
          sub={p}
          onChange={() => void refetch()}
          onDone={(l) => {
            void refetch();
            onMinted?.(l);
          }}
        />
      ))}
    </div>
  );
}

const STAGES = ["NFT minted, in the post", "At Pokechain", "Sent to Collector Crypt", "Vaulted: tradeable"];
/** The parcel is with a carrier: on its way to Pokechain, or from Pokechain to Collector Crypt. */
const IN_POST = new Set<CustodyName>(["Posted to Pokechain", "Sent to Collector Crypt"]);

function PendingCard({ sub, onChange, onDone }: { sub: Pending; onChange: () => void; onDone: (listing: Listing | null) => void }) {
  const { receive, forward, simulateVault, verifyAndMint, reportLost, resolveLost } = useSlabChain();
  const [reporting, setReporting] = useState(false);
  const lost = sub.custody === "Lost";
  const { vault, submitSlab, attachToken, pushToast } = useStore();
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  // Only rendered after the client-side chain query resolves, so window is always there.
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const id = sub.submissionId;

  // A slab already in the vault off-chain (tokenising before a withdrawal) gets the token attached.
  const existingId = vault.find((v) => {
    const l = getListing(v.listingId);
    return l?.grader === sub.grader && l.certNumber === sub.certNumber;
  })?.listingId;

  const finish = useCallback(
    (out: Extract<MintOutcome, { result: "minted" }>) => {
      const token = {
        chainId: chain.id,
        contract: contracts.slabVault.address,
        tokenId: out.tokenId,
        owner: out.owner,
        mintTx: out.tx.hash,
        custodianRef: out.custodianRef,
        declaredValueCents: sub.declaredValueCents,
        evidenceHash: sub.evidenceHash,
      };
      let listing: Listing | null = null;
      if (existingId) attachToken(existingId, token);
      else listing = submitSlab({ grader: sub.grader, certNumber: sub.certNumber }, token);
      pushToast({ title: `Token #${out.tokenId} vaulted`, body: "Collector Crypt's NFT is in Pokechain's escrow. It's in your Vault and can be traded.", tone: "success" });
      onDone(listing);
    },
    [existingId, attachToken, submitSlab, pushToast, onDone, sub.grader, sub.certNumber, sub.declaredValueCents, sub.evidenceHash],
  );

  const mint = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const out = await verifyAndMint(id, existingId);
      if (out.result === "minted") finish(out);
      else if (out.result === "mismatch") {
        pushToast({ title: "Collector Crypt's Solana record doesn't match", body: out.checks.at(-1)?.detail, tone: "error" });
      }
    } catch (e) {
      pushToast({ title: "Verification failed", body: (e as Error).message, tone: "error" });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [verifyAndMint, id, existingId, finish, pushToast]);

  // At Collector Crypt: poll CC's card lookup (a plain GET, not logged) and mint once it's vaulted.
  useEffect(() => {
    if (sub.status !== 3 || lost) return;
    const timer = window.setInterval(async () => {
      if (inFlight.current || document.hidden) return;
      const res = await fetch(`/api/collector-crypt/cards/${sub.grader}/${sub.certNumber}`, { cache: "no-store" });
      if (res.ok && ((await res.json()) as { found: boolean }).found) void mint();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [sub.status, lost, sub.grader, sub.certNumber, mint]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      onChange();
    } catch (e) {
      pushToast({ title: "Step failed", body: (e as Error).message, tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const next = lost
    ? {
        label: "Simulate: parcel turns up at Pokechain",
        icon: <Warehouse size={13} />,
        action: () => run(() => resolveLost(id, "at-pokechain")),
        tech: <><Fn>SlabVault.reportLost({id})</Fn>; found: <Fn>SlabVault.resolveLostReport({id}, AtPokechain)</Fn>.</>,
        curl: `curl -X POST ${origin}/api/chain/resolve-lost -H 'content-type: application/json' -d '{"tokenId":"${id}","outcome":"at-pokechain"}'`,
        note: (
          <>
            You reported this parcel lost, so its token is marked <b className="text-white">Lost</b> and anyone can see
            when, and with which tracking number. If the carrier finds it, Pokechain marks it as arrived and the steps
            carry on from its warehouse.
          </>
        ),
      }
    : sub.status === 1
      ? {
          label: "Simulate: Pokechain receives it",
          icon: <Warehouse size={13} />,
          action: () =>
            run(async () => {
              const r = await receive(id);
              if (r.result === "rejected") {
                pushToast({ title: "Submission rejected", body: r.reason, tone: "error" });
                onDone(null);
              }
            }),
          tech: <><Fn>SlabVault.markReceived({id})</Fn> (or <Fn>rejectSubmission</Fn>), after checking the stored evidence still hashes to <Fn>evidenceHash</Fn>.</>,
          curl: `curl -X POST ${origin}/api/chain/receive -H 'content-type: application/json' -d '{"submissionId":"${id}"}'`,
          note: (
            <>
              Ship the slab to Pokechain. When it arrives, staff compare it with your photos and check they still match
              the fingerprint on the chain. Then they mark it received, or reject it if the cert or photos don&apos;t
              check out.
            </>
          ),
        }
      : sub.status === 2
        ? {
            label: "Simulate: forward to Collector Crypt",
            icon: <Truck size={13} />,
            action: () => run(() => forward(id)),
            tech: <><Fn>SlabVault.markForwarded({id}, ciphertext, commitment)</Fn>, encrypted to the key in <Fn>SlabVault.encryptionKey(custodian)</Fn>.</>,
            curl: `curl -X POST ${origin}/api/chain/forward -H 'content-type: application/json' -d '{"submissionId":"${id}"}'`,
            note: (
              <>
                Pokechain ships it on to Collector Crypt. The carrier and tracking number are recorded on the chain in a
                locked form: everyone can see the parcel was sent, but only Collector Crypt can read the details.
              </>
            ),
          }
        : {
            label: "Simulate: Collector Crypt vaults it",
            icon: <Vault size={13} />,
            action: () =>
              run(async () => {
                await simulateVault(sub.grader, sub.certNumber, id);
                await mint();
              }),
            tech: <>Solana <Fn>getAsset</Fn> (held by Pokechain&apos;s escrow, in CC&apos;s collection, same cert, Vaulted), then <Fn>SlabVault.confirmVaulted({id})</Fn>.</>,
            curl: `curl -X POST ${origin}/api/collector-crypt/intake -H 'content-type: application/json' -d '{"grader":"${sub.grader}","certNumber":"${sub.certNumber}","depositorRef":"pokechain-submission-${id}"}'`,
            note: (
              <>
                When Collector Crypt vaults it, it creates its own record of the slab (a Solana NFT) and gives it to
                Pokechain to hold. Pokechain checks that record matches your slab, then unlocks your token, and you can
                trade it.
              </>
            ),
          };

  return (
    <div className={clsx("rounded-card border bg-surface p-4", lost ? "border-bad/60 ring-1 ring-bad/40" : "border-warn/30")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-[14px] font-bold">
            {busy ? (
              <Loader2 size={15} className="animate-spin text-accent" />
            ) : lost ? (
              <AlertTriangle size={15} className="text-bad" />
            ) : (
              <PackageSearch size={15} className="text-warn" />
            )}
            NFT #{id}: {lost ? "reported lost in the post" : sub.custody}
            <span className={clsx("rounded-md px-1.5 py-0.5 text-[10.5px] font-bold", lost ? "bg-bad/15 text-bad" : "bg-surface-2 text-dim")}>
              {lost ? "Lost" : "Locked until vaulted"}
            </span>
          </p>
          <p className="mt-1 text-[12.5px] text-muted">
            {sub.grader} cert <span className="font-mono text-white">{sub.certNumber}</span> · declared{" "}
            {usd(sub.declaredValueCents / 100)}
            {sub.inboundTracking ? ` · to Pokechain by ${sub.inboundCarrier} ${sub.inboundTracking}` : ""}
            {/^0x0*$/.test(sub.forwardCommitment) ? "" : " · parcel details sent to Collector Crypt, encrypted"}
          </p>
        </div>
        <div className="flex gap-2">
          {IN_POST.has(sub.custody) ? (
            <Button size="sm" variant="secondary" onClick={() => setReporting((r) => !r)} disabled={busy}>
              <Flag size={13} /> Report lost
            </Button>
          ) : null}
          {sub.status === 3 && !lost ? (
            <Button size="sm" variant="secondary" onClick={mint} disabled={busy}>
              <RefreshCw size={13} /> Check now
            </Button>
          ) : null}
          <Button size="sm" onClick={next.action} disabled={busy}>
            {next.icon} {next.label}
          </Button>
        </div>
      </div>

      {reporting && IN_POST.has(sub.custody) ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-bad/40 bg-bad/10 p-3 text-[12.5px]">
          <span className="min-w-0 flex-1 text-white">
            Report NFT #{id} lost{sub.custody === "Posted to Pokechain" && sub.inboundTracking ? ` (${sub.inboundCarrier} ${sub.inboundTracking})` : ""}? This calls{" "}
            <Fn>SlabVault.reportLost</Fn> from your wallet. The token is kept as the record.
          </span>
          <Button
            size="sm"
            variant="danger"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await reportLost(id, sub.custody === "Posted to Pokechain" ? "Lost on the way to Pokechain" : "Lost on the way to Collector Crypt");
                setReporting(false);
              })
            }
          >
            Report lost on-chain
          </Button>
        </div>
      ) : null}

      <ol className="mt-3 flex flex-wrap gap-1.5 text-[11px] font-semibold">
        {STAGES.map((name, i) => {
          // status 1 Pending (in the post) .. 3 AtCustodian; stage i is where the slab is when status = i + 1
          const here = sub.status - 1;
          const done = i < here;
          return (
            <li
              key={name}
              className={clsx(
                "flex items-center gap-1 rounded-md px-2 py-1",
                done ? "bg-good-bg text-good" : i === here ? (lost ? "bg-bad/15 text-bad" : "bg-warn/15 text-warn") : "bg-surface-2 text-dim",
              )}
            >
              {done ? <Check size={11} /> : null}
              {name}
              {lost && i === here ? " · lost" : ""}
            </li>
          );
        })}
      </ol>

      <div className="mt-3 rounded-xl bg-[#101014] p-3">
        <p className="mb-2 text-[12px] font-semibold text-white">Intake evidence</p>
        <EvidencePanel hash={sub.evidenceHash} compact />
      </div>

      <div className="mt-3 rounded-xl bg-[#101014] p-3 text-[12px] text-muted">
        <p className="mb-1.5 font-semibold text-white">Or run this step from Postman (or a terminal):</p>
        <div className="flex items-start gap-2">
          <code className="min-w-0 flex-1 break-all font-mono text-[11px] text-dim">{next.curl}</code>
          <CopyText text={next.curl} title="Copy the curl command" label="Copy" />
        </div>
        {sub.status === 3 && !lost ? (
          <p className="mt-1.5 text-[11px] text-dim">
            This page polls Collector Crypt every few seconds and mints once the slab is vaulted.{" "}
            <Link href="/collector-crypt" className="font-semibold text-accent hover:underline">
              See what Collector Crypt received →
            </Link>
          </p>
        ) : null}
      </div>
      <div className="mt-3">
        <OnChainNote title="This step" tech={next.tech}>{next.note}</OnChainNote>
      </div>
    </div>
  );
}
