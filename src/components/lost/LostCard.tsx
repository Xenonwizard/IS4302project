"use client";

import clsx from "clsx";
import Link from "next/link";
import { AlertTriangle, Coins, Copy, Check, PackageCheck, Sparkles } from "lucide-react";
import { useState } from "react";
import { usd } from "@/lib/format";
import { CLAIM_STATUS, IS_DEPLOYED } from "@/lib/chain/config";
import { isOpenCase, useFoundCases, useLostReport } from "@/lib/chain/useLostSlabRecovery";
import { useSlabChain } from "@/lib/chain/useSlabChain";
import { isActiveRecovery, useStore, type LostSlabItem } from "@/lib/store";
import { Slab } from "../slab/Slab";
import { Badge, Button, Modal, TimeAgo } from "../ui/primitives";
import { FoundSlabModal } from "./FoundSlabModal";

export function LostCard({
  item,
  size = "medium",
  onManageBounty,
}: {
  item: LostSlabItem;
  size?: "medium" | "small";
  onManageBounty?: (listingId: string) => void;
}) {
  const { listing, loss, recovery } = item;
  // A tokenised slab: its report is on SlabVault and a finder's claim on LostSlabRecovery.
  const onChain = IS_DEPLOYED && Boolean(listing.tokenId);
  const { data: cases = [] } = useFoundCases();
  const chainCase = onChain ? cases.find((c) => c.tokenId === listing.tokenId && isOpenCase(c)) : undefined;
  const recovering = isActiveRecovery(recovery) || Boolean(chainCase);
  const { user, isOwned, confirmRecoveredSlab, pushToast } = useStore();
  const { confirmDelivery } = useSlabChain();
  const lostReport = useLostReport();
  const owned = item.owner
    ? Boolean(user?.address && item.owner.toLowerCase() === user.address.toLowerCase())
    : isOwned(listing.id) || (user && listing.owner.toLowerCase() === user.username.toLowerCase());
  const small = size === "small";

  const [copied, setCopied] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [foundOpen, setFoundOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const confirmRecovered = async () => {
    setConfirming(true);
    try {
      // Only a slab lost in the post has an on-chain Lost → Shipped trail to close (and burn on receipt).
      if (IS_DEPLOYED && listing.tokenId && item.source === "transit") await confirmDelivery(listing.tokenId);
      confirmRecoveredSlab(listing.id);
    } catch (error) {
      pushToast({ title: "Receipt confirmation failed", body: (error as Error).message, tone: "error" });
    } finally {
      setConfirming(false);
    }
  };


  const handleCopyCert = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(listing.certNumber);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const lostDetailsHref = `/asset/${listing.id}?lost=1`;

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-card border border-hairline bg-surface transition-all duration-200 hover:-translate-y-0.5 hover:border-warn/40 hover:shadow-lg hover:shadow-warn/5 motion-reduce:transition-none">
      {/* Slab visual with interactive tilt */}
      <Link href={lostDetailsHref} className="block">
        <div className={clsx("relative bg-[#101014]", small ? "p-2" : "p-4")}>
          <Slab listing={listing} interactive maxTilt={9} />

          {/* Top badges */}
          <div className="absolute inset-x-2.5 top-2.5 z-10 flex flex-wrap items-start justify-between gap-1.5">
            <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-warn/20 px-2 py-0.5 text-[10.5px] font-bold text-warn backdrop-blur-md border border-warn/30">
              <AlertTriangle size={12} className="shrink-0" />
              Reported Lost
            </span>
            {loss.bounty ? (
              <span className="ml-auto inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-good/25 px-2 py-0.5 text-[11px] font-extrabold text-good shadow-lg shadow-good/10 backdrop-blur-md border border-good/40 animate-pulse">
                <Coins size={12} className="shrink-0" />
                {usd(loss.bounty.amount)} Bounty
              </span>
            ) : null}
          </div>
        </div>
      </Link>

      <div className={clsx("flex flex-1 flex-col justify-between", small ? "p-2.5 pt-2" : "p-3.5 pt-3")}>
        <div>
          {/* Card Title */}
          <Link href={lostDetailsHref}>
            <h3
              className={clsx(
                "line-clamp-2 font-semibold leading-snug hover:underline text-white",
                small ? "text-[11px]" : "text-[13px]",
              )}
            >
              {listing.title}
            </h3>
          </Link>

          {/* Grader / Cert metadata */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="font-semibold text-white/90">
              {listing.grader} {listing.grade} {listing.gradeLabel}
            </span>
            <span className="text-dim">&middot;</span>
            <button
              onClick={handleCopyCert}
              title="Copy cert number"
              className="inline-flex items-center gap-1 rounded bg-surface-2 px-1.5 py-0.5 text-muted transition hover:bg-surface-3 hover:text-white"
            >
              <span>#{listing.certNumber}</span>
              {copied ? <Check size={11} className="text-good" /> : <Copy size={11} />}
            </button>
            {listing.tokenId ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-accent/15 px-1.5 py-0.5 text-[10px] font-bold text-accent">
                #{listing.tokenId}
              </span>
            ) : null}
          </div>

          {/* Loss Report Details Box */}
          <div className={clsx(
            "mt-3 rounded-xl border border-warn/20 bg-warn/5",
            small ? "p-2 space-y-1" : "p-2.5 space-y-1.5"
          )}>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted">
                Reported to <span className="font-semibold text-white/90">Pokechain</span>
              </span>
              <span className="text-dim text-[10.5px]">
                <TimeAgo value={loss.reportedAt} />
              </span>
            </div>
            <p className={clsx("line-clamp-2 italic text-muted leading-relaxed", small ? "text-[10px]" : "text-[11.5px]")}>
              &ldquo;{loss.details}&rdquo;
            </p>
            {loss.bounty ? (
              <div className="flex items-center justify-between pt-1 border-t border-warn/15 text-[11px]">
                <span className="font-semibold text-good flex items-center gap-1">
                  <Sparkles size={12} /> Recovery Bounty:
                </span>
                <span className="font-extrabold text-white">
                  {usd(loss.bounty.amount)} USDC
                </span>
              </div>
            ) : null}
          </div>
          {chainCase ? (
            <div className="mt-2 rounded-lg border border-accent/25 bg-accent/5 px-2.5 py-2 text-[11px] text-muted">
              <span className="font-bold text-accent">Found · case #{chainCase.claimId}</span> · {CLAIM_STATUS[chainCase.status]}
            </div>
          ) : null}
          {recovery && !onChain ? (
            <div className="mt-2 rounded-lg border border-accent/25 bg-accent/5 px-2.5 py-2 text-[11px] text-muted">
              <span className="font-bold text-accent">Recovery {recovery.id}</span> · {recovery.status}
              {recovery.returnTracking ? <span className="block pt-1">{recovery.returnCarrier} {recovery.returnTracking}</span> : null}
            </div>
          ) : null}
        </div>

        {/* Card Actions */}
        <div className="mt-3.5 pt-2.5 border-t border-hairline">
          {owned ? (
            <div className="flex gap-2">
              {chainCase ? (
                <Link href="/submissions?tab=found" className="flex-1">
                  <Button size="sm" className="w-full text-[11.5px]">Open found case</Button>
                </Link>
              ) : recovery?.status === "Returning to owner" ? (
                <Button size="sm" className="flex-1 text-[11.5px]" disabled={confirming} onClick={() => void confirmRecovered()}>
                  {confirming ? "Confirming…" : item.source === "transit" ? "Confirm received" : "Confirm back in vault"}
                </Button>
              ) : (
              <Button
                size="sm"
                variant="outline"
                className="flex-1 text-[11.5px]"
                onClick={() => onManageBounty?.(listing.id)}
              >
                {loss.bounty ? "Edit bounty" : "Add bounty"}
              </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="text-[11.5px] text-muted hover:text-bad"
                onClick={() => setWithdrawOpen(true)}
                disabled={recovering}
                title={recovering ? "A finder's recovery is in progress" : undefined}
              >
                Withdraw
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button size="sm" className="w-full text-[11.5px]" disabled={recovering} onClick={() => setFoundOpen(true)}>
                <PackageCheck size={14} /> {recovering ? "Recovery in progress" : "Found Slab"}
              </Button>
            </div>
          )}
        </div>
      </div>

      <Modal open={withdrawOpen} onClose={() => setWithdrawOpen(false)} title="Withdraw lost-card listing" width="max-w-sm">
        <div className="space-y-4 p-5">
          <p className="text-[13px] leading-relaxed text-muted">
            Are you sure you want to withdraw <span className="font-semibold text-white">{listing.title}</span> from the Lost registry?
          </p>
          <div className="rounded-xl border border-warn/25 bg-warn/10 p-3 text-[12px] leading-relaxed text-muted">
            Withdrawing removes the public listing and bounty. You can then claim insurance through the vault service provider, and the slab leaves your active Vault.
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setWithdrawOpen(false)}>Keep listing</Button>
            <Button
              variant="danger"
              className="flex-1"
              onClick={() => {
                setWithdrawOpen(false);
                void lostReport.writeOff(listing.id, onChain ? listing.tokenId : undefined).catch((error: Error) =>
                  pushToast({ title: "Could not withdraw the report", body: error.message, tone: "error" }),
                );
              }}
            >
              Withdraw and claim insurance
            </Button>
          </div>
        </div>
      </Modal>
      <FoundSlabModal listing={listing} open={foundOpen} onClose={() => setFoundOpen(false)} onChain={onChain} />
    </div>
  );
}

export function LostCardSkeleton({ size = "medium" }: { size?: "medium" | "small" }) {
  const small = size === "small";
  return (
    <div className="overflow-hidden rounded-card border border-hairline bg-surface">
      <div className={small ? "p-2" : "p-4"}>
        <div className="skeleton aspect-[0.63] w-full rounded-lg" />
      </div>
      <div className={clsx("space-y-2", small ? "px-2 pb-2" : "px-3.5 pb-3")}>
        <div className="skeleton h-3 w-4/5 rounded" />
        <div className="skeleton h-3 w-2/5 rounded" />
        <div className="skeleton mt-2 h-4 w-1/3 rounded" />
      </div>
    </div>
  );
}
