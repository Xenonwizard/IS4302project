"use client";

import { Check, Copy, Loader2 } from "lucide-react";
import { useState } from "react";
import { CLAIM_STATUS } from "@/lib/chain/config";
import type { FoundStep } from "@/lib/chain/operator";
import { type FoundCase, useFoundCases, useLostSlabRecovery } from "@/lib/chain/useLostSlabRecovery";
import { usd } from "@/lib/format";
import { useStore } from "@/lib/store";
import { Button } from "../ui/primitives";

/**
 * Pokechain's intake for found slabs: the same desk as a new submission, minus vaulting.
 * Receive and authenticate the finder's parcel, then send it where the owner chose.
 */
export function FoundIntakeQueue({ onOpenCert }: { onOpenCert: (certNumber: string) => void }) {
  const { data: cases = [] } = useFoundCases();
  // Returned to the vault but not Vaulted yet: it is back in normal intake (forward, then vault).
  const revaulting = (c: FoundCase) => c.status === 4 && c.returnTo === 1 && c.custody !== "Vaulted";
  const open = cases.filter((c) => (c.status >= 1 && c.status <= 3) || revaulting(c));
  return (
    <section className="mt-8 rounded-card border border-hairline bg-surface p-4" data-testid="found-intake">
      <p className="text-[15px] font-bold">Found-slab claims</p>
      <p className="mt-1 text-[12px] leading-relaxed text-muted">
        A collector found a slab reported lost and posted it here. Authenticate it, wait for the owner to choose vault or delivery, then send it back.
      </p>
      <div className="mt-4 space-y-3">
        {open.map((c) => <QueueItem key={c.claimId} c={c} onOpenCert={onOpenCert} />)}
        {!open.length ? (
          <p className="rounded-xl border border-dashed border-hairline py-6 text-center text-[12px] text-dim">No found-slab claims are waiting at intake.</p>
        ) : null}
      </div>
    </section>
  );
}

function QueueItem({ c, onOpenCert }: { c: FoundCase; onOpenCert: (certNumber: string) => void }) {
  const { step } = useLostSlabRecovery();
  const { pushToast } = useStore();
  const [busy, setBusy] = useState<FoundStep | null>(null);
  const [copied, setCopied] = useState(false);
  const origin = typeof window === "undefined" ? "http://localhost:3000" : window.location.origin;
  const next: FoundStep | null = c.status === 1 ? "receive" : c.status === 3 ? "return" : null;
  const curl = next ? `curl -X POST ${origin}/api/chain/found -H 'content-type: application/json' -d '{"claimId":"${c.claimId}","step":"${next}"}'` : "";

  const run = async (which: FoundStep) => {
    setBusy(which);
    try {
      await step(c.claimId, which);
      const title = which === "receive" ? "Found slab authenticated" : which === "reject" ? "Claim rejected" : c.returnTo === 1 ? "Back in intake: forward it to Collector Crypt" : "Shipped to the owner";
      pushToast({ title, body: `Case #${c.claimId} · PSA cert #${c.certNumber}`, tone: "success" });
    } catch (e) {
      pushToast({ title: "Intake step failed", body: (e as Error).message, tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-xl border border-hairline bg-black/20 p-3" data-testid={`found-intake-${c.claimId}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[13px] font-bold">{c.title}</p>
          <p className="mt-1 text-[11px] text-muted">
            Case #{c.claimId} · PSA cert #{c.certNumber} · token #{c.tokenId} · {usd(c.bounty, { cents: true })} bounty in escrow
          </p>
          <p className="mt-1 text-[11px] text-dim">Inbound: {c.inboundCarrier} {c.inboundTracking} · evidence {c.evidenceHash.slice(0, 10)}…</p>
        </div>
        <span className="rounded-md bg-warn/15 px-2 py-1 text-[10px] font-bold text-warn">{c.status === 4 ? "Back in intake" : CLAIM_STATUS[c.status]}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {c.status === 1 ? (
          <>
            <Button size="sm" className="flex-1" disabled={busy !== null} onClick={() => void run("receive")}>
              {busy === "receive" ? <Loader2 size={13} className="animate-spin" /> : null} Received & authenticated
            </Button>
            <Button size="sm" variant="danger" disabled={busy !== null} onClick={() => void run("reject")}>Reject</Button>
          </>
        ) : c.status === 2 ? (
          <p className="text-[11px] font-bold text-dim">Waiting for the owner to choose vault or delivery.</p>
        ) : c.status === 4 ? (
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <p className="flex-1 text-[11px] text-muted">
              Custody is <b className="text-white">{c.custody}</b>. Forward it to Collector Crypt and vault it with steps 2 and 3 above; the bounty unlocks once it&apos;s Vaulted.
            </p>
            <Button size="sm" variant="secondary" onClick={() => {
              onOpenCert(c.certNumber);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}>
              Open cert #{c.certNumber} above
            </Button>
          </div>
        ) : (
          <Button size="sm" className="flex-1" disabled={busy !== null} onClick={() => void run("return")}>
            {busy === "return" ? <Loader2 size={13} className="animate-spin" /> : null} {c.returnTo === 1 ? "Back into intake for re-vaulting" : "Ship to owner"}
          </Button>
        )}
      </div>
      {curl ? (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-black/25 p-3">
          <code className="min-w-0 flex-1 break-all text-[11px] text-dim">{curl}</code>
          <button
            onClick={() => {
              void navigator.clipboard?.writeText(curl);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            }}
            className="shrink-0 text-muted hover:text-white"
            title="Copy curl command"
          >
            {copied ? <Check size={15} className="text-good" /> : <Copy size={15} />}
          </button>
        </div>
      ) : null}
    </div>
  );
}
