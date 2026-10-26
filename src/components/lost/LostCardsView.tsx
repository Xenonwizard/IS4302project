"use client";

import clsx from "clsx";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Coins,
  Grid2x2,
  Grid3x3,
  Search,
  ShieldAlert,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { usd } from "@/lib/format";
import { useLostSlabs, useStore } from "@/lib/store";
import { Button, Modal, inputClass } from "../ui/primitives";
import { Select } from "../ui/Select";
import { LostCard } from "./LostCard";

const BOUNTY_FILTERS = [
  { value: "all", label: "All lost slabs" },
  { value: "bounty", label: "With bounty ($)" },
  { value: "nobounty", label: "No bounty" },
] as const;

type BountyFilter = (typeof BOUNTY_FILTERS)[number]["value"];

const GRADER_FILTERS = [
  { value: "all", label: "All graders" },
  { value: "PSA", label: "PSA" },
  { value: "CGC", label: "CGC" },
  { value: "BGS", label: "BGS" },
  { value: "SGC", label: "SGC" },
] as const;

const SORTS = [
  { value: "bounty-desc", label: "Highest bounty" },
  { value: "recent", label: "Recently reported" },
  { value: "name", label: "Card name (A–Z)" },
] as const;

type SortValue = (typeof SORTS)[number]["value"];

