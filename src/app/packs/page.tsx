import Link from "next/link";
import { PackGrid } from "@/components/packs/PackGrid";
import { EVENTS } from "@/lib/catalog";
import { Countdown } from "@/components/ui/primitives";

export const metadata = { title: "Packs" };

export default function PacksPage() {
  return (
    <div className="px-4 py-5 lg:px-6">
      <div className="relative overflow-hidden rounded-card border border-hairline bg-[linear-gradient(120deg,#101a3a,#0a0a12_60%,#05050a)] p-6 sm:p-8">
        <h1 className="text-[26px] font-bold leading-tight sm:text-[34px]">
          Every pack is a graded slab
        </h1>
        <p className="mt-2 max-w-xl text-[15px] text-white/70">
          Pick a pool, rip it, and the slab lands in your vault as an ERC-721 token. Relist it in
          one click or have the physical card shipped to you.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          {EVENTS.slice(0, 3).map((e) => (
            <Link
              key={e.slug}
              href={`/events/${e.slug}`}
              className="rounded-xl border border-hairline bg-black/40 px-4 py-3 backdrop-blur transition hover:border-white/25"
            >
              <p className="text-[13px] font-bold">{e.name}</p>
              <p className="mt-0.5 text-[11px] text-muted">
                Ends in <Countdown to={e.endsAt} />
              </p>
            </Link>
          ))}
        </div>
      </div>

      <div className="mt-6">
        <PackGrid />
      </div>
    </div>
  );
}
