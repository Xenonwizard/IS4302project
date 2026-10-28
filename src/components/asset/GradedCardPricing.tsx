"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { usd } from "@/lib/format";
import type { Listing } from "@/lib/types";
import { Button } from "../ui/primitives";

type GradePrice = {
  label: string;
  value: number;
  medianPrice?: number;
  averagePrice?: number;
  confidence?: string;
  count: number;
  lastSaleDate?: string;
  matchesSlab: boolean;
};

type PricingResponse = {
  data?: {
    productId: string;
    productName: string;
    category: string;
    sourceUrl: string;
    prices: GradePrice[];
  };
  error?: string;
  setupRequired?: boolean;
};

class PricingError extends Error {
  setupRequired: boolean;

  constructor(message: string, setupRequired = false) {
    super(message);
    this.setupRequired = setupRequired;
  }
}

const money = (value: number) => new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
}).format(value);

const date = (value?: string) => value
  ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(value))
  : "Not available";

/** One cached pricing lookup per card and grade, shared by the asset page and every price line. */
function useGradedPricing(card: Listing) {
  return useQuery({
    queryKey: ["graded-card-pricing", card.subject, card.set, card.cardNumber, card.grader, card.grade, card.gradeLabel],
    staleTime: 24 * 60 * 60 * 1000,
    retry: false,
    queryFn: async () => {
      const params = new URLSearchParams({
        subject: card.subject,
        set: card.set,
        cardNumber: card.cardNumber,
        grader: card.grader,
        grade: String(card.grade),
        gradeLabel: card.gradeLabel,
      });
      const response = await fetch(`/api/pricing/graded?${params}`);
      const body = await response.json() as PricingResponse;
      if (!response.ok || !body.data) {
        throw new PricingError(body.error || "Graded pricing is unavailable.", Boolean(body.setupRequired));
      }
      return body.data;
    },
  });
}

/** Market estimate for this exact grade from recent graded sales, shown under a seller's ask. */
export function MarketPriceLine({ card, className }: { card: Listing; className?: string }) {
  const query = useGradedPricing(card);
  const matched = query.data?.prices.find((price) => price.matchesSlab);
  const value = query.isPending ? "…" : matched ? usd(matched.value, { cents: true }) : "No data";
  const hint = matched
    ? `Recent ${card.grader} ${card.grade} sales (${matched.count} tracked), via PokémonPriceTracker`
    : query.error?.message ?? `No recent ${card.grader} ${card.grade} sales found`;
  return <p className={className} title={hint}>Market price {value}</p>;
}

