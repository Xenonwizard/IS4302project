"use client";

import clsx from "clsx";
import Link from "next/link";
import { Heart, ShoppingCart, Tag } from "lucide-react";
import { usd } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { Listing } from "@/lib/types";
import { Slab } from "../slab/Slab";

/**
 * Card variant used in the browse-all catalog.
 * Shows a status badge ("For sale", "Not listed", "Yours") instead of
 * assuming every card is up for sale.
 */
export function SlabCard({
  listing,
  size = "medium",
}: {
  listing: Listing;
  size?: "medium" | "small";
}) {
  const { isWatched, toggleWatch, requireAuth, isOwned, isListed } = useStore();
  const watched = isWatched(listing.id);
  const owned = isOwned(listing.id);
  const listed = isListed(listing.id);
  const small = size === "small";

  const status = owned
    ? "yours"
    : listed
    ? "sale"
    : "unlisted";

  return (
    <div className="group relative overflow-hidden rounded-card border border-hairline bg-surface transition-all duration-200 hover:-translate-y-0.5 hover:border-white/20 hover:shadow-lg motion-reduce:transition-none">
      <Link href={`/asset/${listing.id}`} className="block">
        <div className={clsx("relative bg-[#101014]", small ? "p-2" : "p-4")}>
          <Slab listing={listing} interactive maxTilt={9} />
        </div>
      </Link>

      {/* watchlist heart */}
      <button
        onClick={() => requireAuth(() => toggleWatch(listing.id)) && toggleWatch(listing.id)}
        aria-label={watched ? "Remove from watchlist" : "Add to watchlist"}
        className={clsx(
          "absolute right-2 top-2 z-10 grid h-8 w-8 place-items-center rounded-full bg-black/60 backdrop-blur transition",
          watched ? "text-bad opacity-100" : "text-white opacity-0 group-hover:opacity-100",
        )}
      >
        <Heart size={15} fill={watched ? "currentColor" : "none"} />
      </button>

      <div className={clsx(small ? "px-2 pb-2 pt-2" : "px-3.5 pb-3 pt-2.5")}>
        <Link href={`/asset/${listing.id}`}>
          <h3
            className={clsx(
              "line-clamp-2 font-semibold leading-snug hover:underline",
              small ? "text-[10.5px]" : "text-[12px]",
            )}
          >
            {listing.title}
          </h3>
        </Link>

        {/* on-chain tag */}
        {listing.tokenId && !small ? (
          <div className="mt-1 flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-md bg-accent/15 px-1.5 py-0.5 text-[10.5px] font-bold text-accent">
              <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
              On-chain #{listing.tokenId}
            </span>
          </div>
        ) : null}

        {/* status row */}
        <div className="mt-2 flex items-center justify-between gap-2">
          {status === "sale" ? (
            <>
              <span className={clsx("font-bold", small ? "text-[12px]" : "text-sm")}>
                {usd(listing.price)}
              </span>
              <span className={clsx(
                "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-bold",
                small ? "text-[9px]" : "text-[10.5px]",
                "bg-good/15 text-good",
              )}>
                <ShoppingCart size={small ? 9 : 10} />
                {!small && "For sale"}
              </span>
            </>
          ) : status === "yours" ? (
            <>
              <span className={clsx("text-muted", small ? "text-[10px]" : "text-[12px]")}>
                {listing.price > 0 ? usd(listing.price) : "Not listed"}
              </span>
              <span className={clsx(
                "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-bold",
                small ? "text-[9px]" : "text-[10.5px]",
                "bg-white/10 text-white",
              )}>
                <Tag size={small ? 9 : 10} />
                {!small && "Yours"}
              </span>
            </>
          ) : (
            <>
              <span className={clsx("text-muted", small ? "text-[10px]" : "text-[12px]")}>
                {listing.owner}
              </span>
              <span className={clsx(
                "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-bold",
                small ? "text-[9px]" : "text-[10.5px]",
                "bg-surface-3 text-muted",
              )}>
                Not listed
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function SlabCardSkeleton({ size = "medium" }: { size?: "medium" | "small" }) {
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
