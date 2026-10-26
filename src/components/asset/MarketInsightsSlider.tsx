"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Listing } from "@/lib/types";
import { CardComparables } from "./CardComparables";
import { GradedCardPricing } from "./GradedCardPricing";

type View = "pricing" | "pokechain";

export function MarketInsightsSlider({ card, tokenId }: { card: Listing; tokenId?: string }) {
  const [view, setView] = useState<View>("pricing");
  const pricing = view === "pricing";

  return (
    <section className="overflow-hidden rounded-card border border-hairline bg-surface" aria-label="Market insights">
      <div className="border-b border-hairline px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold">Market insights</h2>
            <p className="mt-1 text-[12px] text-muted">{pricing ? `Live graded sales · matched to ${card.grader} ${card.grade}` : "Listings and completed transactions on Pokechain"}</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" aria-label="Previous insight" onClick={() => setView(pricing ? "pokechain" : "pricing")} className="grid h-8 w-8 place-items-center rounded-lg border border-hairline text-muted transition hover:text-white"><ChevronLeft size={15} /></button>
            <span className="min-w-10 text-center text-[10.5px] font-semibold text-muted">{pricing ? "1 / 2" : "2 / 2"}</span>
            <button type="button" aria-label="Next insight" onClick={() => setView(pricing ? "pokechain" : "pricing")} className="grid h-8 w-8 place-items-center rounded-lg border border-hairline text-muted transition hover:text-white"><ChevronRight size={15} /></button>
          </div>
        </div>
        <div className="relative mt-3 grid grid-cols-2 gap-1 rounded-lg bg-surface-2 p-1" role="tablist" aria-label="Market insight view">
          <span
            aria-hidden="true"
            className="absolute left-1 top-1 h-[calc(100%_-_8px)] rounded-md bg-accent shadow-sm transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
            style={{ width: "calc(50% - 6px)", transform: `translateX(${pricing ? "0" : "calc(100% + 4px)"})` }}
          />
          <button type="button" role="tab" aria-selected={pricing} onClick={() => setView("pricing")} className={`relative z-10 rounded-md px-3 py-2 text-[11px] font-semibold transition-colors duration-300 ${pricing ? "text-white" : "text-muted hover:text-white"}`}>Live graded pricing</button>
          <button type="button" role="tab" aria-selected={!pricing} onClick={() => setView("pokechain")} className={`relative z-10 rounded-md px-3 py-2 text-[11px] font-semibold transition-colors duration-300 ${!pricing ? "text-white" : "text-muted hover:text-white"}`}>Compare on Pokechain</button>
        </div>
      </div>

      <div className="overflow-hidden">
        <div className="flex items-start will-change-transform transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none" style={{ transform: `translateX(${pricing ? "0%" : "-100%"})` }}>
          <div className="min-w-full" role="tabpanel" aria-hidden={!pricing}>
            <GradedCardPricing card={card} embedded />
          </div>
          <div className="min-w-full" role="tabpanel" aria-hidden={pricing}>
            <CardComparables card={card} tokenId={tokenId} embedded />
          </div>
        </div>
      </div>
    </section>
  );
}
