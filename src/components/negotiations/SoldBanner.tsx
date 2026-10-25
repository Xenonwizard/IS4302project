"use client";

import { BadgeCheck } from "lucide-react";
import { useTradedSlabs } from "@/lib/chain/trades";
import { TimeAgo } from "../ui/primitives";

/**
 * "Sold" across the top of a slab once it has changed hands in an accepted trade. `from` limits it to a
 * trade out of that collector's hands (a chat about their slab); without it, any trade counts unless
 * the slab has been listed for sale again since.
 */
export function SoldBanner({ tokenId, from, relisted }: { tokenId?: string; from?: string; relisted?: boolean }) {
  const { data: traded = {} } = useTradedSlabs();
  const t = tokenId ? traded[tokenId] : undefined;
  if (!t || relisted || (from && t.fromHandle !== from.replace(/^@/, ""))) return null;
  return (
    <div role="status" data-testid="sold-banner" className="flex items-center gap-2 rounded-xl border border-good/40 bg-good-bg px-4 py-2.5 text-[13px] text-good">
      <BadgeCheck size={16} className="shrink-0" />
      <span className="font-bold uppercase tracking-wide">Sold</span>
      <span className="min-w-0 truncate text-white/80">
        Traded from @{t.fromHandle} to @{t.toHandle} in trade #{t.offerId} · <TimeAgo value={t.at * 1000} />
      </span>
    </div>
  );
}
