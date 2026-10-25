"use client";

import Link from "next/link";
import { useStore } from "@/lib/store";
import { Button } from "../ui/primitives";
import { AssetDetail } from "./AssetDetail";

/**
 * Slabs the user submitted only exist in browser storage, so the server cannot
 * find them. The slab page falls back to this, which looks them up once state loads.
 */
export function StoredSlab({ id }: { id: string }) {
  const { ready, slabs } = useStore();
  const listing = slabs.find((s) => s.id === id || s.tokenId === id || s.id === `token-${id}`);

  if (!ready) {
    return (
      <div className="px-4 py-5 lg:px-6">
        <div className="skeleton h-[70vh] rounded-card" />
      </div>
    );
  }
  if (!listing) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-[52px] font-black leading-none text-surface-3">404</p>
        <h1 className="text-xl font-bold">We could not find that slab</h1>
        <p className="max-w-sm text-sm text-muted">
          The listing may have sold, been delisted, or the link is wrong.
        </p>
        <Link href="/marketplace">
          <Button size="lg">Back to the marketplace</Button>
        </Link>
      </div>
    );
  }
  return <AssetDetail listing={listing} />;
}
