"use client";

import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { CheckCircle2, Eye, EyeOff, Lock, Scale, XCircle } from "lucide-react";
import { useState } from "react";
import type { InboxItem } from "@/lib/collectorCrypt/keys";
import { Badge, Button } from "../ui/primitives";
import { CopyText } from "./ChainConsole";
import { Fn } from "./ui";

interface Inbox {
  collectorCrypt: string;
  isCustodian: boolean;
  publishedKey: string | null;
  keyMatches: boolean;
  items: InboxItem[];
}

/**
 * The simulated custodian's screen: every parcel Pokechain has forwarded, as the chain shows it
 * to everyone (ciphertext) and as Collector Crypt reads it (decrypted with its private key).
 */
export function CollectorCryptInbox() {
  const { data, error, isLoading } = useQuery({
    queryKey: ["cc-inbox"],
    refetchInterval: 8000,
    queryFn: async (): Promise<Inbox> => {
      const res = await fetch("/api/collector-crypt/inbox", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Inbox failed");
      return body;
    },
  });

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-5 lg:px-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[24px] font-bold">Collector Crypt inbox</h1>
          <Badge tone="warn">Simulated custodian</Badge>
        </div>
        <p className="mt-1 text-[13px] text-muted">
          What Collector Crypt sees when Pokechain forwards a slab. Anyone can read the same transaction on-chain, but only
          Collector Crypt&apos;s private key turns it into parcel details.
        </p>
      </div>

      {isLoading ? <p className="text-[13px] text-muted">Reading the chain…</p> : null}
      {error ? <p className="text-[13px] text-bad">{(error as Error).message}</p> : null}

      {data ? (
        <>
          <section className="grid gap-2 rounded-card border border-hairline bg-surface p-4 text-[12.5px] sm:grid-cols-2">
            <Row label="Collector Crypt wallet" value={<CopyText text={data.collectorCrypt} />} />
            <Row
              label="Named custodian in SlabVault"
              value={<Status ok={data.isCustodian} yes="yes" no="no: SlabVault.custodian is someone else" />}
            />
            <Row
              label="Public key on-chain (encryptionKey)"
              value={data.publishedKey ? <CopyText text={data.publishedKey} /> : <span className="text-muted">not published yet</span>}
            />
            <Row
              label="Matches CC's private key"
              value={<Status ok={data.keyMatches} yes="yes" no={data.publishedKey ? "no: old or wrong key" : "published on first forward"} />}
            />
          </section>

          {data.items.length ? (
            data.items.map((item) => <Parcel key={item.txHash} item={item} />)
          ) : (
            <p className="rounded-card border border-dashed border-hairline px-4 py-10 text-center text-[13px] text-muted">
              No parcels forwarded yet. Vault a slab, then on its tracker run step 2, <b>Forward to Collector Crypt</b>.
            </p>
          )}

        </>
      ) : null}
    </div>
  );
}

function Parcel({ item }: { item: InboxItem }) {
  const [dispute, setDispute] = useState<{ verified: boolean; message: string; salt: string } | { error: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const runDispute = async () => {
    setBusy(true);
    const res = await fetch("/api/chain/dispute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ submissionId: item.submissionId }),
    });
    const body = await res.json();
    setDispute(res.ok ? body : { error: body.error });
    setBusy(false);
  };

  const d = item.decrypted;
  return (
    <section className="rounded-card border border-hairline bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-4 py-3">
        <h2 className="text-[14px] font-bold">Incoming parcel · submission #{item.submissionId}</h2>
        <span className="text-[11.5px] text-dim">
          block {item.blockNumber} · tx <CopyText text={item.txHash} /> · from Pokechain operator <CopyText text={item.from} />
        </span>
      </header>
      <div className="grid gap-4 p-4 md:grid-cols-2">
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wide text-dim">
            <EyeOff size={13} /> On-chain: what anyone can read
          </p>
          <div className="space-y-1.5 text-[12px]">
            <Row label="Event" value={<span className="font-mono">SubmissionForwarded</span>} />
            <Row label="Encrypted for key" value={<CopyText text={item.recipientKey} />} />
            <Row label="Commitment" value={<CopyText text={item.commitment} />} />
            <div>
              <p className="text-dim">Ciphertext ({(item.ciphertext.length - 2) / 2} bytes)</p>
              <p className="mt-1 break-all rounded-lg bg-[#101014] p-2 font-mono text-[10.5px] text-muted">{item.ciphertext}</p>
            </div>
          </div>
        </div>
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wide text-good">
            <Eye size={13} /> Collector Crypt decrypts with its private key
          </p>
          {d ? (
            <div className="space-y-1.5 rounded-xl border border-good/25 bg-good-bg/30 p-3 text-[12.5px]">
              <Row label="Slab" value={`${d.grader} cert ${d.certNumber}`} />
              <Row label="Carrier" value={d.carrier} />
              <Row label="Tracking number" value={<span className="font-mono">{d.trackingNumber}</span>} />
              <Row label="Sent" value={new Date(d.sentAt).toLocaleString()} />
              <Row label="Pokechain submission" value={`#${d.submissionId}`} />
            </div>
          ) : (
            <p className="flex items-center gap-1.5 text-[12.5px] text-bad">
              <Lock size={13} /> {item.error}
            </p>
          )}
        </div>
      </div>
      <div className="border-t border-hairline px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" variant="secondary" onClick={runDispute} disabled={busy}>
            <Scale size={13} /> {busy ? "Checking on-chain…" : "Run dispute check"}
          </Button>
          <span className="text-[11.5px] text-dim">
            Pokechain reveals the message and salt; <Fn>SlabVault.verifyForwardCommitment</Fn> decides.
          </span>
        </div>
        {dispute ? (
          "error" in dispute ? (
            <p className="mt-2 text-[12px] text-bad">{dispute.error}</p>
          ) : (
            <div className="mt-2 space-y-1 text-[12px]">
              <Status ok={dispute.verified} yes="The contract confirms: this is exactly what Pokechain committed to" no="The contract says this doesn't match the commitment" />
              <p className="break-all font-mono text-[10.5px] text-muted">message {dispute.message}</p>
              <p className="break-all font-mono text-[10.5px] text-muted">salt {dispute.salt}</p>
            </div>
          )
        ) : null}
      </div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="shrink-0 text-dim">{label}</span>
      <span className="min-w-0 truncate text-right font-semibold">{value}</span>
    </div>
  );
}

function Status({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-1 font-semibold", ok ? "text-good" : "text-warn")}>
      {ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
      {ok ? yes : no}
    </span>
  );
}
