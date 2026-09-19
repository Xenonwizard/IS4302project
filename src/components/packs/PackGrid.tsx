"use client";

import Link from "next/link";
import { useState } from "react";
import clsx from "clsx";
import { PACKS, PACK_GROUPS } from "@/lib/catalog";
import { usd } from "@/lib/format";
import { PackVisual } from "./PackVisual";

export function PackGrid() {
  const [group, setGroup] = useState<string>(PACK_GROUPS[0]);
  const visible = PACKS.filter((p) => p.group === group);

  return (
    <div>
      <div className="no-scrollbar flex gap-1 overflow-x-auto border-b border-hairline">
        {PACK_GROUPS.map((g) => (
          <button
            key={g}
            onClick={() => setGroup(g)}
            className={clsx(
              "relative shrink-0 px-4 py-3 text-[13px] font-bold transition",
              group === g ? "text-white" : "text-muted hover:text-white",
            )}
          >
            {g}
            {group === g ? (
              <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-accent" />
            ) : null}
          </button>
        ))}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
        {visible.map((p) => (
          <Link
            key={p.slug}
            href={`/packs/${p.slug}`}
            className="group overflow-hidden rounded-card border border-hairline bg-surface transition hover:border-white/20"
          >
            <div className="p-3">
              <PackVisual pack={p} className="aspect-[0.72] w-full transition group-hover:scale-[1.02]" />
            </div>
            <div className="px-3.5 pb-4">
              <p className="truncate text-[13px] font-bold">{p.name}</p>
              <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-muted">{p.tagline}</p>
              <div className="mt-2.5 flex items-center justify-between">
                <span className="text-[15px] font-bold">{usd(p.price)}</span>
                <span className="rounded-md bg-surface-2 px-2 py-1 text-[11px] font-semibold text-muted">
                  1 slab
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
