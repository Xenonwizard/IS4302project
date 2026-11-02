"use client";

import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { CheckCircle2, XCircle } from "lucide-react";
import { shortHash } from "@/lib/chain/config";
import type { Manifest } from "@/lib/evidence/store";
import { usd } from "@/lib/format";
import { CopyText } from "./ChainConsole";

interface EvidenceResponse {
  manifest: Manifest;
  verified: { manifest: boolean; photos: { slot: string; ok: boolean }[]; all: boolean };
}

const SLOT_LABEL: Record<string, string> = { front: "Front", back: "Back", label: "Label", extra: "Extra" };

/**
 * The intake evidence behind an on-chain evidenceHash, re-verified on every load: the stored
 * manifest must hash to the value on-chain, and each photo to the hash the manifest lists.
 */
export function EvidencePanel({ hash, compact = false }: { hash: string; compact?: boolean }) {
  const { data, error } = useQuery({
    queryKey: ["evidence", hash],
    queryFn: async (): Promise<EvidenceResponse | null> => {
      const res = await fetch(`/api/evidence/${hash}`, { cache: "no-store" });
      const body = await res.json();
      // Nothing stored is normal: demo-seeded slabs never had an intake form, and Reset clears stored photos.
      if (res.ok && body.found === false) return null;
      if (!res.ok || !body.manifest || !body.verified) throw new Error(body.error ?? "No evidence");
      return body;
    },
  });

  if (error) return <p className="text-[12px] text-bad">Evidence {shortHash(hash)}: {(error as Error).message}</p>;
  if (data === null) {
    return (
      <p className="text-[12px] text-muted">
        No intake photos are stored for this slab. Demo-seeded slabs never had an intake form, and resetting the demo clears stored photos.
      </p>
    );
  }
  if (!data) return <p className="text-[12px] text-dim">Checking evidence {shortHash(hash)}…</p>;

  const m = data.manifest;
  const c = m.condition;
  const flags = [c.caseCracked && "case cracked", c.caseScratched && "case scratched", c.labelDamaged && "label damaged"].filter(Boolean);

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
        <span className={clsx("inline-flex items-center gap-1 font-semibold", data.verified.all ? "text-good" : "text-bad")}>
          {data.verified.all ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
          {data.verified.all ? "Matches the recorded evidence" : "Does NOT match the recorded evidence"}
        </span>
        <span className="text-dim">
          evidenceHash <CopyText text={hash} />
        </span>
      </div>
      {m.photos.length ? (
        <div className="flex gap-2">
          {m.photos.map((p) => {
            const ok = data.verified.photos.find((v) => v.slot === p.slot)?.ok;
            return (
              <a key={p.slot} href={`/api/evidence/${hash}/${p.slot}`} target="_blank" rel="noreferrer" className="block w-16" title={`keccak256 ${p.keccak256}`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- served by the evidence route, not a static asset */}
                <img src={`/api/evidence/${hash}/${p.slot}`} alt={p.slot} className="aspect-[3/4] w-16 rounded-md border border-hairline object-cover" />
                <span className={clsx("mt-0.5 flex items-center gap-0.5 text-[10px]", ok ? "text-good" : "text-bad")}>
                  {ok ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
                  {SLOT_LABEL[p.slot] ?? p.slot}
                </span>
              </a>
            );
          })}
        </div>
      ) : (
        <p className="text-[12px] text-muted">No photos: the slab was already in Pokechain&apos;s vault.</p>
      )}
      {!compact ? (
        <dl className="grid gap-x-4 gap-y-1 text-[12px] sm:grid-cols-2">
          <Row label="Condition" value={flags.length ? flags.join(", ") : "no damage declared"} />
          {c.notes ? <Row label="Notes" value={c.notes} /> : null}
          <Row
            label="Inbound"
            value={m.shipping.method === "courier" ? `${m.shipping.carrier} ${m.shipping.tracking}` : m.source === "already-vaulted" ? "already at Pokechain" : "dropped off"}
          />
          <Row label="Declared" value={new Date(m.createdAt).toLocaleString()} />
        </dl>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-dim">{label}</dt>
      <dd className="min-w-0 truncate font-semibold">{value}</dd>
    </div>
  );
}
