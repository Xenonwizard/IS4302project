import Link from "next/link";
import { ListingCard } from "../market/ListingCard";
import type { Listing } from "@/lib/types";

export function Rail({
  title,
  subtitle,
  href,
  listings,
}: {
  title: string;
  subtitle?: string;
  href: string;
  listings: Listing[];
}) {
  return (
    <section>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p> : null}
        </div>
        <Link href={href} className="shrink-0 text-[13px] font-semibold text-accent hover:underline">
          See all →
        </Link>
      </div>
      <div className="cy-scroll -mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
        {listings.map((l) => (
          <div key={l.id} className="w-[210px] shrink-0">
            <ListingCard listing={l} />
          </div>
        ))}
      </div>
    </section>
  );
}
