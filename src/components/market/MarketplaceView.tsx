"use client";

import clsx from "clsx";
import { useRouter, useSearchParams } from "next/navigation";
import { Grid2x2, LayoutGrid, Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  EMPTY_FILTERS,
  type Filters,
  SORTS,
  type SortValue,
  activeFilterCount,
  applyFilters,
  sortListings,
} from "@/lib/filters";
import { useMarketInventory } from "@/lib/store";
import { Button, inputClass } from "../ui/primitives";
import { Select } from "../ui/Select";
import { FilterDrawer } from "./FilterDrawer";
import { ListingCard } from "./ListingCard";

const PAGE_SIZES = [
  { value: "24", label: "24 Items" },
  { value: "48", label: "48 Items" },
  { value: "96", label: "96 Items" },
] as const;

export function MarketplaceView() {
  const params = useSearchParams();
  const router = useRouter();
  const inventory = useMarketInventory();

  const [query, setQuery] = useState(params.get("q") ?? "");
  const [sort, setSort] = useState<SortValue>((params.get("sort") as SortValue) ?? "recent");
  const [pageSize, setPageSize] = useState<"24" | "48" | "96">("48");
  const [dense, setDense] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<Filters>(() => {
    const category = params.get("category");
    const grader = params.get("grader");
    return {
      ...EMPTY_FILTERS,
      categories: category ? [category] : [],
      graders: grader ? [grader] : [],
      dealsOnly: params.get("deals") === "1",
    };
  });
  const [page, setPage] = useState<{ sig: string; count: number }>({
    sig: "",
    count: Number(pageSize),
  });

  // Keep the URL shareable, but never fight a navigation away from this page.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (window.location.pathname !== "/marketplace") return;
    const next = new URLSearchParams();
    if (query.trim()) next.set("q", query.trim());
    if (sort !== "recent") next.set("sort", sort);
    if (filters.categories.length === 1) next.set("category", filters.categories[0]);
    if (filters.dealsOnly) next.set("deals", "1");
    const qs = next.toString();
    const target = qs ? `/marketplace?${qs}` : "/marketplace";
    if (window.location.pathname + window.location.search === target) return;
    router.replace(target, { scroll: false });
  }, [query, sort, filters.categories, filters.dealsOnly, router]);

  const filtered = useMemo(
    () => sortListings(applyFilters(inventory, filters, query), sort),
    [inventory, filters, query, sort],
  );

  // Paging resets whenever the query that produced it changes — derived, not synced.
  const signature = `${pageSize}|${query}|${sort}|${JSON.stringify(filters)}`;
  const visible = page.sig === signature ? page.count : Number(pageSize);

  const shown = filtered.slice(0, visible);
  const activeCount = activeFilterCount(filters);

  return (
    <div className="px-4 py-4 lg:px-6 lg:py-5">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex h-10 items-center rounded-xl border border-hairline bg-surface p-1">
          <button
            onClick={() => setDense(false)}
            aria-label="Comfortable grid"
            className={clsx(
              "grid h-8 w-8 place-items-center rounded-lg transition",
              !dense ? "bg-surface-3 text-white" : "text-muted hover:text-white",
            )}
          >
            <LayoutGrid size={15} />
          </button>
          <button
            onClick={() => setDense(true)}
            aria-label="Dense grid"
            className={clsx(
              "grid h-8 w-8 place-items-center rounded-lg transition",
              dense ? "bg-surface-3 text-white" : "text-muted hover:text-white",
            )}
          >
            <Grid2x2 size={15} />
          </button>
        </div>

        <Select
          value={pageSize}
          options={PAGE_SIZES}
          onChange={(v) => setPageSize(v)}
          className="w-[118px]"
          align="left"
        />

        <div className="relative min-w-[180px] flex-1">
          <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-dim" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search listings"
            className={`${inputClass} h-10 pl-10 pr-9`}
          />
          {query ? (
            <button
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-dim hover:text-white"
            >
              <X size={14} />
            </button>
          ) : null}
        </div>

        <Select value={sort} options={SORTS} onChange={setSort} className="w-[168px]" />

        <button
          onClick={() => setFiltersOpen(true)}
          className="relative grid h-10 w-10 place-items-center rounded-xl border border-hairline bg-surface text-muted transition hover:bg-surface-2 hover:text-white"
          aria-label="Filters"
        >
          <SlidersHorizontal size={16} />
          {activeCount ? (
            <span className="absolute -right-1 -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">
              {activeCount}
            </span>
          ) : null}
        </button>
      </div>

      {/* active filter chips */}
      {activeCount ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {chipList(filters).map((chip) => (
            <button
              key={chip.key}
              onClick={() => setFilters(chip.remove(filters))}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-surface-2 px-2.5 text-[12px] font-semibold text-white transition hover:bg-surface-3"
            >
              {chip.label}
              <X size={13} className="text-muted" />
            </button>
          ))}
          <button
            onClick={() => setFilters(EMPTY_FILTERS)}
            className="h-8 px-2 text-[12px] font-bold uppercase tracking-wide text-muted transition hover:text-white"
          >
            Clear all
          </button>
        </div>
      ) : null}

      <p className="mt-4 text-[13px] text-muted">
        {filtered.length.toLocaleString()} listing{filtered.length === 1 ? "" : "s"}
        {query.trim() ? <> for “{query.trim()}”</> : null}
      </p>

      {/* grid */}
      {shown.length ? (
        <div
          className={clsx(
            "mt-3 grid gap-3",
            dense
              ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-7"
              : "grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-5",
          )}
        >
          {shown.map((l) => (
            <ListingCard key={l.id} listing={l} dense={dense} />
          ))}
        </div>
      ) : (
        <div className="mt-16 flex flex-col items-center gap-4 text-center">
          <p className="text-lg font-bold">No slabs match those filters</p>
          <p className="max-w-sm text-sm text-muted">
            Try widening the price range or clearing a grade filter.
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              setFilters(EMPTY_FILTERS);
              setQuery("");
            }}
          >
            Reset everything
          </Button>
        </div>
      )}

      {visible < filtered.length ? (
        <div className="mt-8 flex justify-center">
          <Button
            variant="secondary"
            size="lg"
            onClick={() => setPage({ sig: signature, count: visible + Number(pageSize) })}
          >
            Load {Math.min(Number(pageSize), filtered.length - visible)} more
          </Button>
        </div>
      ) : null}

      <FilterDrawer
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        filters={filters}
        setFilters={setFilters}
        resultCount={filtered.length}
      />
    </div>
  );
}

