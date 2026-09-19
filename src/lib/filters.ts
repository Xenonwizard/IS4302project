import { discountPct } from "./catalog";
import type { Listing } from "./types";

export interface Filters {
  categories: string[];
  graders: string[];
  grades: string[];
  languages: string[];
  variants: string[];
  pulledFrom: string[];
  sets: string[];
  years: string[];
  priceMin: string;
  priceMax: string;
  fmvMin: string;
  fmvMax: string;
  dealsOnly: boolean;
}

export const EMPTY_FILTERS: Filters = {
  categories: [],
  graders: [],
  grades: [],
  languages: [],
  variants: [],
  pulledFrom: [],
  sets: [],
  years: [],
  priceMin: "",
  priceMax: "",
  fmvMin: "",
  fmvMax: "",
  dealsOnly: false,
};

export const SORTS = [
  { value: "recent", label: "Recently listed" },
  { value: "price-asc", label: "Price: Low to high" },
  { value: "price-desc", label: "Price: High to low" },
  { value: "added", label: "Recently added" },
  { value: "sold", label: "Recently sold" },
  { value: "deals", label: "Best deals" },
] as const;

export type SortValue = (typeof SORTS)[number]["value"];

export function activeFilterCount(f: Filters): number {
  let n = 0;
  n += f.categories.length;
  n += f.graders.length;
  n += f.grades.length;
  n += f.languages.length;
  n += f.variants.length;
  n += f.pulledFrom.length;
  n += f.sets.length;
  n += f.years.length;
  if (f.priceMin || f.priceMax) n += 1;
  if (f.fmvMin || f.fmvMax) n += 1;
  if (f.dealsOnly) n += 1;
  return n;
}

function inRange(value: number, min: string, max: string): boolean {
  const lo = min === "" ? -Infinity : Number(min);
  const hi = max === "" ? Infinity : Number(max);
  if (Number.isNaN(lo) || Number.isNaN(hi)) return true;
  return value >= lo && value <= hi;
}

export function applyFilters(
  listings: Listing[],
  filters: Filters,
  query: string,
): Listing[] {
  const q = query.trim().toLowerCase();
  const terms = q ? q.split(/\s+/) : [];

  return listings.filter((l) => {
    if (terms.length) {
      const haystack = `${l.title} ${l.subject} ${l.set} ${l.grader} ${l.category} ${l.variant} ${l.year}`.toLowerCase();
      if (!terms.every((t) => haystack.includes(t))) return false;
    }
    if (filters.categories.length && !filters.categories.includes(l.category)) return false;
    if (filters.graders.length && !filters.graders.includes(l.grader)) return false;
    if (filters.grades.length && !filters.grades.includes(String(l.grade))) return false;
    if (filters.languages.length && !filters.languages.includes(l.language)) return false;
    if (filters.variants.length && !filters.variants.includes(l.variant)) return false;
    if (filters.pulledFrom.length && !filters.pulledFrom.includes(l.pulledFrom)) return false;
    if (filters.sets.length && !filters.sets.includes(l.set)) return false;
    if (filters.years.length && !filters.years.includes(String(l.year))) return false;
    if (!inRange(l.price, filters.priceMin, filters.priceMax)) return false;
    if (!inRange(l.fmv, filters.fmvMin, filters.fmvMax)) return false;
    if (filters.dealsOnly && discountPct(l) < 5) return false;
    return true;
  });
}

export function sortListings(listings: Listing[], sort: SortValue): Listing[] {
  const out = [...listings];
  switch (sort) {
    case "price-asc":
      return out.sort((a, b) => a.price - b.price);
    case "price-desc":
      return out.sort((a, b) => b.price - a.price);
    case "deals":
      return out.sort((a, b) => discountPct(b) - discountPct(a));
    case "added":
      return out.sort(
        (a, b) =>
          Date.parse(b.activity[b.activity.length - 1]?.at ?? b.listedAt) -
          Date.parse(a.activity[a.activity.length - 1]?.at ?? a.listedAt),
      );
    case "sold": {
      const lastSale = (l: Listing) =>
        Math.max(
          0,
          ...l.activity.filter((e) => e.kind === "Sale").map((e) => Date.parse(e.at)),
        );
      return out.sort((a, b) => lastSale(b) - lastSale(a));
    }
    case "recent":
    default:
      return out.sort((a, b) => Date.parse(b.listedAt) - Date.parse(a.listedAt));
  }
}
