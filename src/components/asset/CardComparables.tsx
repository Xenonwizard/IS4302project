"use client";

import Link from "next/link";
import { useState } from "react";
import { cardGrade, matchesComparable, type CardIdentity, type GradeFilter } from "@/lib/comparables";
import { useComparables, type ComparableSlab, type ComparableTransaction } from "@/lib/chain/useComparables";
import { explorerTx, shortHash } from "@/lib/chain/config";
import { shortDate, usd } from "@/lib/format";

const exact = (value: number) => `${usd(value, { cents: true })} USDC`;

export function CardComparables({ card, tokenId, embedded = false }: { card: CardIdentity; tokenId?: string; embedded?: boolean }) {
  const [tab, setTab] = useState<"listings" | "transactions">("listings");
  const [grader, setGrader] = useState("all");
  const [grade, setGrade] = useState<GradeFilter>("all");
  const { data, isPending, isError, refetch } = useComparables();
  const matches = (s: ComparableSlab) => matchesComparable(card, s, grader, grade);
  const listings = data?.listings.filter((l) => l.slab.tokenId !== tokenId && matches(l.slab)) ?? [];
  const transactions = data?.transactions.filter((t) => [...t.give.slabs, ...t.get.slabs].some(matches)) ?? [];
  const selectClass = "min-w-0 rounded-lg border border-hairline bg-surface-2 px-2 py-2 text-[12px] text-white";

  return (
    <section id="comparables" className={embedded ? "" : "rounded-card border border-hairline bg-surface"} data-testid="card-comparables">
      {!embedded ? <div className="border-b border-hairline px-4 py-3">
        <h2 className="text-sm font-bold">Compare on Pokechain</h2>
        <p className="mt-1 text-[12px] leading-relaxed text-muted">Explore the same card across slabs. Asking prices and completed transactions help you decide what to pay.</p>
      </div> : null}
      <div className="space-y-3 p-4">
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-[11px] text-muted">Grader
            <select aria-label="Comparable grader" className={selectClass} value={grader} onChange={(e) => setGrader(e.target.value)}>
              <option value="all">All graders</option>
              {["PSA", "BGS", "CGC", "SGC"].map((g) => <option key={g}>{g}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-muted">Grade
            <select aria-label="Comparable grade" className={selectClass} value={grade} onChange={(e) => setGrade(e.target.value as GradeFilter)}>
              <option value="all">All grades</option>
              <option value="same">Same grade</option>
              <option value="nearby">Within 1 grade</option>
            </select>
          </label>
        </div>
        <div className="flex gap-1 rounded-lg bg-surface-2 p-1" role="tablist" aria-label="Comparable records">
          {([['listings', `Listings (${listings.length})`], ['transactions', `Transactions (${transactions.length})`]] as const).map(([value, label]) => (
            <button id={`comparable-tab-${value}`} aria-controls="comparable-records" role="tab" aria-selected={tab === value} key={value} onClick={() => setTab(value)} className={`flex-1 rounded-md px-2 py-2 text-[12px] font-semibold ${tab === value ? "bg-accent text-white" : "text-muted"}`}>{label}</button>
          ))}
        </div>
        <div id="comparable-records" role="tabpanel" aria-labelledby={`comparable-tab-${tab}`}>
          {isPending ? <p className="py-5 text-[12px] text-muted" role="status">Loading Pokechain records…</p> : isError ? (
            <div role="alert" className="py-3 text-[12px] text-muted">Pokechain records could not be loaded. <button className="text-accent underline" onClick={() => void refetch()}>Try again</button></div>
          ) : tab === "listings" ? listings.length ? (
            <ul className="divide-y divide-hairline">
              {listings.map((l) => (
                <li key={l.slab.tokenId} className="py-3 text-[12px]">
                  <div className="flex justify-between gap-2"><SlabLink slab={l.slab} /><strong className="shrink-0">{exact(l.price)}</strong></div>
                  <p className="mt-1 text-[11px] text-muted">Asking · @{l.sellerHandle || shortHash(l.seller)} · {shortDate(new Date(l.at).toISOString())}</p>
                </li>
              ))}
            </ul>
          ) : <Empty text="No other listings match this card and these filters." /> : transactions.length ? (
            <ul className="divide-y divide-hairline">
              {transactions.map((t) => <Transaction key={t.id} transaction={t} />)}
            </ul>
          ) : <Empty text="No completed Pokechain transactions match this card and these filters." />}
        </div>
        <p className="text-[11px] leading-relaxed text-dim">Asks are set by sellers. Transactions show the amounts and slabs exchanged; swap cash is for the whole trade. No estimated card values are assigned.</p>
      </div>
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-5 text-center text-[12px] leading-relaxed text-muted">{text}</p>;
}

function SlabLink({ slab }: { slab: ComparableSlab }) {
  const grade = cardGrade(slab);
  const name = slab.title.replace(/^.*?#\S+\s+/, "").replace(/\s+\((?:PSA|BGS|CGC|SGC)\s+.*$/i, "").split(" - ")[0];
  return <Link href={`/asset/token-${slab.tokenId}`} title={slab.title} className="font-semibold text-accent hover:underline">{name} · {slab.grader}{grade === null ? " · grade unavailable" : ` ${grade}`} · #{slab.tokenId}</Link>;
}

function Transaction({ transaction: t }: { transaction: ComparableTransaction }) {
  const explorer = explorerTx(t.hash);
  return (
    <li className="space-y-2 py-3 text-[12px]">
      <div className="flex items-center justify-between gap-2"><strong>{t.kind === "sale" ? "Cash sale" : "Slab trade"}</strong><span className="text-[11px] text-muted">{shortDate(new Date(t.at).toISOString())}</span></div>
      {t.kind === "sale" ? <div className="flex justify-between gap-2"><SlabLink slab={t.give.slabs[0]} /><strong>{exact(t.get.cash)}</strong></div> : (
        <div className="space-y-2 rounded-lg bg-surface-2 p-2">
          {[{ side: t.give, wallet: t.from }, { side: t.get, wallet: t.to }].map(({ side, wallet }) => (
            <div key={wallet} className="space-y-1"><p className="text-[11px] text-muted">{shortHash(wallet)} gave</p><div className="flex flex-wrap gap-2">{side.slabs.map((s) => <SlabLink key={s.tokenId} slab={s} />)}{side.cash > 0 ? <span>{exact(side.cash)}</span> : null}</div></div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-muted">{t.kind === "sale" ? `Seller ${shortHash(t.from)} → buyer ${shortHash(t.to)}` : "Both sides settled together"}</p>
      <details className="text-[11px] text-dim"><summary className="cursor-pointer">Transaction {shortHash(t.hash)}</summary>{explorer ? <a href={explorer} target="_blank" rel="noreferrer" className="break-all text-accent underline">View transaction</a> : <code className="block break-all pt-1">{t.hash}</code>}</details>
    </li>
  );
}
