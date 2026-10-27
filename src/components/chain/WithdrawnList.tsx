"use client";

import clsx from "clsx";
import Link from "next/link";
import { Check, ChevronDown, PackageCheck, PackageX, Route } from "lucide-react";
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
export function WithdrawnList({
  items,
  showNftAction = false,
}: {
  items: { entry: VaultItem; listing: Listing }[];
  showNftAction?: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const tokenIds = items.map((i) => BigInt(i.entry.token?.tokenId ?? 0));
  const { data, refetch } = useReadContracts({
    contracts: tokenIds.map((id) => ({ ...contracts.slabVault, functionName: "slabOf" as const, args: [id] as const })),
    query: { enabled: tokenIds.length > 0 },
  });

  return (
    <div className="overflow-hidden rounded-card border border-hairline bg-surface">
      <div className="hidden grid-cols-[minmax(240px,1.25fr)_minmax(210px,1fr)_150px_170px] gap-4 border-b border-hairline px-4 py-2.5 text-[10px] font-bold uppercase tracking-wide text-dim md:grid">
        <span>Slab withdrawal</span>
        <span>Progress</span>
        <span>Requested</span>
        <span className="text-right">Actions</span>
      </div>
      <ul className="divide-y divide-[rgba(255,255,255,0.08)]">
        {items.map((item, i) => {
          const slab = data?.[i]?.result as OnChainSlab | undefined;
          return (
            <Row
              key={item.listing.id}
              item={item}
              slab={slab}
              custody={slab ? CUSTODY[slab.custody] : null}
              open={openId === item.listing.id}
              onToggle={() => setOpenId((current) => current === item.listing.id ? null : item.listing.id)}
              onChange={() => void refetch()}
              showNftAction={showNftAction}
            />
          );
        })}
      </ul>
    </div>
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
  open,
  onToggle,
  onChange,
  showNftAction,
}: {
  item: { entry: VaultItem; listing: Listing };
  slab?: OnChainSlab;
  custody: CustodyName | null;
  open: boolean;
  onToggle: () => void;
  onChange: () => void;
  showNftAction: boolean;
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
    <li>
      <div className="grid grid-cols-1 gap-3 px-4 py-4 md:grid-cols-[minmax(240px,1.25fr)_minmax(210px,1fr)_150px_170px] md:items-center md:gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Link href={`/asset/${listing.id}`} className="block h-14 w-10 shrink-0 overflow-hidden rounded-md bg-surface-2">
            <Slab listing={listing} flat />
          </Link>
          <div className="min-w-0">
            <Link href={`/asset/${listing.id}`} className="block truncate text-[13px] font-bold hover:underline">
              {listing.grader} cert {listing.certNumber}
            </Link>
            <p className="mt-1 truncate text-[11.5px] text-dim">
              Token #{token?.tokenId}{custody === "Delivered" ? " · NFT burned" : " · NFT locked in transit"}
            </p>
            <span className="mt-2 block">
              <Badge tone={lost ? "warn" : custody === "Delivered" ? "good" : "accent"}>{lost ? "Lost reported" : custody ?? "Reading chain…"}</Badge>
            </span>
          </div>
        </div>

        <WithdrawalTimeline step={step} lost={lost} />

        <span className="text-[11.5px] text-muted">{w?.requestedAt ? shortDate(w.requestedAt) : "—"}</span>

        <div className="flex flex-wrap justify-start gap-2 md:flex-col md:items-stretch">
          {showNftAction ? (
            <Link
              href={token?.tokenId ? `/asset/token-${token.tokenId}` : `/asset/${listing.id}`}
              className="inline-flex min-h-8 items-center justify-center rounded-lg border border-hairline px-3 text-[12px] font-semibold text-white transition hover:border-white/30 hover:bg-surface-2"
            >
              View Withdrawn NFT
            </Link>
          ) : null}
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
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg border border-hairline px-3 text-[12px] font-semibold text-muted transition hover:border-white/30 hover:bg-surface-2 hover:text-white"
          >
            {open ? "Hide details" : "View details"}
            <ChevronDown size={14} className={clsx("transition", open && "rotate-180")} />
          </button>
        </div>
      </div>

      {open ? <div className="border-t border-hairline bg-black/15 px-4 py-3">
        <p className="text-[12px] text-muted">
          {custody === "Delivered"
            ? "Delivery confirmed and the Pokechain NFT was burned."
            : lost
              ? "This shipment was reported lost on-chain."
              : "The slab remains locked to its latest owner while Collector Crypt completes delivery."}
          {slab?.trackingNumber ? ` Collector Crypt ${slab.redemptionRef} · ${slab.carrier} ${slab.trackingNumber}` : ""}
        </p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-dim">
          {w?.requestTx ? <span>request tx <CopyText text={w.requestTx} /></span> : null}
          {w?.shipTx ? <span>ship tx <CopyText text={w.shipTx} /></span> : null}
          {slab?.shippingHash ? <span>shippingHash <CopyText text={slab.shippingHash} /></span> : null}
          {slab?.custodianRef ? <span>Collector Crypt NFT <CopyText text={slab.custodianRef} /></span> : null}
          <Link href={`/trace/${token?.tokenId}`} className="inline-flex items-center gap-1 font-semibold text-accent hover:underline">
            <Route size={11} /> Full trace
          </Link>
        </div>
      </div> : null}

      {lostOpen ? (
        <div className="space-y-2 border-t border-hairline bg-[#101014] p-4">
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

function WithdrawalTimeline({ step, lost }: { step: number; lost: boolean }) {
  return (
    <ol className="grid min-w-0 grid-cols-4 pt-1 md:pt-0">
      {TRAIL.map((name, index) => {
        const done = index <= step;
        return (
          <li key={name} className="relative flex min-w-0 flex-col items-center gap-1 text-center">
            {index < TRAIL.length - 1 ? (
              <span
                aria-hidden
                className={clsx("absolute top-[9.5px] h-px", index < step ? "bg-good/60" : "bg-hairline")}
                style={{ left: "calc(50% + 10px)", width: "calc(100% - 20px)" }}
              />
            ) : null}
            <span
              className={clsx(
                "relative z-10 grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[9px] font-bold",
                done ? "border-good/70 bg-good/10 text-good" : "border-hairline bg-surface text-dim",
              )}
            >
              {done ? <Check size={11} /> : index + 1}
            </span>
            <span className={clsx("whitespace-nowrap text-[10px] font-semibold leading-none", done ? "text-good" : "text-dim", lost && index > step && "line-through")}>
              {name}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
