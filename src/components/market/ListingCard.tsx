"use client";

import clsx from "clsx";
import Link from "next/link";
import { Heart } from "lucide-react";
import { usd } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { Listing } from "@/lib/types";
import { Slab } from "../slab/Slab";

export function ListingCard({
  listing,
  dense = false,
}: {
  listing: Listing;
  dense?: boolean;
}) {
  const { isWatched, toggleWatch, requireAuth } = useStore();
  const watched = isWatched(listing.id);

  return (
    <div className="group relative overflow-hidden rounded-card border border-hairline bg-surface transition hover:border-white/20">
      <Link href={`/asset/${listing.id}`} className="block">
        <div className="relative bg-[#101014] p-4">
          <Slab listing={listing} interactive maxTilt={9} />
        </div>
      </Link>

      <button
        onClick={() => requireAuth(() => toggleWatch(listing.id)) && toggleWatch(listing.id)}
        aria-label={watched ? "Remove from watchlist" : "Add to watchlist"}
        className={clsx(
          "absolute right-2.5 top-2.5 z-10 grid h-8 w-8 place-items-center rounded-full bg-black/60 backdrop-blur transition",
          watched ? "text-bad opacity-100" : "text-white opacity-0 group-hover:opacity-100",
        )}
      >
        <Heart size={15} fill={watched ? "currentColor" : "none"} />
      </button>

      <div className={clsx("px-3.5", dense ? "pb-3 pt-2.5" : "pb-4 pt-3")}>
        <Link href={`/asset/${listing.id}`}>
          <h3
            className={clsx(
              "line-clamp-2 font-semibold leading-snug hover:underline",
              dense ? "text-[12px]" : "text-[13px]",
            )}
          >
            {listing.title}
          </h3>
        </Link>
        {listing.tokenId ? (
          <div className="mt-1.5 flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-md bg-accent/15 px-1.5 py-0.5 text-[10.5px] font-bold text-accent">
              <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
              On-chain #{listing.tokenId}
            </span>
          </div>
        ) : null}
        <div className="mt-2.5 flex items-center justify-between gap-2">
          <span className={clsx("font-bold", dense ? "text-sm" : "text-[15px]")}>
            {usd(listing.price)}
          </span>
          <span className="text-[11px] text-muted">Asking price</span>
        </div>
      </div>
    </div>
  );
}

export function ListingCardSkeleton({ dense = false }: { dense?: boolean }) {
  return (
    <div className="overflow-hidden rounded-card border border-hairline bg-surface">
      <div className="p-4">
        <div className="skeleton aspect-[0.63] w-full rounded-lg" />
      </div>
      <div className={clsx("space-y-2 px-3.5", dense ? "pb-3" : "pb-4")}>
        <div className="skeleton h-3 w-4/5 rounded" />
        <div className="skeleton h-3 w-2/5 rounded" />
        <div className="skeleton mt-2 h-4 w-1/3 rounded" />
      </div>
    </div>
  );
}
