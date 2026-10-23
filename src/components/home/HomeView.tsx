"use client";

import Link from "next/link";
import { MessagesSquare, ShieldCheck, Truck } from "lucide-react";
import { useMemo } from "react";
import { HeroCarousel } from "@/components/home/HeroCarousel";
import { HomeLiveActivity } from "@/components/home/HomeLiveActivity";
import { Rail } from "@/components/home/Rail";
import { BRAND } from "@/lib/brand";
import { useMarketInventory } from "@/lib/store";

export function HomeView() {
  const inventory = useMarketInventory();

  const newest = useMemo(
    () =>
      [...inventory]
        .sort((a, b) => (Date.parse(b.listedAt) || 0) - (Date.parse(a.listedAt) || 0))
        .slice(0, 12),
    [inventory],
  );

  const highestValue = useMemo(
    () => [...inventory].sort((a, b) => b.price - a.price).slice(0, 10),
    [inventory],
  );

  const mostWatched = useMemo(() => {
    return [...inventory]
      .sort((a, b) => (b.likes || 0) + (b.offers?.length || 0) * 10 - ((a.likes || 0) + (a.offers?.length || 0) * 10))
      .slice(0, 10);
  }, [inventory]);

  const eraFacets = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of inventory) {
      if (l.series) counts.set(l.series, (counts.get(l.series) || 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count);
  }, [inventory]);

  return (
    <div className="space-y-8 px-4 py-5 lg:px-6">
      <HeroCarousel listings={highestValue} />

      <HomeLiveActivity />

      <Rail
        title="Most watched"
        subtitle="The slabs collectors are hearting and bidding on."
        href="/marketplace"
        listings={mostWatched}
      />

      <Rail title="Fresh listings" href="/marketplace?sort=recent" listings={newest} />

      <Rail
        title="Highest value"
        subtitle="The most valuable slabs on the marketplace."
        href="/marketplace?sort=price-desc"
        listings={highestValue}
      />

      {/* eras */}
      <section>
        <h2 className="mb-3 text-lg font-bold">Browse by era</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {eraFacets.map(({ value, count }) => (
            <Link
              key={value}
              href={`/marketplace?era=${encodeURIComponent(value)}`}
              className="rounded-card border border-hairline bg-surface p-4 transition hover:border-white/20 hover:bg-surface-2"
            >
              <p className="text-sm font-bold">{value}</p>
              <p className="mt-1 text-[12px] text-muted">{count} slabs</p>
            </Link>
          ))}
        </div>
      </section>

      {/* how it works */}
      <section className="rounded-card border border-hairline bg-surface p-6">
        <h2 className="text-lg font-bold">How {BRAND.name} works</h2>
        <div className="mt-5 grid gap-6 sm:grid-cols-3">
          <Step
            icon={<MessagesSquare size={20} />}
            title="Make an offer, then negotiate"
            body="Offer full cash or trade your slabs plus cash. Each offer opens a private chat with the seller, who accepts or declines."
          />
          <Step
            icon={<ShieldCheck size={20} />}
            title="Vaulted and insured"
            body={`The physical slab sits in our ${BRAND.vaultCity} vault. Ownership is an ERC-721 token on ${BRAND.chain}.`}
          />
          <Step
            icon={<Truck size={20} />}
            title="Sell or ship"
            body="Relist instantly with zero shipping risk, or redeem the token and have the slab couriered to you."
          />
        </div>
      </section>

      <footer className="border-t border-hairline pt-6 pb-4 text-[12px] text-dim">
        <p>
          {BRAND.name} is a non-commercial school project built for a blockchain module. Card
          images and data come from the Pokémon TCG API (pokemontcg.io); Pokémon and its card
          art belong to Nintendo, Creatures Inc. and GAME FREAK. Owners, listings, bids and sales
          are generated dummy data.
        </p>
      </footer>
    </div>
  );
}

function Step({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div>
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent/15 text-accent">
        {icon}
      </span>
      <p className="mt-3 text-sm font-bold">{title}</p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{body}</p>
    </div>
  );
}
