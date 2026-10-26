"use client";

import clsx from "clsx";
import Image from "next/image";
import Link from "next/link";
import { Check } from "lucide-react";
import { usd } from "@/lib/format";
import type { ChatTradeSide, ChatTradeSlab } from "@/lib/types";

const exact = (n: number) => usd(n, { cents: true });

export function cardName(title?: string) {
  if (!title) return undefined;
  return title.match(/#\S+\s+(.+?)(?:\s+-\s|\s+\()/)?.[1] ?? title;
}

export function SlabTile({ slab, selected, disabled, note, onClick }: {
  slab: Pick<ChatTradeSlab, "tokenId" | "title" | "image" | "grader" | "stated">;
  selected?: boolean;
  disabled?: boolean;
  note?: string;
  onClick?: () => void;
}) {
  const face = <>
    <span className="relative block h-[84px] w-[60px] shrink-0 overflow-hidden rounded-md bg-surface-2">
      {slab.image ? <Image src={slab.image} alt="" fill sizes="60px" className="object-cover" /> : null}
      {selected ? <span className="absolute inset-0 grid place-items-center bg-accent/50 text-white"><Check size={20} /></span> : null}
    </span>
    <span className="min-w-0 flex-1">
      <span className="block truncate text-[12px] font-semibold text-white" title={slab.title}>{cardName(slab.title) ?? `Token #${slab.tokenId}`}</span>
      <span className="block text-[10.5px] text-dim">{slab.grader} · token #{slab.tokenId}</span>
      <span className="mt-1 block text-[11px] text-muted">{slab.stated != null ? `Seller ask ${exact(slab.stated)}` : "Not listed"}</span>
      {note ? <span className="mt-0.5 block text-[10.5px] text-warn">{note}</span> : null}
    </span>
  </>;
  return (
    <div className={clsx("w-[212px] rounded-xl p-1.5 text-left transition", selected ? "bg-accent/15 ring-2 ring-accent" : "bg-surface-2/60", disabled && "opacity-45")}>
      {onClick ? <button type="button" disabled={disabled} onClick={onClick} aria-pressed={selected} aria-label={`${slab.title} #${slab.tokenId}`} className="flex w-full gap-2 text-left">{face}</button> : <div className="flex gap-2">{face}</div>}
      <Link href={`/asset/token-${slab.tokenId}#comparables`} target="_blank" rel="noreferrer" className="mt-2 block text-[11px] font-semibold text-accent hover:underline">Compare listings &amp; transactions ↗</Link>
    </div>
  );
}

/** Present exactly what changes hands, without assigning dollar values to slabs. */
export function BalancePanel({ give, get }: { give: ChatTradeSide; get: ChatTradeSide; compact?: boolean }) {
  return (
    <div className="rounded-xl border border-hairline bg-[#101014] p-3.5" data-testid="trade-terms">
      <p className="text-[13px] font-bold">Trade terms</p>
      <dl className="mt-2 space-y-2 text-[12px]">
        {[{ label: "You give", side: give }, { label: "You get", side: get }].map(({ label, side }) => (
          <div key={label} className="flex justify-between gap-2"><dt className="text-muted">{label}</dt><dd>{side.slabs.length} slab{side.slabs.length === 1 ? "" : "s"} + {exact(side.cash)} USDC</dd></div>
        ))}
      </dl>
      <p className="mt-3 text-[11px] leading-relaxed text-dim">Compare the records for each card and agree on the terms together. Seller asking prices are references, not assigned trade values.</p>
    </div>
  );
}