type Chip = { key: string; label: string; remove: (f: Filters) => Filters };

function chipList(f: Filters): Chip[] {
  const chips: Chip[] = [];
  const listKeys: (keyof Filters)[] = [
    "categories",
    "grades",
    "graders",
    "languages",
    "variants",
    "pulledFrom",
    "sets",
    "years",
  ];
  for (const key of listKeys) {
    const values = f[key] as string[];
    for (const v of values) {
      chips.push({
        key: `${key}:${v}`,
        label: key === "grades" ? `Grade ${v}` : v,
        remove: (prev) => ({
          ...prev,
          [key]: (prev[key] as string[]).filter((x) => x !== v),
        }),
      });
    }
  }
  if (f.priceMin || f.priceMax) {
    chips.push({
      key: "price",
      label: `Price ${f.priceMin || "0"}–${f.priceMax || "∞"}`,
      remove: (prev) => ({ ...prev, priceMin: "", priceMax: "" }),
    });
  }
  if (f.fmvMin || f.fmvMax) {
    chips.push({
      key: "fmv",
      label: `FMV ${f.fmvMin || "0"}–${f.fmvMax || "∞"}`,
      remove: (prev) => ({ ...prev, fmvMin: "", fmvMax: "" }),
    });
  }
  if (f.dealsOnly) {
    chips.push({
      key: "deals",
      label: "Deals only",
      remove: (prev) => ({ ...prev, dealsOnly: false }),
    });
  }
  return chips;
}