export function LostCardsView() {
  const params = useSearchParams();
  const router = useRouter();
  const lostSlabs = useLostSlabs();
  const { setVaultBounty, cancelVaultBounty } = useStore();

  const [query, setQuery] = useState(params.get("q") ?? "");
  const [bountyFilter, setBountyFilter] = useState<BountyFilter>(
    () => (params.get("bounty") as BountyFilter) ?? "all",
  );
  const [graderFilter, setGraderFilter] = useState<string>(
    () => params.get("grader") ?? "all",
  );
  const [sort, setSort] = useState<SortValue>(() => {
    const fromUrl = params.get("sort");
    return SORTS.find((s) => s.value === fromUrl)?.value ?? "bounty-desc";
  });
  const [gridSize, setGridSize] = useState<"medium" | "small">("medium");

  // Bounty modal state for owners
  const [bountyTargetId, setBountyTargetId] = useState<string | null>(null);
  const [bountyInput, setBountyInput] = useState<string>("");

  const activeBountyTarget = useMemo(() => {
    if (!bountyTargetId) return null;
    return lostSlabs.find((s) => s.listing.id === bountyTargetId) ?? null;
  }, [bountyTargetId, lostSlabs]);

  // Keep URL updated
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (window.location.pathname !== "/lost") return;
    const next = new URLSearchParams();
    if (query.trim()) next.set("q", query.trim());
    if (bountyFilter !== "all") next.set("bounty", bountyFilter);
    if (graderFilter !== "all") next.set("grader", graderFilter);
    if (sort !== "bounty-desc") next.set("sort", sort);
    const qs = next.toString();
    const target = qs ? `/lost?${qs}` : "/lost";
    if (window.location.pathname + window.location.search === target) return;
    router.replace(target, { scroll: false });
  }, [query, bountyFilter, graderFilter, sort, router]);

  // Filter & Sort
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const terms = q ? q.split(/\s+/) : [];

    let pool = lostSlabs.filter(({ listing, loss }) => {
        // Search public card metadata and loss details; owner identity is private.
      if (terms.length) {
          const haystack = `${listing.title} ${listing.subject} ${listing.set} ${listing.certNumber} ${loss.details}`.toLowerCase();
        if (!terms.every((t) => haystack.includes(t))) return false;
      }
      // Bounty filter
      if (bountyFilter === "bounty" && (!loss.bounty || loss.bounty.amount <= 0)) return false;
      if (bountyFilter === "nobounty" && loss.bounty && loss.bounty.amount > 0) return false;
      // Grader filter
      if (graderFilter !== "all" && listing.grader !== graderFilter) return false;
      return true;
    });

    return pool.sort((a, b) => {
      if (sort === "bounty-desc") {
        const bBounty = b.loss.bounty?.amount ?? 0;
        const aBounty = a.loss.bounty?.amount ?? 0;
        if (bBounty !== aBounty) return bBounty - aBounty;
        return Date.parse(b.loss.reportedAt) - Date.parse(a.loss.reportedAt);
      }
      if (sort === "recent") {
        return Date.parse(b.loss.reportedAt) - Date.parse(a.loss.reportedAt);
      }
      if (sort === "name") {
        return a.listing.title.localeCompare(b.listing.title);
      }
      return 0;
    });
  }, [lostSlabs, query, bountyFilter, graderFilter, sort]);

  // Stats
  const totalBounties = useMemo(() => {
    return lostSlabs.reduce((sum, s) => sum + (s.loss.bounty?.amount ?? 0), 0);
  }, [lostSlabs]);

  const countWithBounty = useMemo(() => {
    return lostSlabs.filter((s) => s.loss.bounty && s.loss.bounty.amount > 0).length;
  }, [lostSlabs]);

  return (
    <div className="px-4 py-4 lg:px-6 lg:py-6">
      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-2xl border border-warn/25 bg-gradient-to-r from-warn/10 via-surface to-surface p-5 lg:p-6 mb-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-warn/20 text-warn">
                <ShieldAlert size={19} />
              </span>
              <h1 className="text-xl font-bold text-white tracking-tight sm:text-2xl">
                Lost &amp; Missing Slabs
              </h1>
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
              Registry of physical slabs currently reported missing from the vault or in transit.
                If you locate a card, use its details to help Pokechain verify and recover it; active bounties remain visible.
            </p>
          </div>

          {/* Quick Metrics */}
          <div className="flex shrink-0 flex-wrap items-center gap-3">
            <div className="rounded-xl border border-hairline bg-surface-2 px-4 py-2.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                Reported Lost
              </span>
              <p className="mt-0.5 text-xl font-extrabold text-warn">
                {lostSlabs.length}
              </p>
            </div>

            <div className="rounded-xl border border-hairline bg-surface-2 px-4 py-2.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                Active Bounties
              </span>
              <p className="mt-0.5 text-xl font-extrabold text-good flex items-center gap-1.5">
                <Coins size={16} />
                {usd(totalBounties)} PokeCredits
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Grid size toggle */}
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

        {/* Bounty filter */}
        <Select
          value={bountyFilter}
          options={BOUNTY_FILTERS}
          onChange={(v) => setBountyFilter(v)}
          className="w-[155px]"
        />

        {/* Grader filter */}
        <Select
          value={graderFilter}
          options={GRADER_FILTERS}
          onChange={(v) => setGraderFilter(v)}
          className="w-[130px]"
        />

        {/* Search Input */}
        <div className="relative min-w-[200px] flex-1">
          <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-dim" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by card, cert #, notes..."
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

        {/* Sort */}
        <Select value={sort} options={SORTS} onChange={setSort} className="w-[170px]" />
      </div>

      {/* Results Count & Notice */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted">
        <p>
          Showing <span className="font-semibold text-white">{filtered.length}</span> card{filtered.length === 1 ? "" : "s"} listed as lost
          {query.trim() ? <> matching &ldquo;{query.trim()}&rdquo;</> : null}
          {bountyFilter === "bounty" ? <> with active bounties</> : null}
        </p>
        <span className="text-[12px] text-dim">
          Looking to report a missing card? Open your <Link href="/vault" className="text-accent underline-offset-2 hover:underline">Vault</Link>.
        </span>
      </div>

      {/* Grid of Lost Cards */}
      {filtered.length ? (
        <div
          className={clsx(
            "mt-4 grid gap-3",
            gridSize === "small"
              ? "grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-9"
              : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-7",
          )}
        >
          {filtered.map((item, index) => {
            const shouldAnimate = index < 12;
            return (
            <div
              key={item.listing.id}
              className={clsx("min-w-0", shouldAnimate && "fade-up motion-reduce:animate-none")}
              style={shouldAnimate ? { animationDelay: `${index * 22}ms` } : undefined}
            >
              <LostCard
                item={item}
                size={gridSize}
                onManageBounty={(id) => {
                  setBountyTargetId(id);
                  setBountyInput(String(item.loss.bounty?.amount ?? 100));
                }}
              />
            </div>
            );
          })}
        </div>
      ) : (
        /* Empty State */
        <div className="mt-16 flex flex-col items-center gap-4 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-2xl border border-hairline bg-surface-2 text-muted">
            <ShieldAlert size={28} />
          </div>
          <p className="text-lg font-bold text-white">No lost cards match your search</p>
          <p className="max-w-sm text-sm text-muted">
            {lostSlabs.length === 0
              ? "No slabs are currently reported lost across Pokechain."
              : "Try adjusting your search terms or clearing the bounty/grader filters."}
          </p>
          <div className="flex gap-2.5">
            {query || bountyFilter !== "all" || graderFilter !== "all" ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setQuery("");
                  setBountyFilter("all");
                  setGraderFilter("all");
                }}
              >
                Reset filters
              </Button>
            ) : null}
            <Link href="/vault">
              <Button variant="outline">
                Check your Vault
              </Button>
            </Link>
          </div>
        </div>
      )}

      {/* Bounty Edit Modal */}
      {activeBountyTarget ? (
        <Modal
          open={Boolean(activeBountyTarget)}
          onClose={() => setBountyTargetId(null)}
          title={`Recovery bounty for ${activeBountyTarget.listing.shortName}`}
          width="max-w-sm"
        >
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Offer a PokeCredit reward to community members or courier agents who help locate this slab.
            </p>
            <div>
              <label className="text-[12px] font-semibold text-muted">Bounty amount (PokeCredits)</label>
              <input
                type="number"
                min="5"
                step="5"
                value={bountyInput}
                onChange={(e) => setBountyInput(e.target.value)}
                placeholder="e.g. 150"
                className={`${inputClass} mt-1 w-full`}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setBountyTargetId(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  const val = parseFloat(bountyInput);
                  if (Number.isFinite(val) && val > 0) {
                    setVaultBounty(activeBountyTarget.listing.id, val);
                    setBountyTargetId(null);
                  }
                }}
              >
                Save bounty
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
