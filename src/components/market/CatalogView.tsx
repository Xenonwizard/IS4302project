"use client";

import clsx from "clsx";
import { useRouter, useSearchParams } from "next/navigation";
import { Grid2x2, Grid3x3, Search, SlidersHorizontal, X } from "lucide-react";
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
import { useAllSlabs } from "@/lib/store";
import { Button, inputClass } from "../ui/primitives";
import { Select } from "../ui/Select";
import { FilterDrawer } from "./FilterDrawer";
import { SlabCard } from "./SlabCard";

const PAGE_SIZES = [
  { value: "24", label: "24 Items" },
  { value: "48", label: "48 Items" },
  { value: "96", label: "96 Items" },
] as const;

const STATUS_OPTIONS = [
  { value: "all", label: "All slabs" },
  { value: "listed", label: "For sale" },
  { value: "unlisted", label: "Not listed" },
] as const;

type StatusFilter = (typeof STATUS_OPTIONS)[number]["value"];

export function CatalogView() {
  const params = useSearchParams();
  const router = useRouter();
  const all = useAllSlabs();

  const [query, setQuery] = useState(params.get("q") ?? "");
  const [sort, setSort] = useState<SortValue>(() => {
    const fromUrl = params.get("sort");
    return SORTS.find((s) => s.value === fromUrl)?.value ?? "recent";
  });
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(
    () => (params.get("status") as StatusFilter) ?? "all",
  );
  const [pageSize, setPageSize] = useState<"24" | "48" | "96">("48");
  const [gridSize, setGridSize] = useState<"medium" | "small">("medium");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<Filters>(() => {
    const era = params.get("era");
    const grader = params.get("grader");
    return { ...EMPTY_FILTERS, series: era ? [era] : [], graders: grader ? [grader] : [] };
  });
  const [page, setPage] = useState<{ sig: string; count: number }>({
    sig: "",
    count: Number(pageSize),
  });

  // Keep URL shareable
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    if (window.location.pathname !== "/catalog") return;
    const next = new URLSearchParams();
    if (query.trim()) next.set("q", query.trim());
    if (sort !== "recent") next.set("sort", sort);
    if (statusFilter !== "all") next.set("status", statusFilter);
    if (filters.series.length === 1) next.set("era", filters.series[0]);
    const qs = next.toString();
    const target = qs ? `/catalog?${qs}` : "/catalog";
    if (window.location.pathname + window.location.search === target) return;
    router.replace(target, { scroll: false });
  }, [query, sort, statusFilter, filters.series, router]);

  const filtered = useMemo(() => {
    let pool = sortListings(applyFilters(all, filters, query), sort);
    if (statusFilter === "listed") pool = pool.filter((l) => l.price > 0 && l.isListed !== false);
    if (statusFilter === "unlisted") pool = pool.filter((l) => !(l.price > 0));
    return pool;
  }, [all, filters, query, sort, statusFilter]);

  const signature = `${pageSize}|${query}|${sort}|${statusFilter}|${JSON.stringify(filters)}`;
  const visible = page.sig === signature ? page.count : Number(pageSize);
  const shown = filtered.slice(0, visible);
  const activeCount = activeFilterCount(filters);
  const animationStart = page.sig === signature ? Math.max(0, page.count - Number(pageSize)) : 0;

  return (
    <div className="px-4 py-4 lg:px-6 lg:py-5">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {/* grid size toggle */}
        <div className="flex h-10 items-center rounded-xl border border-hairline bg-surface p-1">
          <button
            onClick={() => setGridSize("medium")}
            aria-label="Medium grid"
            aria-pressed={gridSize === "medium"}
            title="Medium grid"
            className={clsx(
              "grid h-8 w-8 place-items-center rounded-lg transition",
              gridSize === "medium" ? "bg-surface-3 text-white" : "text-muted hover:text-white",
            )}
          >
            <Grid2x2 size={15} />
          </button>
          <button
            onClick={() => setGridSize("small")}
            aria-label="Small grid"
            aria-pressed={gridSize === "small"}
            title="Small grid"
            className={clsx(
              "grid h-8 w-8 place-items-center rounded-lg transition",
              gridSize === "small" ? "bg-surface-3 text-white" : "text-muted hover:text-white",
            )}
          >
            <Grid3x3 size={15} />
          </button>
        </div>

        <Select value={pageSize} options={PAGE_SIZES} onChange={(v) => setPageSize(v)} className="w-[118px]" align="left" />

        {/* status filter */}
        <Select
          value={statusFilter}
          options={STATUS_OPTIONS}
          onChange={(v) => setStatusFilter(v)}
          className="w-[140px]"
        />

        {/* search */}
        <div className="relative min-w-[180px] flex-1">
          <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-dim" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search all slabs…"
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

      {/* count */}
      <p className="mt-4 text-[13px] text-muted">
        {filtered.length.toLocaleString()} slab{filtered.length === 1 ? "" : "s"}
        {query.trim() ? <> for &ldquo;{query.trim()}&rdquo;</> : null}
        {statusFilter !== "all" ? (
          <> &middot; <span className="text-white">{STATUS_OPTIONS.find((o) => o.value === statusFilter)?.label}</span></>
        ) : null}
      </p>

      {/* legend */}
      <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-good" />
          For sale
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-white/30" />
          Not listed
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-white" />
          Yours
        </span>
      </div>

      {/* grid */}
      {shown.length ? (
        <div
          className={clsx(
            "mt-3 grid gap-3",
            gridSize === "small"
              ? "grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-9"
              : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-7",
          )}
        >
          {shown.map((l, index) => {
            const shouldAnimate = index >= animationStart && index < animationStart + 12;
            return (
              <div
                key={l.id}
                className={clsx("min-w-0", shouldAnimate && "fade-up motion-reduce:animate-none")}
                style={shouldAnimate ? { animationDelay: `${(index - animationStart) * 22}ms` } : undefined}
              >
                <SlabCard listing={l} size={gridSize} />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-16 flex flex-col items-center gap-4 text-center">
          <p className="text-lg font-bold">No slabs match those filters</p>
          <p className="max-w-sm text-sm text-muted">
            Try widening your search, changing the status filter, or clearing a grade filter.
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              setFilters(EMPTY_FILTERS);
              setQuery("");
              setStatusFilter("all");
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
  const listKeys: (keyof Filters)[] = ["series", "grades", "graders", "variants", "sets", "years"];
  for (const key of listKeys) {
    const values = f[key] as string[];
    for (const v of values) {
      chips.push({
        key: `${key}:${v}`,
        label: key === "grades" ? `Grade ${v}` : v,
        remove: (prev) => ({ ...prev, [key]: (prev[key] as string[]).filter((x) => x !== v) }),
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
  return chips;
}
