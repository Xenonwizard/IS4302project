"use client";

import clsx from "clsx";
import Link from "next/link";
import { AlertTriangle, Coins, Copy, Check, ShieldAlert, Sparkles } from "lucide-react";
import { useState } from "react";
import { usd } from "@/lib/format";
import { useStore, type LostSlabItem } from "@/lib/store";
import { Slab } from "../slab/Slab";
import { Badge, Button, Modal, TimeAgo } from "../ui/primitives";

export function LostCard({
  item,
  size = "medium",
  onManageBounty,
}: {
  item: LostSlabItem;
  size?: "medium" | "small";
  onManageBounty?: (listingId: string) => void;
}) {
  const { listing, loss } = item;
  const { user, isOwned, withdrawLostForInsurance } = useStore();
  const owned = isOwned(listing.id) || (user && listing.owner.toLowerCase() === user.username.toLowerCase());
  const small = size === "small";

  const [copied, setCopied] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);

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
          <div className="absolute left-2.5 top-2.5 z-10 flex flex-wrap gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-md bg-warn/20 px-2 py-0.5 text-[10.5px] font-bold text-warn backdrop-blur-md border border-warn/30">
              <AlertTriangle size={12} className="shrink-0" />
              Reported Lost
            </span>
          </div>

          {loss.bounty ? (
            <div className="absolute right-2.5 top-2.5 z-10">
              <span className="inline-flex items-center gap-1 rounded-md bg-good/25 px-2 py-0.5 text-[11px] font-extrabold text-good shadow-lg shadow-good/10 backdrop-blur-md border border-good/40 animate-pulse">
                <Coins size={12} className="shrink-0" />
                {usd(loss.bounty.amount)} Bounty
              </span>
            </div>
          ) : null}
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
        </div>

        {/* Card Actions */}
        <div className="mt-3.5 pt-2.5 border-t border-hairline">
          {owned ? (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="flex-1 text-[11.5px]"
                onClick={() => onManageBounty?.(listing.id)}
              >
                {loss.bounty ? "Edit bounty" : "Add bounty"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-[11.5px] text-muted hover:text-bad"
                onClick={() => setWithdrawOpen(true)}
              >
                Withdraw
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Link href={lostDetailsHref} className="w-full">
                <Button size="sm" variant="outline" className="w-full text-[11.5px]">
                  View details
                </Button>
              </Link>
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
            Withdrawing removes the public listing and bounty. You can then claim insurance through the vault service provider off-chain, and the minted NFT will be retired from your active Vault.
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setWithdrawOpen(false)}>Keep listing</Button>
            <Button
              variant="danger"
              className="flex-1"
              onClick={() => {
                withdrawLostForInsurance(listing.id);
                setWithdrawOpen(false);
              }}
            >
              Withdraw and claim insurance
            </Button>
          </div>
        </div>
      </Modal>
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
