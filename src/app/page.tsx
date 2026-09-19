import Link from "next/link";
import { PackageOpen, ShieldCheck, Truck } from "lucide-react";
import { HeroCarousel } from "@/components/home/HeroCarousel";
import { JustPulled } from "@/components/home/JustPulled";
import { Rail } from "@/components/home/Rail";
import { BRAND } from "@/lib/brand";
import { GRAILS, LISTINGS, PACKS, TRENDING } from "@/lib/catalog";
import { CATEGORIES } from "@/lib/pools";
import { usd } from "@/lib/format";

export default function HomePage() {
  const newest = [...LISTINGS]
    .sort((a, b) => Date.parse(b.listedAt) - Date.parse(a.listedAt))
    .slice(0, 12);

  return (
    <div className="space-y-8 px-4 py-5 lg:px-6">
      <HeroCarousel />
      <JustPulled />

      <Rail
        title="Best deals right now"
        subtitle="Listed under our market value estimate."
        href="/marketplace?deals=1&sort=deals"
        listings={TRENDING.slice(0, 10)}
      />

      {/* packs strip */}
      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Open a pack</h2>
            <p className="mt-0.5 text-[13px] text-muted">
              Every pack pays out a graded slab. Nothing raw, nothing hidden.
            </p>
          </div>
          <Link href="/packs" className="shrink-0 text-[13px] font-semibold text-accent hover:underline">
            All packs →
          </Link>
        </div>
        <div className="cy-scroll -mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
          {PACKS.slice(0, 7).map((p) => (
            <Link
              key={p.slug}
              href={`/packs/${p.slug}`}
              className="group w-[190px] shrink-0 overflow-hidden rounded-card border border-hairline bg-surface transition hover:border-white/20"
            >
              <div
                className="flex h-[150px] items-end p-4"
                style={{
                  background: `linear-gradient(150deg, hsl(${p.hueA} 62% 32%), hsl(${p.hueB} 58% 14%))`,
                }}
              >
                <PackageOpen size={30} className="text-white/80 transition group-hover:scale-110" />
              </div>
              <div className="p-3.5">
                <p className="truncate text-[13px] font-bold">{p.name}</p>
                <p className="mt-0.5 truncate text-[12px] text-muted">{p.group}</p>
                <p className="mt-2 text-sm font-bold">{usd(p.price)}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <Rail title="Fresh listings" href="/marketplace?sort=recent" listings={newest} />
      <Rail
        title="Grails"
        subtitle="The heaviest slabs in the vault."
        href="/marketplace?sort=price-desc"
        listings={GRAILS.slice(0, 10)}
      />

      {/* categories */}
      <section>
        <h2 className="mb-3 text-lg font-bold">Browse by category</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {CATEGORIES.map((c) => {
            const count = LISTINGS.filter((l) => l.category === c).length;
            return (
              <Link
                key={c}
                href={`/marketplace?category=${encodeURIComponent(c)}`}
                className="rounded-card border border-hairline bg-surface p-4 transition hover:border-white/20 hover:bg-surface-2"
              >
                <p className="text-sm font-bold">{c}</p>
                <p className="mt-1 text-[12px] text-muted">{count} listings</p>
              </Link>
            );
          })}
        </div>
      </section>

      {/* how it works */}
      <section className="rounded-card border border-hairline bg-surface p-6">
        <h2 className="text-lg font-bold">How {BRAND.name} works</h2>
        <div className="mt-5 grid gap-6 sm:grid-cols-3">
          <Step
            icon={<PackageOpen size={20} />}
            title="Rip or buy"
            body="Open a pack for a random graded slab, or buy a specific one outright on the marketplace."
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
          {BRAND.name} is a portfolio project built for a blockchain module. All listings, prices,
          users and sales on this site are generated dummy data.
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
