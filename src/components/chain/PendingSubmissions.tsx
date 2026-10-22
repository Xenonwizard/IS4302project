"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2, PackageSearch, RefreshCw, Warehouse } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePublicClient } from "wagmi";
import { getListing } from "@/lib/catalog";
import { DEPLOY_BLOCK, chain, contracts } from "@/lib/chain/config";
import { useOnchainAccount } from "@/lib/chain/useOnchainAccount";
import { useSlabChain, type MintOutcome } from "@/lib/chain/useSlabChain";
import { useStore } from "@/lib/store";
import type { Grader, Listing } from "@/lib/types";
import { Button } from "../ui/primitives";
import { CopyText } from "./ChainConsole";
import { Fn, OnChainNote } from "./ui";

interface Pending {
  submissionId: string;
  grader: Grader;
  certNumber: string;
}

/**
 * Submissions waiting on Grade10, read from the chain: every SubmissionRequested event for this
 * wallet whose `submissionOf(id).status` is still Pending. While one is shown, the page polls
 * Grade10's registry. As soon as Grade10 has the slab (after the Postman intake call, or the
 * Simulate button) the operator verifies it on Solana and mints the Polygon token.
 */
export function PendingSubmissions({ onMinted }: { onMinted?: (listing: Listing | null) => void }) {
  const { address } = useOnchainAccount();
  const client = usePublicClient();

  const { data: pending = [], refetch } = useQuery({
    queryKey: ["pending-submissions", address],
    enabled: Boolean(address && client),
    refetchInterval: 15_000,
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
        .filter(({ s }) => s.status === 1)
        .map(({ e, s }) => ({ submissionId: e.args.submissionId!.toString(), grader: s.grader as Grader, certNumber: s.certNumber }));
    },
  });

  if (!pending.length) return null;
  return (
    <div className="space-y-3">
      {pending.map((p) => (
        <PendingCard key={p.submissionId} sub={p} onDone={(l) => { void refetch(); onMinted?.(l); }} />
      ))}
    </div>
  );
}

function PendingCard({ sub, onDone }: { sub: Pending; onDone: (listing: Listing | null) => void }) {
  const { verifyAndMint, simulateIntake } = useSlabChain();
  const { vault, submitSlab, attachToken, pushToast } = useStore();
  const [state, setState] = useState<"waiting" | "intake" | "minting">("waiting");
  const inFlight = useRef(false);
  // Only rendered after the client-side chain query resolves, so window is always there.
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  // If the slab is already in the vault off-chain (tokenising before a withdrawal), attach the token to it.
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
      };
      let listing: Listing | null = null;
      if (existingId) attachToken(existingId, token);
      else listing = submitSlab({ grader: sub.grader, certNumber: sub.certNumber }, token);
      pushToast({ title: `Token #${out.tokenId} minted`, body: "Grade10 custody verified on Solana.", tone: "success" });
      onDone(listing);
    },
    [existingId, attachToken, submitSlab, pushToast, onDone, sub.grader, sub.certNumber],
  );

  const mint = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setState("minting");
    try {
      const out = await verifyAndMint(sub.submissionId, existingId);
      if (out.result === "minted") finish(out);
      else if (out.result === "rejected") {
        pushToast({ title: "Submission rejected", body: out.reason, tone: "error" });
        onDone(null);
      } else if (out.result === "mismatch") {
        pushToast({ title: "Grade10's Solana record doesn't match", body: out.checks.at(-1)?.detail, tone: "error" });
      }
    } catch (e) {
      pushToast({ title: "Verification failed", body: (e as Error).message, tone: "error" });
    } finally {
      inFlight.current = false;
      setState("waiting");
    }
  }, [verifyAndMint, sub.submissionId, existingId, finish, pushToast, onDone]);

  // Poll Grade10's registry (a plain GET, not logged). Once the slab is there, run the operator check + mint.
  useEffect(() => {
    const timer = window.setInterval(async () => {
      if (inFlight.current || document.hidden) return;
      const res = await fetch(`/api/grade10/certs/${sub.grader}/${sub.certNumber}`, { cache: "no-store" });
      if (res.ok) void mint();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [sub.grader, sub.certNumber, mint]);

  const intake = async () => {
    setState("intake");
    try {
      await simulateIntake(sub.grader, sub.certNumber);
      await mint();
    } catch (e) {
      pushToast({ title: "Intake failed", body: (e as Error).message, tone: "error" });
      setState("waiting");
    }
  };

  const curl = `curl -X POST ${origin}/api/grade10/intake -H 'content-type: application/json' -d '{"grader":"${sub.grader}","certNumber":"${sub.certNumber}"}'`;

  return (
    <div className="rounded-card border border-warn/30 bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-[14px] font-bold">
            {state === "minting" ? <Loader2 size={15} className="animate-spin text-accent" /> : <PackageSearch size={15} className="text-warn" />}
            {state === "minting" ? "Checking Grade10 on Solana and minting…" : "Waiting for Grade10 to receive the slab"}
          </p>
          <p className="mt-1 text-[12.5px] text-muted">
            Submission #{sub.submissionId} · {sub.grader} cert <span className="font-mono text-white">{sub.certNumber}</span> · Pending on-chain
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={mint} disabled={state !== "waiting"}>
            <RefreshCw size={13} /> Check now
          </Button>
          <Button size="sm" onClick={intake} disabled={state !== "waiting"}>
            <Warehouse size={13} /> Simulate Grade10 intake
          </Button>
        </div>
      </div>
      <div className="mt-3 rounded-xl bg-[#101014] p-3 text-[12px] text-muted">
        <p className="mb-1.5 font-semibold text-white">Or play Grade10 from Postman (or a terminal):</p>
        <div className="flex items-start gap-2">
          <code className="min-w-0 flex-1 break-all font-mono text-[11px] text-dim">{curl}</code>
          <CopyText text={curl} title="Copy the curl command" />
        </div>
        <p className="mt-1.5 text-[11px] text-dim">This page polls Grade10 every few seconds and mints as soon as the slab shows up.</p>
      </div>
      <div className="mt-3">
        <OnChainNote title="Why it waits">
          <Fn>SlabVault.requestSubmission</Fn> only records your claim. Before <Fn>mintSlab</Fn>, the
          operator asks Grade10&apos;s registry for the slab&apos;s Solana asset id. It then calls Solana
          <Fn>getAsset</Fn> to check that the NFT is owned and frozen by Grade10&apos;s vault wallet, sits in
          Grade10&apos;s collection, and carries the same cert number. The Polygon token stores that Solana id,
          so each chain points at the other.
        </OnChainNote>
      </div>
    </div>
  );
}