export function GradedCardPricing({ card, embedded = false }: { card: Listing; embedded?: boolean }) {
  const query = useGradedPricing(card);

  const matchedPrice = query.data?.prices.find((price) => price.matchesSlab);
  const error = query.error instanceof PricingError ? query.error : null;

  return (
    <section className={embedded ? "" : "rounded-card border border-hairline bg-surface"}>
      {!embedded ? <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-4 py-3">
        <div>
          <h2 className="text-sm font-bold">Live graded-slab pricing</h2>
          <p className="mt-1 text-[12px] text-muted">Recent graded sales · matched to {card.grader} {card.grade}</p>
        </div>
        {query.isFetching ? <RefreshCw size={15} className="animate-spin text-muted" /> : null}
      </div> : null}

      <div className="p-4">
        {query.isPending ? (
          <p className="py-4 text-[12px] text-muted">Finding graded market data…</p>
        ) : query.isError ? (
          <div className="rounded-xl border border-hairline bg-surface-2 p-4">
            <p className="text-[12px] font-semibold">{error?.setupRequired ? "Connect a graded-pricing provider" : "Graded pricing unavailable"}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted">{query.error.message}</p>
            {!error?.setupRequired ? <Button className="mt-3" size="sm" variant="outline" onClick={() => void query.refetch()}>Try again</Button> : null}
          </div>
        ) : query.data ? (
          <div className="space-y-4">
            {!matchedPrice ? (
              <p className="rounded-xl border border-hairline bg-surface-2 p-3 text-[11px] text-muted">The provider matched this card, but does not currently publish a value for {card.grader} {card.grade}.</p>
            ) : null}

            {query.data.prices.length ? <GradePriceHistory prices={query.data.prices} card={card} /> : null}

            <p className="text-[10.5px] leading-relaxed text-dim">Prices use recent graded sales from PokémonPriceTracker&apos;s free tier and are not guaranteed sale prices. Card identity is checked against its card number.</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function GradePriceHistory({ prices, card }: { prices: GradePrice[]; card: Listing }) {
  const graders = ["PSA", "CGC", "BGS", "SGC"].filter((grader) => prices.some((price) => price.label.startsWith(`${grader} `)));
  const initialGrader = graders.includes(card.grader) ? card.grader : graders[0];
  const initialGrades = prices.filter((price) => price.label.startsWith(`${initialGrader} `));
  const initialPrice = initialGrades.find((price) => price.matchesSlab) ?? initialGrades.at(-1)!;
  const [selection, setSelection] = useState({ grader: initialGrader, label: initialPrice.label });

  const graderPrices = prices
    .filter((price) => price.label.startsWith(`${selection.grader} `))
    .sort((left, right) => Number(left.label.slice(selection.grader.length + 1)) - Number(right.label.slice(selection.grader.length + 1)));
  const selectedPrice = graderPrices.find((price) => price.label === selection.label) ?? graderPrices.at(-1)!;

  const chooseGrader = (grader: string) => {
    const available = prices
      .filter((price) => price.label.startsWith(`${grader} `))
      .sort((left, right) => Number(left.label.slice(grader.length + 1)) - Number(right.label.slice(grader.length + 1)));
    const sameGrade = available.find((price) => Number(price.label.slice(grader.length + 1)) === card.grade);
    setSelection({ grader, label: (sameGrade ?? available.at(-1)!).label });
  };

  const rows = [
    { label: "Market estimate", value: money(selectedPrice.value), prominent: true },
    selectedPrice.medianPrice != null ? { label: "Median recorded sale", value: money(selectedPrice.medianPrice) } : null,
    selectedPrice.averagePrice != null ? { label: "Average recorded sale", value: money(selectedPrice.averagePrice) } : null,
    { label: "Sales tracked", value: selectedPrice.count.toLocaleString("en-US") },
    { label: "Latest recorded sale", value: date(selectedPrice.lastSaleDate) },
  ].filter((row): row is { label: string; value: string; prominent?: boolean } => Boolean(row));

  return (
    <div>
      <div className="rounded-xl border border-hairline bg-surface-2 p-3 sm:p-4">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Grading company">
          {graders.map((grader) => (
            <button key={grader} type="button" role="tab" aria-selected={selection.grader === grader} onClick={() => chooseGrader(grader)} className={`min-w-16 rounded-lg border px-4 py-2 text-[11px] font-bold transition ${selection.grader === grader ? "border-accent bg-accent text-white" : "border-hairline bg-surface text-muted hover:text-white"}`}>
              {grader}
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap gap-2" aria-label={`${selection.grader} grades`}>
          {graderPrices.map((price) => {
            const grade = price.label.slice(selection.grader.length + 1);
            return (
              <button key={price.label} type="button" aria-pressed={selectedPrice.label === price.label} onClick={() => setSelection({ grader: selection.grader, label: price.label })} className={`min-w-16 rounded-lg border px-3 py-2 text-[11px] font-bold transition ${selectedPrice.label === price.label ? "border-accent bg-accent text-white" : "border-hairline bg-surface text-muted hover:text-white"}`}>
                {grade}
              </button>
            );
          })}
        </div>

        <div className="mt-5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline pb-3">
            <p className="text-[12px] font-bold">{selectedPrice.label}</p>
            <p className="text-[10.5px] text-muted">Aggregated recent sales</p>
          </div>
          <dl className="divide-y divide-hairline">
            {rows.map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-4 py-3 text-[11px]">
                <dt className="text-muted">{row.label}</dt>
                <dd className={row.prominent ? "text-[13px] font-bold text-white" : "font-semibold text-white"}>{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}
