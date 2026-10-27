"use client";

import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import Link from "next/link";
import { Check, Loader2, PackageSearch, XCircle } from "lucide-react";
import { usePublicClient } from "wagmi";
import { DEPLOY_BLOCK, OPEN_SUBMISSION, contracts } from "@/lib/chain/config";
import { useOnchainAccount } from "@/lib/chain/useOnchainAccount";
import { Button } from "../ui/primitives";

/** How long a finished request (vaulted or rejected) stays on the page, so its last step can be seen. */
const RECENT_SECONDS = 15 * 60;

const STEPS = ["Requested", "Received at Pokechain", "With Collector Crypt", "Vaulted"] as const;
/** What the request is waiting on, by SubmissionStatus (1 Pending … 5 Rejected). */
const STAGE: Record<number, string> = {
  1: "Awaiting receipt at Pokechain",
  2: "Received at Pokechain",
  3: "With Collector Crypt",
  4: "Vaulted",
  5: "Rejected",
};

interface Tracked {
  submissionId: string;
  grader: string;
  certNumber: string;
  /** SubmissionStatus: 1 Pending, 2 ReceivedByPokechain, 3 AtCustodian, 4 Vaulted, 5 Rejected */
  status: number;
  tokenId: string;
  rejectReason?: string;
}

/**
 * Customer-facing tracker for the collector's slab requests, read from the chain. It has no controls:
 * Pokechain and Collector Crypt move a request on from /intake (or the same calls with curl), and this
 * refreshes the moment SlabVault records the step, so a second tab can watch it happen.
 */
export function PendingSubmissions() {
  const { address } = useOnchainAccount();
  const client = usePublicClient();
  const enabled = Boolean(address && client);


  const { data: tracked = [] } = useQuery({
    queryKey: ["pending-submissions", address],
    enabled,
    queryFn: async (): Promise<Tracked[]> => {
      const [requested, rejected, block] = await Promise.all([
        client!.getContractEvents({ ...contracts.slabVault, eventName: "SubmissionRequested", args: { owner: address }, fromBlock: DEPLOY_BLOCK }),
        client!.getContractEvents({ ...contracts.slabVault, eventName: "SubmissionRejected", args: { owner: address }, fromBlock: DEPLOY_BLOCK }),
        client!.getBlock(),
      ]);
      const ids = [...new Set(requested.map((e) => e.args.submissionId!))];
      const subs = await Promise.all(ids.map((id) => client!.readContract({ ...contracts.slabVault, functionName: "submissionOf", args: [id] })));
      const reasons = new Map(rejected.map((e) => [e.args.submissionId!.toString(), e.args.reason ?? ""]));
      const now = Number(block.timestamp);
      return ids
        .map((id, i) => ({ id, s: subs[i] }))
        // In flight, or finished in the last few minutes so the last step stays visible.
        .filter(({ s }) => OPEN_SUBMISSION.has(s.status) || ((s.status === 4 || s.status === 5) && now - Number(s.updatedAt) < RECENT_SECONDS))
        .sort((a, b) => Number(b.s.requestedAt) - Number(a.s.requestedAt))
        .map(({ id, s }) => ({
          submissionId: id.toString(),
          grader: s.grader,
          certNumber: s.certNumber,
          status: s.status,
          tokenId: s.tokenId.toString(),
          rejectReason: reasons.get(id.toString()),
        }));
    },
  });

  if (!tracked.length) return null;
  return (
    <section className="rounded-card border border-warn/30 bg-surface p-4" data-testid="submission-tracker">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-[14px] font-bold">
            <PackageSearch size={15} className="text-warn" /> Your slab requests
          </p>
          <p className="mt-1 text-[12.5px] text-muted">
            Pokechain receives your slab (its NFT is minted then), sends it to Collector Crypt, and Collector Crypt vaults
            it. This page updates by itself at each step.
          </p>
        </div>
        <Link href="/intake">
          <Button size="sm" variant="secondary">Open intake status</Button>
        </Link>
      </div>
      <ul className="mt-3 space-y-3">
        {tracked.map((t) => (
          <Request key={t.submissionId} t={t} />
        ))}
      </ul>
    </section>
  );
}

function Request({ t }: { t: Tracked }) {
  const rejected = t.status === 5;
  const vaulted = t.status === 4;
  // Steps done: 1 once requested, 2 once received, 3 once forwarded, 4 once vaulted.
  const done = rejected ? 0 : t.status;
  return (
    <li
      className={clsx("rounded-xl border p-3", rejected ? "border-bad/50 bg-bad/5" : vaulted ? "border-good/40 bg-good-bg" : "border-hairline bg-[#101014]")}
      data-testid={`request-${t.certNumber}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
        <span>
          <b className="text-white">
            {t.grader} cert {t.certNumber}
          </b>
          <span className="text-dim"> · request #{t.submissionId}</span>
          {t.tokenId !== "0" ? <span className="text-muted"> · NFT #{t.tokenId}</span> : null}
        </span>
        <span className={clsx("text-[12px] font-bold", rejected ? "text-bad" : vaulted ? "text-good" : "text-warn")} data-testid="request-stage">
          {STAGE[t.status]}
        </span>
      </div>
      {rejected ? (
        <p className="mt-2 flex items-start gap-1.5 text-[12px] text-bad">
          <XCircle size={13} className="mt-0.5 shrink-0" /> {t.rejectReason || "Pokechain could not accept this slab."}
        </p>
      ) : (
        <ol className="mt-2.5 flex flex-wrap gap-1.5 text-[11px] font-semibold">
          {STEPS.map((name, i) => {
            const complete = i < done;
            const current = i === done && !vaulted;
            return (
              <li
                key={name}
                className={clsx(
                  "flex items-center gap-1 rounded-md px-2 py-1",
                  complete ? "bg-good-bg text-good" : current ? "bg-warn/15 text-warn" : "bg-surface-2 text-dim",
                )}
              >
                {complete ? <Check size={11} /> : current ? <Loader2 size={11} className="animate-spin" /> : null}
                {i === 1 && t.tokenId !== "0" ? `${name} · NFT #${t.tokenId}` : name}
              </li>
            );
          })}
        </ol>
      )}
      <p className="mt-2 text-[11.5px] text-muted">
        {rejected ? (
          "The request is closed; you can submit the slab again."
        ) : t.status === 1 ? (
          "Waiting for Pokechain to receive the slab. No NFT exists until it arrives."
        ) : t.status === 2 ? (
          `NFT #${t.tokenId} is minted to you and locked while the slab is handled. Your Vault shows it as Awaiting vaulting.`
        ) : t.status === 3 ? (
          `Collector Crypt has the slab. NFT #${t.tokenId} stays locked until they vault it.`
        ) : (
          <>
            Vaulted: NFT #{t.tokenId} is unlocked and ready to list or trade.{" "}
            <Link href="/vault" className="font-semibold text-accent hover:underline">
              See it in your Vault
            </Link>
          </>
        )}
      </p>
    </li>
  );
}
