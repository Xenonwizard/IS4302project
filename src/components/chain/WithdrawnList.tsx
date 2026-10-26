"use client";

import clsx from "clsx";
import Link from "next/link";
import { PackageCheck, PackageX, Route } from "lucide-react";
import { useState } from "react";
import { useReadContracts } from "wagmi";
import { CUSTODY, contracts, type CustodyName } from "@/lib/chain/config";
import { useLostReport } from "@/lib/chain/useLostAndFound";
import { useSlabChain } from "@/lib/chain/useSlabChain";
import { shortDate } from "@/lib/format";
import { isActiveRecovery, useStore } from "@/lib/store";
import type { Listing, VaultItem } from "@/lib/types";
import { Slab } from "../slab/Slab";
import { Badge, Button, inputClass } from "../ui/primitives";
import { CopyText } from "./ChainConsole";
import { Fn } from "./ui";

const TRAIL: CustodyName[] = ["Vaulted", "Redemption requested", "Shipped", "Delivered"];

/**
 * Slabs that have left the vault. Their custody state, Collector Crypt redemption id and tracking
 * come live from `SlabVault.slabOf(tokenId)`. The token remains through transit and is burned only
 * after owner-confirmed receipt; the slab record and event trail stay queryable afterwards.
 */
export function WithdrawnList({ items }: { items: { entry: VaultItem; listing: Listing }[] }) {
  const tokenIds = items.map((i) => BigInt(i.entry.token?.tokenId ?? 0));
  const { data, refetch } = useReadContracts({
    contracts: tokenIds.map((id) => ({ ...contracts.slabVault, functionName: "slabOf" as const, args: [id] as const })),
    query: { enabled: tokenIds.length > 0, refetchInterval: 8000 },
  });

  return (
    <ul className="space-y-3">
      {items.map((item, i) => {
        const slab = data?.[i]?.result as OnChainSlab | undefined;
        return (
          <Row key={item.listing.id} item={item} slab={slab} custody={slab ? CUSTODY[slab.custody] : null} onChange={() => void refetch()} />
        );
      })}
    </ul>
  );
}
interface OnChainSlab {
  custody: number;
  carrier: string;
  trackingNumber: string;
  redemptionRef: string;
  custodianRef: string;
  shippingHash: string;
}

