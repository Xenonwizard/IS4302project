"use client";

import clsx from "clsx";
import { ChevronRight, Search } from "lucide-react";
import { useState } from "react";
import { FACETS } from "@/lib/catalog";
import { EMPTY_FILTERS, type Filters, activeFilterCount } from "@/lib/filters";
import { Button, Drawer, inputClass } from "../ui/primitives";

type ListKey = "series" | "graders" | "grades" | "variants" | "sets" | "years";

const GROUPS: {
  key: ListKey;
  label: string;
  facet: { value: string; count: number }[];
  searchable?: boolean;
}[] = [
  { key: "series", label: "Era", facet: FACETS.series },
  { key: "grades", label: "Grade", facet: FACETS.grade },
  { key: "graders", label: "Grader", facet: FACETS.grader },
  { key: "variants", label: "Rarity", facet: FACETS.variant, searchable: true },
  { key: "sets", label: "Set", facet: FACETS.set, searchable: true },
  { key: "years", label: "Year", facet: FACETS.year, searchable: true },
];

export function FilterDrawer({
  open,
  onClose,
  filters,
  setFilters,
  resultCount,
}: {
  open: boolean;
  onClose: () => void;
  filters: Filters;
  setFilters: (next: Filters) => void;
  resultCount: number;
}) {
  const [expanded, setExpanded] = useState<string | null>("Era");

  const toggle = (key: ListKey, value: string) => {
    const current = filters[key];
    setFilters({
      ...filters,
      [key]: current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value],
    });
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Filter listings${activeFilterCount(filters) ? ` (${activeFilterCount(filters)})` : ""}`}
      footer={
        <Button size="lg" className="w-full" onClick={onClose}>
          Show {resultCount.toLocaleString()} result{resultCount === 1 ? "" : "s"}
        </Button>
      }
    >
      <div className="flex items-center justify-end border-b border-hairline px-5 py-3">
        <button
          onClick={() =>
            setFilters(EMPTY_FILTERS)
          }
          className="text-[11px] font-bold uppercase tracking-wider text-muted transition hover:text-white"
        >
          Reset
        </button>
      </div>

      <Range
        label="Asking price"
        min={filters.priceMin}
        max={filters.priceMax}
        onChange={(min, max) => setFilters({ ...filters, priceMin: min, priceMax: max })}
        expanded={expanded === "price"}
        onToggle={() => setExpanded(expanded === "price" ? null : "price")}
      />

      {GROUPS.map((g) => (
        <Group
          key={g.key}
          label={g.label}
          count={filters[g.key].length}
          expanded={expanded === g.label}
          onToggle={() => setExpanded(expanded === g.label ? null : g.label)}
        >
          <CheckList
            options={g.facet}
            selected={filters[g.key]}
            onToggle={(v) => toggle(g.key, v)}
            searchable={g.searchable}
          />
        </Group>
      ))}
    </Drawer>
  );
}

function Group({
  label,
  count,
  expanded,
  onToggle,
  children,
}: {
  label: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-hairline">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between px-5 py-4 text-left text-sm font-semibold transition hover:bg-white/[0.03]"
      >
        <span className="flex items-center gap-2">
          {label}
          {count ? (
            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1.5 text-[10px] font-bold text-white">
              {count}
            </span>
          ) : null}
        </span>
        <ChevronRight size={16} className={clsx("text-muted transition-transform duration-200", expanded && "rotate-90")} />
      </button>
      {expanded ? <div className="fade-up px-5 pb-4 motion-reduce:animate-none">{children}</div> : null}
    </section>
  );
}

function Range({
  label,
  min,
  max,
  onChange,
  expanded,
  onToggle,
}: {
  label: string;
  min: string;
  max: string;
  onChange: (min: string, max: string) => void;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <Group label={label} count={min || max ? 1 : 0} expanded={expanded} onToggle={onToggle}>
      <div className="flex items-center gap-2">
        <input
          className={inputClass}
          inputMode="decimal"
          placeholder="Min"
          value={min}
          onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""), max)}
        />
        <span className="text-dim">–</span>
        <input
          className={inputClass}
          inputMode="decimal"
          placeholder="Max"
          value={max}
          onChange={(e) => onChange(min, e.target.value.replace(/[^\d.]/g, ""))}
        />
      </div>
    </Group>
  );
}

function CheckList({
  options,
  selected,
  onToggle,
  searchable,
}: {
  options: { value: string; count: number }[];
  selected: string[];
  onToggle: (value: string) => void;
  searchable?: boolean;
}) {
  const [q, setQ] = useState("");
  const visible = q
    ? options.filter((o) => o.value.toLowerCase().includes(q.toLowerCase()))
    : options;

  return (
    <div>
      {searchable ? (
        <div className="relative mb-3">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-dim" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search"
            className={`${inputClass} h-9 pl-9 text-[13px]`}
          />
        </div>
      ) : null}
      <ul className="cy-scroll max-h-64 space-y-0.5 overflow-y-auto pr-1">
        {visible.map((o) => (
          <li key={o.value}>
            <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-[13px] transition hover:bg-white/5">
              <input
                type="checkbox"
                checked={selected.includes(o.value)}
                onChange={() => onToggle(o.value)}
                className="h-4 w-4 accent-[#2f5bf9]"
              />
              <span className="min-w-0 flex-1 truncate">{o.value}</span>
              <span className="shrink-0 text-[11px] text-dim">{o.count}</span>
            </label>
          </li>
        ))}
        {!visible.length ? <li className="px-2 py-3 text-[13px] text-dim">No matches.</li> : null}
      </ul>
    </div>
  );
}
