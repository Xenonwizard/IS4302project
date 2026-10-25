"use client";

import clsx from "clsx";
import Image from "next/image";
import { AlertTriangle, Check, Scale } from "lucide-react";
import { usd } from "@/lib/format";
import type { ChatTradeSide } from "@/lib/types";
import {
  balance,
  slabWorth,
  statedFlag,
  statedVsMarket,
  type Balance,
  type ValueBasis,
  type ValuedSlab,
  type Verdict,
} from "@/lib/valuation";

const exact = (n: number) => usd(n, { cents: true });
const pct = (n: number) => `${Math.round(n * 100)}%`;

/**
 * "2023 Pokémon 151 #173/165 Pikachu - Illustration Rare (PSA 9 MINT)" → "Pikachu";
 * "2002 Pokémon Neo Destiny #106/105 Shining Celebi (PSA 9 MINT)" → "Shining Celebi"
 */
export function cardName(title?: string) {
  if (!title) return undefined;
  return title.match(/#\S+\s+(.+?)(?:\s+-\s|\s+\()/)?.[1] ?? title;
}

export interface SlabFace extends ValuedSlab {
  title: string;
  image: string;
  grader: string;
}

/**
 * A slab in a trade. In the builder it is a button that picks the slab, and once picked it shows the two
 * values the slab can count at so the collector chooses which one is used. In an offer it only shows the
 * value that was used.
 */
export function SlabTile({
  slab,
  selected,
  disabled,
  note,
  onClick,
  onBasis,
}: {
  slab: SlabFace;
  selected?: boolean;
  disabled?: boolean;
  note?: string;
  onClick?: () => void;
  onBasis?: (basis: ValueBasis) => void;
}) {
  const flag = statedFlag(slab);
  const face = (
    <>
      <span className="relative block h-[84px] w-[60px] shrink-0 overflow-hidden rounded-md bg-surface-2">
        {slab.image ? <Image src={slab.image} alt="" fill sizes="60px" className="object-cover" /> : null}
        {selected ? <span className="absolute inset-0 grid place-items-center bg-accent/50 text-white"><Check size={20} /></span> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-semibold text-white" title={slab.title}>
          {cardName(slab.title) ?? `Token #${slab.tokenId}`}
        </span>
        <span className="block text-[10.5px] text-dim">
          {slab.grader} · token #{slab.tokenId}
        </span>
        <span className="mt-1 block text-[11px] text-muted">
          Market <b className="text-white">{exact(slab.market)}</b>
        </span>
        <span className="block text-[11px] text-muted">
          Stated <b className="text-white">{exact(slab.stated)}</b>
        </span>
        {note ? <span className="mt-0.5 block text-[10.5px] text-warn">{note}</span> : null}
      </span>
    </>
  );
  return (
    <div className={clsx("w-[212px] rounded-xl p-1.5 text-left transition", selected ? "bg-accent/15 ring-2 ring-accent" : "bg-surface-2/60", disabled && "opacity-45")}>
      {onClick ? (
        <button type="button" disabled={disabled} onClick={onClick} aria-pressed={selected} aria-label={`${slab.title} #${slab.tokenId}`} className="flex w-full gap-2 text-left">
          {face}
        </button>
      ) : (
        <div className="flex gap-2">{face}</div>
      )}
      {selected && onBasis ? (
        <div className="mt-1.5 grid grid-cols-2 gap-1 rounded-lg bg-black/30 p-0.5" role="group" aria-label="Count this slab at">
          {(["market", "stated"] as const).map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => onBasis(b)}
              aria-pressed={slab.basis === b}
              className={clsx(
                "h-7 rounded-md text-[11px] font-bold capitalize transition",
                slab.basis === b ? "bg-accent text-white" : "text-muted hover:text-white",
              )}
            >
              {b} {exact(b === "market" ? slab.market : slab.stated)}
            </button>
          ))}
        </div>
      ) : !onBasis && !onClick ? (
        <p className="mt-1 text-[11px] text-muted">
          Counted at <b className="text-white">{slab.basis}</b> · {exact(slabWorth(slab))}
        </p>
      ) : null}
      {flag ? (
        <p className="mt-1 flex items-start gap-1 text-[10.5px] leading-snug text-warn">
          <AlertTriangle size={11} className="mt-px shrink-0" />
          Stated value is {pct(Math.abs(statedVsMarket(slab)))} {flag === "high" ? "above" : "below"} market
        </p>
      ) : null}
    </div>
  );
}

const VERDICT: Record<Verdict, { label: string; tone: string; bar: string }> = {
  fair: { label: "Fair trade", tone: "text-good", bar: "bg-good" },
  slight: { label: "Slightly uneven", tone: "text-warn", bar: "bg-warn" },
  uneven: { label: "Uneven", tone: "text-warn", bar: "bg-warn" },
  lopsided: { label: "Lopsided", tone: "text-bad", bar: "bg-bad" },
};

/**
 * What a trade comes to, from the viewer's side: what they give, what they get, who is ahead, by how
 * much, and what that looks like if every slab were counted at market or at its stated value. Nothing
 * is sent to the other side; this is only for the person looking.
 */
