"use client";

import Link from "next/link";
import { Heart } from "lucide-react";
import { getListing } from "@/lib/catalog";
import { usd } from "@/lib/format";
import { useStore } from "@/lib/store";
import { Slab } from "../slab/Slab";
import { Empty, LoginPrompt } from "./shared";

/** Slabs the user hearted, to keep an eye on. */
export function WatchlistView() {
  const { user, ready, watchlist, resolve } = useStore();

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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
            {watchlist.map((id) => {
              const listing = getListing(id);
              if (!listing) return null;
              const resolved = resolve(listing);
              return (
                <Link
                  key={id}
                  href={`/asset/${id}`}
                  className="overflow-hidden rounded-card border border-hairline bg-surface transition hover:border-white/20"
                >
                  <div className="bg-[#101014] p-4">
                    <Slab listing={resolved} />
                  </div>
                  <div className="p-3.5">
                    <p className="line-clamp-2 text-[12px] font-semibold leading-snug">{resolved.title}</p>
                    <p className="mt-2 text-[13px] font-bold">{usd(resolved.price)}</p>
                  </div>
                </Link>
              );
            })}
          </div>
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