function Row({
  item: { entry, listing },
  slab,
  custody,
  onChange,
}: {
  item: { entry: VaultItem; listing: Listing };
  slab?: OnChainSlab;
  custody: CustodyName | null;
  onChange: () => void;
}) {
  const { confirmDelivery } = useSlabChain();
  const { pushToast, recoveries, confirmRecoveredSlab } = useStore();
  const lostReport = useLostReport();
  const recovering = isActiveRecovery(recoveries[listing.id]);
  const [busy, setBusy] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);
  const [details, setDetails] = useState("");
  const [bounty, setBounty] = useState("");
  const w = entry.withdrawal;
  const token = entry.token;

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      pushToast({ title: ok, tone: "success" });
      setLostOpen(false);
      onChange();
    } catch (e) {
      pushToast({ title: "Transaction failed", body: (e as Error).message, tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const fileLost = async () => {
    await act(async () => {
      await lostReport.report(listing.id, token!.tokenId, details.trim() || "Lost in transit", { inTransit: true, bounty: Number(bounty) });
    }, Number(bounty) > 0 ? "Lost report and bounty filed" : "Lost report filed");
  };

  const lost = custody === "Lost";
  // A lost slab got as far as Shipped if it has a tracking number, otherwise Redemption requested.
  const step = lost ? (slab?.trackingNumber ? 2 : 1) : custody ? TRAIL.indexOf(custody) : -1;

  return (
    <li className="rounded-card border border-hairline bg-surface p-4">
      <div className="flex flex-wrap gap-4">
        <Link href={`/asset/${listing.id}`} className="w-14 shrink-0">
          <Slab listing={listing} flat />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/asset/${listing.id}`} className="line-clamp-1 text-[13px] font-semibold hover:underline">
              {listing.title}
            </Link>
            <Badge tone={lost ? "warn" : custody === "Delivered" ? "good" : "accent"}>{custody ?? "Reading chain…"}</Badge>
          </div>
          <p className="mt-1 text-[12px] text-muted">
            Token #{token?.tokenId} · {custody === "Delivered" ? "burned after your receipt confirmation" : "locked to the latest owner during transit"}{w?.requestTx ? ` · requested ${shortDate(w.requestedAt)}` : ""}
            {slab?.trackingNumber ? ` · Collector Crypt ${slab.redemptionRef} · ${slab.carrier} ${slab.trackingNumber}` : ""}
          </p>

          {/* custody trail, as SlabVault records it */}
          <ol className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
            {TRAIL.map((name, i) => (
              <li
                key={name}
                className={clsx(
                  "rounded-md px-2 py-1",
                  i <= step ? "bg-good-bg text-good" : lost ? "bg-surface-2 text-dim line-through" : "bg-surface-2 text-dim",
                )}
              >
                {name}
              </li>
            ))}
            {lost ? <li className="rounded-md bg-warn/15 px-2 py-1 text-warn">Lost: reported on-chain</li> : null}
          </ol>

          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-dim">
            {w?.requestTx ? <span>request tx <CopyText text={w.requestTx} /></span> : null}
            {w?.shipTx ? <span>ship tx <CopyText text={w.shipTx} /></span> : null}
            {slab?.shippingHash ? <span>shippingHash <CopyText text={slab.shippingHash} /></span> : null}
            {slab?.custodianRef ? <span>Collector Crypt NFT <CopyText text={slab.custodianRef} /></span> : null}
            <Link href={`/trace/${token?.tokenId}`} className="inline-flex items-center gap-1 font-semibold text-accent hover:underline">
              <Route size={11} /> Full trace
            </Link>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          {custody === "Shipped" ? (
            <Button size="sm" onClick={() => act(async () => {
              await confirmDelivery(token!.tokenId);
              // A found slab on its way back: receipt is also what releases the finder's bounty.
              if (recoveries[listing.id]?.status === "Returning to owner") confirmRecoveredSlab(listing.id);
            }, "Delivery confirmed; Pokechain NFT burned")} disabled={busy}>
              <PackageCheck size={13} /> Confirm delivery
            </Button>
          ) : null}
          {custody === "Shipped" || custody === "Redemption requested" ? (
            <Button size="sm" variant="danger" onClick={() => setLostOpen((v) => !v)} disabled={busy}>
              <PackageX size={13} /> Report lost
            </Button>
          ) : null}
          {custody === "Lost" && !recovering ? (
            <Button size="sm" variant="outline" onClick={() => act(async () => {
              await lostReport.cancel(listing.id, token!.tokenId);
            }, "Lost report cancelled")} disabled={busy}>
              Cancel lost status
            </Button>
          ) : null}
        </div>
      </div>

      {lostOpen ? (
        <div className="mt-3 space-y-2 rounded-xl bg-[#101014] p-3">
          <p className="text-[12px] text-muted">
            Calls <Fn>SlabVault.reportLost(tokenId, details)</Fn>. Custody becomes <b className="text-white">Lost</b> and{" "}
            <Fn>SlabReportedLost</Fn> is emitted with the tracking number. The Trace page lines this up with Collector
            Crypt&apos;s redemption record, the carrier scans and the Pokechain NFT, which stays locked until receipt is confirmed.
            A bounty is escrowed from your Pokechain balance with <Fn>LostAndFound.setBounty</Fn> and refunded if you cancel.
          </p>
          <div className="grid gap-2 sm:grid-cols-[1fr_140px_auto]">
            <input className={inputClass} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Not delivered after 10 days, carrier has no scan since dispatch" />
            <input className={inputClass} inputMode="decimal" value={bounty} onChange={(e) => setBounty(e.target.value.replace(/[^\d.]/g, ""))} placeholder="Bounty (optional)" />
            <Button variant="danger" onClick={() => void fileLost()} disabled={busy}>
              File
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
