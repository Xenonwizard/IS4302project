"use client";

import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import Link from "next/link";
import { CheckCircle2, Route, XCircle } from "lucide-react";
import { usePublicClient, useReadContracts } from "wagmi";
import { CUSTODY, contracts, shortHash } from "@/lib/chain/config";
import type { Manifest } from "@/lib/evidence/store";
import { usd } from "@/lib/format";
import { CopyText } from "./ChainConsole";
import { EvidencePanel } from "./EvidencePanel";

interface Attr {
  trait_type: string;
  value: string | number;
}

/** tokenURI is `data:application/json;base64,…`: decode it the way a wallet or marketplace would. */
function decodeTokenUri(uri: string): { name: string; image: string; attributes: Attr[] } | null {
  const b64 = uri.split(",")[1];
  if (!b64) return null;
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

const inbound = (carrier: string, tracking: string) => (tracking ? `${carrier} ${tracking}` : carrier || "—");

/**
 * Everything the owner entered in the intake form, side by side with what the chain recorded for
 * this token: SlabVault.slabOf / submissionOf, and the NFT's own tokenURI metadata. "You entered"
 * comes from the stored evidence manifest, which is only trusted if it still hashes to the
 * evidenceHash on-chain.
 */
export function TokenRecord({ tokenId }: { tokenId: string }) {
  const client = usePublicClient();
  const id = BigInt(tokenId);
  const { data: reads } = useReadContracts({
    contracts: [
      { ...contracts.slabVault, functionName: "slabOf", args: [id] },
      { ...contracts.slabVault, functionName: "ownerOf", args: [id] },
      { ...contracts.slabVault, functionName: "tokenURI", args: [id] },
    ],
  });
  const slab = reads?.[0]?.result;
  const owner = reads?.[1]?.result;
  const meta = reads?.[2]?.result ? decodeTokenUri(reads[2].result) : null;

  // The receipt event minted this token; use its immutable link back to the cert-number request.
  const { data: submissionId } = useQuery({
    queryKey: ["token-submission", tokenId],
    enabled: Boolean(client),
    queryFn: () => client!.readContract({ ...contracts.slabVault, functionName: "submissionOfToken", args: [id] }),
  });
  const { data: submission } = useQuery({
    queryKey: ["token-submission-detail", submissionId?.toString()],
    enabled: Boolean(client && submissionId),
    queryFn: () => client!.readContract({ ...contracts.slabVault, functionName: "submissionOf", args: [submissionId!] }),
  });

  const { data: evidence } = useQuery({
    queryKey: ["evidence", slab?.evidenceHash],
    enabled: Boolean(slab?.evidenceHash),
    queryFn: async () => {
      const res = await fetch(`/api/evidence/${slab!.evidenceHash}`, { cache: "no-store" });
      const body = res.ok ? ((await res.json()) as { manifest?: Manifest; verified: { manifest: boolean; all: boolean } }) : null;
      // Only a full record counts; "nothing stored" (seeded slabs) and partial answers mean no evidence.
      return body?.manifest && body.verified ? (body as { manifest: Manifest; verified: { manifest: boolean; all: boolean } }) : null;
    },
  });

  if (!slab) return null;
  const m = evidence?.manifest;
  const trusted = Boolean(evidence?.verified?.all);
  const attr = (name: string) => meta?.attributes.find((a) => a.trait_type === name)?.value;

  const formRows: { field: string; entered: string; onChain: string; ok: boolean }[] = m
    ? [
        { field: "Grader", entered: m.grader, onChain: slab.grader, ok: m.grader === slab.grader },
        { field: "Cert number", entered: m.certNumber, onChain: slab.certNumber, ok: m.certNumber === slab.certNumber },
        {
          field: "Shipping to Pokechain",
          entered:
            m.source === "already-vaulted"
              ? "Already at Pokechain"
              : m.shipping.method === "courier"
                ? inbound(m.shipping.carrier, m.shipping.tracking)
                : "Drop-off",
          onChain: submission ? inbound(submission.inboundCarrier, submission.inboundTracking) : "…",
          ok:
            !submission ||
            (m.source === "already-vaulted"
              ? submission.inboundTracking === ""
              : m.shipping.method === "courier"
                ? submission.inboundCarrier === m.shipping.carrier && submission.inboundTracking === m.shipping.tracking
                : submission.inboundCarrier === "Drop-off"),
        },
        {
          field: "Photos, condition, declarations",
          entered: `${m.photos.length} photo${m.photos.length === 1 ? "" : "s"}${m.condition.notes ? `, "${m.condition.notes}"` : ""}`,
          onChain: `evidenceHash ${shortHash(slab.evidenceHash)}`,
          ok: trusted,
        },
      ]
    : [];

  const metaRows: { field: string; value: string; ok: boolean }[] = meta
    ? [
        { field: "name", value: meta.name, ok: meta.name === slab.title },
        { field: "Grader", value: String(attr("Grader")), ok: attr("Grader") === slab.grader },
        { field: "Cert number", value: String(attr("Cert number")), ok: attr("Cert number") === slab.certNumber },
        { field: "Evidence hash", value: shortHash(String(attr("Evidence hash"))), ok: attr("Evidence hash") === slab.evidenceHash },
        { field: "Custody", value: String(attr("Custody")), ok: attr("Custody") === CUSTODY[slab.custody] },
        {
          field: "Collector Crypt NFT (Solana)",
          value: shortHash(String(attr("Collector Crypt NFT (Solana)"))),
          ok: attr("Collector Crypt NFT (Solana)") === slab.custodianRef,
        },
      ]
    : [];

  const allOk = formRows.every((r) => r.ok) && metaRows.every((r) => r.ok);

  return (
    <section className="rounded-card border border-hairline bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-4 py-3">
        <h2 className="text-sm font-bold">Your submission vs the token</h2>
        <span className={clsx("inline-flex items-center gap-1 text-[12px] font-semibold", allOk && m ? "text-good" : "text-warn")}>
          {allOk && m ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
          {!m ? "No intake evidence found" : allOk ? "Everything tallies" : "Something doesn't match"}
        </span>
      </header>

      <div className="space-y-4 p-4">
        {formRows.length ? (
          <ul className="divide-y divide-[rgba(255,255,255,0.08)] rounded-xl bg-[#101014]">
            {formRows.map((r) => (
              <li key={r.field} className="px-3 py-2.5 text-[12.5px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{r.field}</span>
                  {r.ok ? <CheckCircle2 size={14} className="text-good" /> : <XCircle size={14} className="text-bad" />}
                </div>
                <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                  <span className="text-dim">You entered</span>
                  <span className="truncate">{r.entered}</span>
                  <span className="text-dim">On-chain</span>
                  <span className="truncate font-mono text-[11.5px]">{r.onChain}</span>
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        {slab.evidenceHash ? <EvidencePanel hash={slab.evidenceHash} compact /> : null}

        <div>
          <p className="mb-1.5 text-[12px] font-semibold">
            NFT metadata
          </p>
          <ul className="space-y-1 rounded-xl bg-[#101014] px-3 py-2.5 text-[12px]">
            {metaRows.map((r) => (
              <li key={r.field} className="flex items-center justify-between gap-3">
                <span className="text-dim">{r.field}</span>
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate font-semibold">{r.value}</span>
                  {r.ok ? <CheckCircle2 size={12} className="shrink-0 text-good" /> : <XCircle size={12} className="shrink-0 text-bad" />}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-dim">
          <span>
            Token #{tokenId} · owner {owner ? <CopyText text={owner} /> : "…"} · contract <CopyText text={contracts.slabVault.address} />
          </span>
          <Link href={`/trace/${tokenId}`} className="inline-flex items-center gap-1 font-semibold text-accent hover:underline">
            <Route size={12} /> Full trace
          </Link>
        </div>
      </div>
    </section>
  );
}