export function BalancePanel({
  give,
  get,
  onEvenOut,
  compact,
}: {
  give: ChatTradeSide;
  get: ChatTradeSide;
  /** in a chat: keep the headline, fold the table and notes away until asked for */
  compact?: boolean;
  /** builder only: put the missing cash on one side to square the trade */
  onEvenOut?: (side: "give" | "get", cash: number) => void;
}) {
  const asPriced = balance(give, get);
  const empty = !give.slabs.length && !get.slabs.length && !give.cash && !get.cash;
  if (empty) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-hairline bg-[#101014] p-3.5 text-[12.5px] text-muted" data-testid="trade-balance">
        <Scale size={15} /> Pick slabs or add cash and the balance appears here.
      </div>
    );
  }
  const rows: { label: string; b: Balance }[] = [
    { label: "As priced in this offer", b: asPriced },
    { label: "Everything at market", b: balance(give, get, "market") },
    { label: "Everything at stated", b: balance(give, get, "stated") },
  ];
  // Coming out ahead isn't a warning for the viewer, so it reads in the accent colour instead of red or amber.
  const v = !asPriced.against && asPriced.verdict !== "fair" ? { ...VERDICT[asPriced.verdict], tone: "text-accent", bar: "bg-accent" } : VERDICT[asPriced.verdict];
  const flagged = [...give.slabs, ...get.slabs].filter((s) => statedFlag(s));
  const headline =
    asPriced.verdict === "fair"
      ? `You give ${exact(asPriced.give)} and get ${exact(asPriced.get)}. That is within 5% either way.`
      : asPriced.against
        ? `You give ${exact(asPriced.give)} but get ${exact(asPriced.get)}: ${exact(asPriced.evenOut)} (${pct(asPriced.gap)}) in their favour.`
        : `You give ${exact(asPriced.give)} and get ${exact(asPriced.get)}: you come out ${exact(asPriced.evenOut)} (${pct(asPriced.gap)}) ahead.`;

  const detail = (
    <>
      <table className="mt-3 w-full text-[12px]">
        <thead>
          <tr className="text-left text-[10.5px] uppercase tracking-wide text-dim">
            <th className="pb-1 font-bold">Counted</th>
            <th className="pb-1 text-right font-bold">You give</th>
            <th className="pb-1 text-right font-bold">You get</th>
            <th className="pb-1 text-right font-bold">You end up</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ label, b }) => (
            <tr key={label} className="border-t border-hairline">
              <td className="py-1.5 text-muted">{label}</td>
              <td className="py-1.5 text-right">{exact(b.give)}</td>
              <td className="py-1.5 text-right">{exact(b.get)}</td>
              <td className={clsx("py-1.5 text-right font-bold", b.net === 0 ? "text-muted" : b.net > 0 ? "text-good" : b.verdict === "lopsided" || b.verdict === "uneven" ? "text-bad" : "text-warn")}>
                {b.net === 0 ? "Even" : `${b.net > 0 ? "+" : "−"}${exact(Math.abs(b.net))}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {flagged.length ? (
        <ul className="mt-2 space-y-1">
          {flagged.map((s) => (
            <li key={s.tokenId} className="flex items-start gap-1.5 text-[11.5px] leading-snug text-warn">
              <AlertTriangle size={12} className="mt-px shrink-0" />
              <span>
                {cardName(s.title)}: stated {exact(s.stated)} vs market {exact(s.market)}.
              </span>
            </li>
          ))}
        </ul>
      ) : null}

    </>
  );

  return (
    <div className="rounded-xl border border-hairline bg-[#101014] p-3.5" data-testid="trade-balance">
      <div className="flex items-center gap-2">
        <Scale size={15} className={v.tone} />
        <p className={clsx("text-[14px] font-bold", v.tone)} data-testid="trade-verdict">
          {asPriced.against || asPriced.verdict === "fair" ? v.label : `${v.label}, in your favour`}
        </p>
        <span className="ml-auto text-[12px] font-semibold text-muted" data-testid="trade-net">
          {asPriced.net === 0 ? "Even" : `${asPriced.net > 0 ? "+" : "−"}${exact(Math.abs(asPriced.net))}`}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        <div className={clsx("h-full rounded-full transition-all", v.bar)} style={{ width: `${Math.max(4, Math.min(100, Math.round(asPriced.gap * 100 * 2)))}%` }} />
      </div>
      <p className="mt-2 text-[12.5px] leading-relaxed text-muted">{headline}</p>

      {compact ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-[12px] font-semibold text-accent hover:underline">See it at market and at stated values</summary>
          {detail}
        </details>
      ) : (
        detail
      )}

      {onEvenOut && asPriced.evenOut > 0 ? (
        <button
          type="button"
          onClick={() => onEvenOut(asPriced.against ? "get" : "give", asPriced.evenOut)}
          className="mt-3 h-8 rounded-lg bg-surface-2 px-3 text-[12px] font-semibold text-white transition hover:bg-surface-3"
        >
          {asPriced.against ? `Ask for ${exact(asPriced.evenOut)} more cash to even it out` : `Add ${exact(asPriced.evenOut)} of your cash to even it out`}
        </button>
      ) : null}
    </div>
  );
}
