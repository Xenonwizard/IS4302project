"use client";

import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Route, XCircle } from "lucide-react";
import { useState } from "react";
import { shortHash } from "@/lib/chain/config";
import type { SlabTrace } from "@/lib/chain/trace";
import { Badge, Button, inputClass } from "../ui/primitives";
import { CopyText } from "./ChainConsole";
import { Fn, OnChainNote } from "./ui";

type Source = "Polygon" | "Solana" | "Collector Crypt";

interface Row {
  source: Source;
  at: string;
  title: string;
  detail: string;
  ref?: string;
  refLabel?: string;
}

const SOURCE_STYLE: Record<Source, string> = {
  Polygon: "bg-[#8247e5]/20 text-[#b794f6]",
  Solana: "bg-[#14f195]/15 text-[#14f195]",
  "Collector Crypt": "bg-warn/15 text-warn",
};

/**
 * One slab's full journey, cross-referenced across Polygon (SlabVault events), Solana (Collector
 * Crypt's NFT) and Collector Crypt's shipment tracking. This is the evidence when a slab doesn't
 * arrive: every hand-off is recorded by a different system, and each one names the others' ids.
 */
export function TraceView({ tokenId }: { tokenId: string }) {
  const router = useRouter();
  const [search, setSearch] = useState(tokenId);
  const { data, error, isLoading } = useQuery({
    queryKey: ["trace", tokenId],
    refetchInterval: 8000,
    queryFn: async (): Promise<SlabTrace> => {
      const res = await fetch(`/api/trace/${tokenId}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Token #${tokenId} not found`);
      return body;
    },
  });

  const rows: Row[] = data
    ? [
        ...data.polygon.map<Row>((e) => ({
          source: "Polygon",
          at: e.at,
          title: `SlabVault.${e.event}`,
          detail: e.detail,
          ref: e.tx,
          refLabel: `block ${e.block}`,
        })),
        ...data.custodian.solanaTxs.map<Row>((t) => ({
          source: "Solana",
          at: t.at,
          title: t.type,
          detail: t.description,
          ref: t.signature,
          refLabel: `slot ${t.slot}`,
        })),
        ...(data.custodian.redemption?.events ?? []).map<Row>((e) => ({
          source: "Collector Crypt",
          at: e.at,
          title: `Carrier: ${e.status.replace("_", " ")}`,
          detail: e.note,
        })),
      ].sort((a, b) => a.at.localeCompare(b.at))
    : [];

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-5 lg:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-[24px] font-bold">
            <Route size={22} /> Trace token #{tokenId}
          </h1>
          <p className="mt-1 text-[13px] text-muted">The slab&apos;s whole journey, cross-checked across Polygon, Solana and Collector Crypt.</p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (/^\d+$/.test(search.trim())) router.push(`/trace/${search.trim()}`);
          }}
          className="flex gap-2"
        >
          <input className={clsx(inputClass, "w-28")} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Token #" />
          <Button type="submit" variant="secondary">
            Trace
          </Button>
        </form>
      </div>

      {isLoading ? <p className="text-[13px] text-muted">Reading three systems…</p> : null}
      {error ? <p className="text-[13px] text-bad">{(error as Error).message}</p> : null}

      {data ? (
        <>
          <section className="flex gap-4 rounded-card border border-hairline bg-surface p-4">
            <div className="relative aspect-[63/88] w-16 shrink-0 overflow-hidden rounded">
              <Image src={data.image} alt="" fill sizes="64px" className="object-cover" />
            </div>
            <div className="min-w-0">
              <p className="text-[14px] font-bold leading-snug">{data.title}</p>
              <p className="mt-1 text-[12px] text-muted">
                {data.grader} cert {data.certNumber}
                {data.submission ? ` · from submission #${data.submission.id}` : ""}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]">
                <Badge tone={data.custody === "Lost" ? "warn" : data.custody === "Vaulted" ? "good" : "accent"}>{data.custody}</Badge>
                <span className="text-muted">
                  owner <CopyText text={data.owner} />
                </span>
              </div>
            </div>
          </section>

          <div className="grid gap-3 md:grid-cols-3">
            <RefCard source="Polygon" title="SlabVault token (the title)">
              <Line label="Token" value={`#${data.tokenId}`} />
              <Line label="Custody" value={data.custody} />
              <Line label="Owner" value={<CopyText text={data.owner} />} />
              {data.shippingHash !== "0x0000000000000000000000000000000000000000000000000000000000000000" ? (
                <Line label="shippingHash" value={<CopyText text={data.shippingHash} />} />
              ) : null}
              <Line label="custodianRef" value={<CopyText text={data.custodianRef} />} />
            </RefCard>
            <RefCard source="Solana" title="Collector Crypt's NFT (the receipt)">
              {data.custodian.asset ? (
                <>
                  <Line label="Asset" value={<CopyText text={data.custodian.asset.id} />} />
                  <Line
                    label="Holder"
                    value={
                      <span className="inline-flex items-center gap-1">
                        {data.custodian.asset.ownerIsPokechainEscrow ? <CheckCircle2 size={12} className="text-good" /> : <XCircle size={12} className="text-bad" />}
                        {data.custodian.asset.ownerIsPokechainEscrow ? "Pokechain escrow" : shortHash(data.custodian.asset.owner)}
                      </span>
                    }
                  />
                  <Line label="Vault status" value={data.custodian.asset.vaultStatus ?? "—"} />
                  <Line label="Frozen" value={data.custodian.asset.frozen ? "yes" : "no"} />
                  <Line label="Burnt" value={data.custodian.asset.burnt ? "yes" : "no"} />
                </>
              ) : (
                <p className="text-[12px] text-bad">No Solana asset {shortHash(data.custodianRef)} found.</p>
              )}
            </RefCard>
            <RefCard source="Collector Crypt" title="Shipment (outbound)">
              {data.custodian.redemption ? (
                <>
                  <Line label="Redemption" value={data.custodian.redemption.id} />
                  <Line label="Carrier" value={data.custodian.redemption.carrier} />
                  <Line label="Tracking" value={<CopyText text={data.custodian.redemption.trackingNumber} />} />
                  <Line label="Status" value={data.custodian.redemption.status.replace("_", " ")} />
                  <Line label="Ship to" value={data.custodian.redemption.shipTo} />
                </>
              ) : (
                <p className="text-[12px] text-muted">Still in Collector Crypt&apos;s vault. Nothing has shipped.</p>
              )}
            </RefCard>
          </div>

          {data.custody === "Lost" || data.custodian.redemption?.status === "lost" ? (
            <div className="flex gap-2.5 rounded-xl border border-warn/30 bg-warn/10 p-3 text-[12.5px] text-warn">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>
                Reported lost. The claim rests on records three different parties wrote. Polygon shows who owned it and that they
                asked for it (with the address hash). Collector Crypt&apos;s redemption {data.redemptionRef} names the carrier and
                tracking number. The Solana NFT is frozen and was never burned, so the slab can&apos;t be redeemed again or sold
                elsewhere while the claim is open.
              </span>
            </div>
          ) : null}

          <section className="rounded-card border border-hairline bg-surface">
            <header className="border-b border-hairline px-4 py-3">
              <h2 className="text-[14px] font-bold">Timeline</h2>
              <p className="mt-0.5 text-[11px] text-dim">
                Polygon <Fn>eth_getLogs</Fn> on SlabVault · Solana <Fn>getSignaturesForAsset</Fn> · Collector Crypt{" "}
                <Fn>GET /redemptions/{"{id}"}</Fn>
              </p>
            </header>
            <ol className="divide-y divide-[rgba(255,255,255,0.08)]">
              {rows.map((r, i) => (
                <li key={i} className="grid grid-cols-[auto_1fr_auto] items-start gap-3 px-4 py-3 text-[12.5px]">
                  <span className={clsx("mt-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-bold", SOURCE_STYLE[r.source])}>{r.source}</span>
                  <div className="min-w-0">
                    <p className="font-semibold">{r.title}</p>
                    <p className="mt-0.5 text-muted">{r.detail}</p>
                  </div>
                  <div className="text-right text-[11px] text-dim">
                    <p>{new Date(r.at).toLocaleString()}</p>
                    {r.ref ? (
                      <p>
                        {r.refLabel} · <CopyText text={r.ref} />
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <OnChainNote title="Why this is traceable">
            Nothing is burned. The Polygon token stays locked with its owner. Collector Crypt&apos;s Solana NFT stays frozen in
            Pokechain&apos;s escrow, marked with the redemption. Each record carries the other&apos;s id: the token stores CC&apos;s
            asset id and redemption id, and CC&apos;s record carries the tracking number. If the real Collector Crypt burned
            its NFT on redemption, the burn would be one more Solana transaction in this timeline, and the Polygon side
            would be unchanged.
          </OnChainNote>
        </>
      ) : null}
    </div>
  );
}

function RefCard({ source, title, children }: { source: Source; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-hairline bg-surface p-3.5">
      <span className={clsx("rounded-md px-1.5 py-0.5 text-[10px] font-bold", SOURCE_STYLE[source])}>{source}</span>
      <p className="mt-2 text-[13px] font-bold">{title}</p>
      <dl className="mt-2 space-y-1">{children}</dl>
    </section>
  );
}

function Line({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[12px]">
      <dt className="text-dim">{label}</dt>
      <dd className="truncate font-semibold">{value}</dd>
    </div>
  );
}
