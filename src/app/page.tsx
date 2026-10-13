import Link from "next/link";
import { MessagesSquare, ShieldCheck, Truck } from "lucide-react";
import { HeroCarousel } from "@/components/home/HeroCarousel";
import { LiveRooms } from "@/components/home/LiveRooms";
import { Rail } from "@/components/home/Rail";
import { BRAND } from "@/lib/brand";
import { FACETS, GRAILS, LISTINGS, TRENDING } from "@/lib/catalog";

export default function HomePage() {
  const newest = [...LISTINGS]
    .sort((a, b) => Date.parse(b.listedAt) - Date.parse(a.listedAt))
    .slice(0, 12);

  return (
    <div className="space-y-8 px-4 py-5 lg:px-6">
      <HeroCarousel />

      <Rail
        title="Best deals right now"
        subtitle="Listed under our market value estimate."
        href="/marketplace?deals=1&sort=deals"
        listings={TRENDING.slice(0, 10)}
      />

      <LiveRooms />

      <Rail title="Fresh listings" href="/marketplace?sort=recent" listings={newest} />
      <Rail
        title="Grails"
        subtitle="The heaviest slabs in the vault."
        href="/marketplace?sort=price-desc"
        listings={GRAILS.slice(0, 10)}
      />

      {/* eras */}
      <section>
        <h2 className="mb-3 text-lg font-bold">Browse by era</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {FACETS.series.map(({ value, count }) => (
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
            title="Buy or trade live"
            body="Buy a slab outright, or join its trade room and bid against other collectors in real time."
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
