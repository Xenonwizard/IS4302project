"use client";

import clsx from "clsx";
import Link from "next/link";
import { Heart, ShoppingCart } from "lucide-react";
import { discountPct } from "@/lib/catalog";
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
  const { addToCart, cart, isWatched, toggleWatch, requireAuth } = useStore();
  const off = discountPct(listing);
  const inCart = cart.includes(listing.id);
  const watched = isWatched(listing.id);

  return (
    <div className="group relative overflow-hidden rounded-card border border-hairline bg-surface transition hover:border-white/20">
      <Link href={`/asset/${listing.id}`} className="block">
        <div className="relative bg-[#101014] p-4">
          {off >= 5 ? (
            <span className="absolute left-2.5 top-2.5 z-10 rounded-md bg-good-bg px-2 py-1 text-[11px] font-bold text-good backdrop-blur">
              {off}% off
            </span>
          ) : null}
          <Slab listing={listing} />
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
        <div className="mt-2.5 flex items-center justify-between gap-2">
          <span className={clsx("font-bold", dense ? "text-sm" : "text-[15px]")}>
            {usd(listing.price)}
          </span>
          <span className="shrink-0 whitespace-nowrap rounded-md bg-surface-2 px-2 py-1 text-[11px] font-semibold text-muted">
            FMV {usd(listing.fmv)}
          </span>
        </div>
      </div>

      <div className="absolute inset-x-3.5 bottom-3.5 translate-y-3 opacity-0 transition group-hover:translate-y-0 group-hover:opacity-100">
        <button
          onClick={() => !inCart && addToCart(listing.id)}
          className={clsx(
            "flex h-9 w-full items-center justify-center gap-1.5 rounded-xl text-[13px] font-bold transition",
            inCart ? "bg-surface-3 text-muted" : "bg-accent text-white hover:bg-accent-hover",
          )}
        >
          <ShoppingCart size={14} />
          {inCart ? "In cart" : "Add to cart"}
        </button>
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
