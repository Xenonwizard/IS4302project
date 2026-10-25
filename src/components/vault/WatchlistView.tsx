"use client";

import clsx from "clsx";
import { Grid2x2, Grid3x3, Heart } from "lucide-react";
import { useState } from "react";
import { getListing } from "@/lib/catalog";
import { useStore } from "@/lib/store";
import { ListingCard } from "../market/ListingCard";
import { Empty, LoginPrompt } from "./shared";

/** Slabs the user hearted, to keep an eye on. */
export function WatchlistView() {
  const { user, ready, watchlist, resolve } = useStore();
  const [gridSize, setGridSize] = useState<"medium" | "small">("medium");

  if (!ready) {
    return (
      <div className="space-y-4 px-4 py-5 lg:px-6">
        <div className="skeleton h-10 w-48 rounded-xl" />
        <div className="skeleton h-32 w-full rounded-2xl" />
      </div>
    );
  }

  if (!user) {
    return (
      <LoginPrompt
        icon={<Heart size={26} />}
        title="Watchlist"
        body="Log in to keep track of the slabs you have hearted."
      />
    );
  }

  return (
    <div className="px-4 py-5 lg:px-6">
      <h1 className="text-[24px] font-bold">Watchlist</h1>
      <p className="mt-1 text-[13px] text-muted">Slabs you hearted on the marketplace.</p>

      <div className="mt-5">
        {watchlist.length ? (
          <>
            <div className="mb-3 flex justify-end">
              <div
                className="flex h-10 items-center rounded-xl border border-hairline bg-surface p-1"
                role="group"
                aria-label="Watchlist grid size"
              >
                <button
                  type="button"
                  onClick={() => setGridSize("medium")}
                  aria-label="Medium grid"
                  aria-pressed={gridSize === "medium"}
                  title="Medium grid"
                  className={clsx(
                    "grid h-8 w-8 place-items-center rounded-lg transition",
                    gridSize === "medium" ? "bg-white/10 text-white" : "text-muted hover:text-white",
                  )}
                >
                  <Grid2x2 size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => setGridSize("small")}
                  aria-label="Small grid"
                  aria-pressed={gridSize === "small"}
                  title="Small grid"
                  className={clsx(
                    "grid h-8 w-8 place-items-center rounded-lg transition",
                    gridSize === "small" ? "bg-white/10 text-white" : "text-muted hover:text-white",
                  )}
                >
                  <Grid3x3 size={15} />
                </button>
              </div>
            </div>
            <div
              className={clsx(
                "grid gap-3",
                gridSize === "small"
                  ? "grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-9"
                  : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-7",
              )}
            >
              {watchlist.map((id, index) => {
                const listing = getListing(id);
                if (!listing) return null;
                const resolved = resolve(listing);
                const shouldAnimate = index < 12;
                return (
                  <div
                    key={id}
                    className={clsx("min-w-0", shouldAnimate && "fade-up motion-reduce:animate-none")}
                    style={shouldAnimate ? { animationDelay: `${index * 22}ms` } : undefined}
                  >
                    <ListingCard listing={resolved} size={gridSize} />
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <Empty
            icon={<Heart size={24} />}
            title="Watchlist is empty"
            body="Tap the heart on any listing to track it here."
            cta={{ href: "/marketplace", label: "Find something" }}
          />
        )}
      </div>
    </div>
  );
}
