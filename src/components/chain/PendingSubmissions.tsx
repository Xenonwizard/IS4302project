"use client";

import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import Link from "next/link";
import { Check, Loader2, PackageSearch, RefreshCw, Truck, Vault, Warehouse } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePublicClient } from "wagmi";
import { getListing } from "@/lib/catalog";
import { DEPLOY_BLOCK, OPEN_SUBMISSION, SUBMISSION_STATUS, chain, contracts } from "@/lib/chain/config";
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
  /** keccak256(salt ‖ parcel details); the details themselves are only on-chain encrypted */
  forwardCommitment: string;
  declaredValueCents: number;
  evidenceHash: string;
  inboundCarrier: string;
  inboundTracking: string;
}

/**
 * Submissions still on their way into the vault, read from the chain: every SubmissionRequested
 * event for this wallet whose `submissionOf(id).status` is still open. Each card shows where the
 * slab is (you → Pokechain → Collector Crypt → token) and the call that moves it on.
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
      const subs = await Promise.all(
        events.map((e) => client!.readContract({ ...contracts.slabVault, functionName: "submissionOf", args: [e.args.submissionId!] })),
      );
      return events
        .map((e, i) => ({ e, s: subs[i] }))
        .filter(({ s }) => OPEN_SUBMISSION.has(s.status))
        .map(({ e, s }) => ({
          submissionId: e.args.submissionId!.toString(),
          grader: s.grader as Grader,
          certNumber: s.certNumber,
          status: s.status,
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

const STAGES = ["Submitted", "At Pokechain", "Sent to Collector Crypt", "Vaulted at CC", "Token minted"];

function PendingCard({ sub, onChange, onDone }: { sub: Pending; onChange: () => void; onDone: (listing: Listing | null) => void }) {
  const { receive, forward, simulateVault, verifyAndMint } = useSlabChain();
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
      pushToast({ title: `Token #${out.tokenId} minted`, body: "Collector Crypt's NFT is in Pokechain's escrow.", tone: "success" });
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
    if (sub.status !== 3) return;
    const timer = window.setInterval(async () => {
      if (inFlight.current || document.hidden) return;
      const res = await fetch(`/api/collector-crypt/cards/${sub.grader}/${sub.certNumber}`, { cache: "no-store" });
      if (res.ok && ((await res.json()) as { found: boolean }).found) void mint();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [sub.status, sub.grader, sub.certNumber, mint]);

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

  const next =
    sub.status === 1
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
          curl: `curl -X POST ${origin}/api/chain/receive -H 'content-type: application/json' -d '{"submissionId":"${id}"}'`,
          note: (
            <>
              Ship the slab to Pokechain. When it arrives, staff compare it with your photos, and the server checks the
              stored evidence still hashes to the <Fn>evidenceHash</Fn> on-chain. Then the operator calls{" "}
              <Fn>SlabVault.markReceived({id})</Fn>, or <Fn>rejectSubmission</Fn> if the cert or evidence doesn&apos;t
              check out.
            </>
          ),
        }
      : sub.status === 2
        ? {
            label: "Simulate: forward to Collector Crypt",
            icon: <Truck size={13} />,
            action: () => run(() => forward(id)),
            curl: `curl -X POST ${origin}/api/chain/forward -H 'content-type: application/json' -d '{"submissionId":"${id}"}'`,
            note: (
              <>
                Pokechain ships it on to Collector Crypt. The parcel details (carrier, tracking number) are encrypted to
                Collector Crypt&apos;s public key, read from <Fn>SlabVault.encryptionKey(custodian)</Fn>. Only the
                ciphertext and a salted commitment go on-chain in <Fn>SlabVault.markForwarded({id}, ciphertext, commitment)</Fn>.
                Everyone sees that it happened; only Collector Crypt can read the details.
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
            curl: `curl -X POST ${origin}/api/collector-crypt/intake -H 'content-type: application/json' -d '{"grader":"${sub.grader}","certNumber":"${sub.certNumber}","depositorRef":"pokechain-submission-${id}"}'`,
            note: (
              <>
                When Collector Crypt vaults it, CC mints the slab&apos;s Solana NFT straight to Pokechain&apos;s escrow
                wallet. This page polls CC; then the operator calls Solana <Fn>getAsset</Fn>. It checks the NFT is
                held by our escrow, sits in CC&apos;s collection, has the same cert and is Vaulted, and then runs{" "}
                <Fn>SlabVault.mintSlab</Fn> with CC&apos;s asset id.
              </>
            ),
          };

  return (
    <div className="rounded-card border border-warn/30 bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-[14px] font-bold">
            {busy ? <Loader2 size={15} className="animate-spin text-accent" /> : <PackageSearch size={15} className="text-warn" />}
            Submission #{id}: {SUBMISSION_STATUS[sub.status]}
          </p>
          <p className="mt-1 text-[12.5px] text-muted">
            {sub.grader} cert <span className="font-mono text-white">{sub.certNumber}</span> · declared{" "}
            {usd(sub.declaredValueCents / 100)}
            {sub.inboundTracking ? ` · to Pokechain by ${sub.inboundCarrier} ${sub.inboundTracking}` : ""}
            {/^0x0*$/.test(sub.forwardCommitment) ? "" : " · parcel details sent to Collector Crypt, encrypted"}
          </p>
        </div>
        <div className="flex gap-2">
          {sub.status === 3 ? (
            <Button size="sm" variant="secondary" onClick={mint} disabled={busy}>
              <RefreshCw size={13} /> Check now
            </Button>
          ) : null}
          <Button size="sm" onClick={next.action} disabled={busy}>
            {next.icon} {next.label}
          </Button>
        </div>
      </div>

      <ol className="mt-3 flex flex-wrap gap-1.5 text-[11px] font-semibold">
        {STAGES.map((name, i) => {
          const done = i < sub.status;
          return (
            <li
              key={name}
              className={clsx(
                "flex items-center gap-1 rounded-md px-2 py-1",
                done ? "bg-good-bg text-good" : i === sub.status ? "bg-warn/15 text-warn" : "bg-surface-2 text-dim",
              )}
            >
              {done ? <Check size={11} /> : null}
              {name}
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
        {sub.status === 3 ? (
          <p className="mt-1.5 text-[11px] text-dim">
            This page polls Collector Crypt every few seconds and mints once the slab is vaulted.{" "}
            <Link href="/collector-crypt" className="font-semibold text-accent hover:underline">
              See what Collector Crypt received →
            </Link>
          </p>
        ) : null}
      </div>
      <div className="mt-3">
        <OnChainNote title="This step">{next.note}</OnChainNote>
      </div>
    </div>
  );
}
