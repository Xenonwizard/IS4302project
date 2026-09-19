"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { JUST_PULLED, LISTINGS, getListing } from "@/lib/catalog";
import { HANDLES } from "@/lib/pools";
import { useStore } from "@/lib/store";
import { Avatar, TimeAgo } from "../ui/primitives";
import { Slab } from "../slab/Slab";
import type { Pull } from "@/lib/types";

export function JustPulled() {
  const { ready } = useStore();
  const [feed, setFeed] = useState<Pull[]>(JUST_PULLED);

  useEffect(() => {
    if (!ready) return;
    const t = window.setInterval(() => {
      const listing = LISTINGS[Math.floor(Math.random() * LISTINGS.length)];
      setFeed((prev) =>
        [
          {
            id: `live-${Date.now()}`,
            listingId: listing.id,
            user: HANDLES[Math.floor(Math.random() * HANDLES.length)],
            pack: listing.pulledFrom,
            at: Date.now(),
          },
          ...prev,
        ].slice(0, 30),
      );
    }, 7000);
    return () => window.clearInterval(t);
  }, [ready]);

  return (
    <section>
      <div className="mb-3 flex items-end justify-between gap-3">
        <h2 className="flex items-center gap-2.5 text-lg font-bold">
          Just pulled
          <span className="flex items-center gap-1.5 rounded-full bg-good-bg px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-good">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-good" />
            Live
          </span>
        </h2>
        <Link href="/packs" className="text-[13px] font-semibold text-accent hover:underline">
          Grab a pack →
        </Link>
      </div>

      <div className="cy-scroll -mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
        {feed.map((pull) => {
          const listing = getListing(pull.listingId);
          if (!listing) return null;
          return (
            <Link
              key={pull.id}
              href={`/asset/${listing.id}`}
              className="fade-up w-[150px] shrink-0 rounded-card border border-hairline bg-surface p-2.5 transition hover:border-white/20"
            >
              <div className="rounded-lg bg-[#101014] p-2">
                <Slab listing={listing} />
              </div>
              <p className="mt-2 line-clamp-2 text-[11px] font-semibold leading-snug">
                {listing.shortName} · {listing.grader} {listing.grade}
              </p>
              <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted">
                <Avatar name={pull.user} size={14} />
                <span className="truncate">{pull.user}</span>
              </p>
              <p className="mt-1 truncate text-[11px] text-dim">{pull.pack}</p>
              <p className="text-[11px] text-dim">
                <TimeAgo value={pull.at} />
              </p>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
