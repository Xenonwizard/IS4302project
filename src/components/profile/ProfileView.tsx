"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ListingCard } from "@/components/market/ListingCard";
import { Avatar, Badge, TimeAgo } from "@/components/ui/primitives";
import { usd } from "@/lib/format";
import { useMarketInventory, useStore } from "@/lib/store";

export function ProfileView({ username }: { username: string }) {
  const { slabs, ready } = useStore();
  const inventory = useMarketInventory();

  const userLower = username.toLowerCase();

  const owned = useMemo(() => {
    // Slabs listed by this user or in inventory with this owner
    return inventory.filter(
      (l) => l.owner.toLowerCase() === userLower || l.ownerAddress?.toLowerCase() === userLower,
    );
  }, [inventory, userLower]);

  const value = useMemo(() => owned.reduce((sum, l) => sum + l.price, 0), [owned]);

  const recent = useMemo(() => {
    return slabs
      .flatMap((l) =>
        (l.activity || [])
          .filter(
            (a) =>
              a.from.toLowerCase() === userLower || a.to.toLowerCase() === userLower,
          )
          .map((a) => ({ listing: l, event: a })),
      )
      .sort((a, b) => Date.parse(b.event.at) - Date.parse(a.event.at))
      .slice(0, 10);
  }, [slabs, userLower]);

  if (!ready) {
    return (
      <div className="px-4 py-6 lg:px-6">
        <div className="skeleton h-32 rounded-card" />
      </div>
    );
  }

  return (
    <div className="px-4 py-6 lg:px-6">
      <div className="flex flex-wrap items-center gap-4">
        <Avatar name={username} size={64} className="ring-2 ring-white/10" />
        <div className="min-w-0">
          <h1 className="truncate text-[22px] font-bold">{username}</h1>
          <p className="mt-1 text-[13px] text-muted">
            {owned.length} slab{owned.length === 1 ? "" : "s"} listed · {usd(value)} listed value
          </p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Listings" value={String(owned.length)} />
        <Stat label="Listed value" value={usd(value)} />
        <Stat
          label="Highest ask"
          value={owned.length ? usd(Math.max(...owned.map((l) => l.price))) : "—"}
        />
        <Stat label="Status" value="Verified collector" />
      </div>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-bold">Listed by {username}</h2>
        {owned.length ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
            {owned.map((l) => (
              <ListingCard key={l.id} listing={l} size="medium" />
            ))}
          </div>
        ) : (
          <p className="rounded-card border border-dashed border-hairline py-12 text-center text-[13px] text-muted">
            Nothing listed right now.
          </p>
        )}
      </section>

      {recent.length ? (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-bold">Recent activity</h2>
          <ul className="divide-y divide-[rgba(255,255,255,0.08)] overflow-hidden rounded-card border border-hairline bg-surface">
            {recent.map(({ listing, event }, i) => (
              <li key={`${event.txHash}-${i}`} className="flex items-center gap-4 p-4">
                <Badge tone={event.kind === "Sale" ? "good" : "neutral"}>{event.kind}</Badge>
                <Link
                  href={`/asset/${listing.id}`}
                  className="min-w-0 flex-1 truncate text-[13px] font-semibold hover:underline"
                >
                  {listing.title}
                </Link>
                <span className="shrink-0 text-[13px] font-semibold">
                  {event.price ? usd(event.price) : "—"}
                </span>
                <span className="hidden shrink-0 text-[12px] text-dim sm:block">
                  <TimeAgo value={event.at} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-hairline bg-surface p-4">
      <p className="text-[11px] font-bold uppercase tracking-wide text-dim">{label}</p>
      <p className="mt-1.5 text-lg font-bold">{value}</p>
    </div>
  );
}

