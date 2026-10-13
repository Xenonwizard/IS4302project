"use client";

import Link from "next/link";
import { Users } from "lucide-react";
import { usd } from "@/lib/format";
import { useStore } from "@/lib/store";
import { bidValue, bidders, topBid } from "@/lib/trade";
import type { Listing } from "@/lib/types";
import { Slab } from "../slab/Slab";

/** Card linking into a slab's trade room, with live numbers once the room exists. */
export function RoomCard({ listing: base }: { listing: Listing }) {
  const { trades, resolve } = useStore();
  const listing = resolve(base);
  const room = trades[listing.id];
  const top = room ? topBid(room) : undefined;
  const topValue = top?.bid ? bidValue(top.bid) : (listing.offers[0]?.amount ?? 0);
  const people = room ? bidders(room).length : listing.offers.length;

  return (
    <Link
      href={`/trades/${listing.id}`}
      className="group flex gap-3 rounded-card border border-hairline bg-surface p-3 transition hover:border-white/20 hover:bg-surface-2"
    >
      <span className="w-16 shrink-0">
        <Slab listing={listing} flat />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-good">
          <span className="h-1.5 w-1.5 rounded-full bg-good" />
          {room?.status === "settled" ? "Settled" : "Live"}
        </span>
        <span className="mt-1 line-clamp-2 block text-[13px] font-semibold leading-snug group-hover:underline">
          {listing.shortName} · {listing.grader} {listing.grade}
        </span>
        <span className="mt-0.5 block truncate text-[12px] text-muted">{listing.set}</span>
        <span className="mt-2 flex items-center justify-between gap-2 text-[12px]">
          <span className="text-muted">
            Top bid <b className="text-white">{topValue ? usd(topValue) : "—"}</b>
          </span>
          <span className="flex items-center gap-1 text-dim">
            <Users size={12} />
            {people}
          </span>
        </span>
      </span>
    </Link>
  );
}
