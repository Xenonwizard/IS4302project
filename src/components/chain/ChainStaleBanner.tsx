"use client";

import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { IS_LOCAL } from "@/lib/chain/config";
import { buildHash } from "@/lib/chain/generated";

/**
 * Local chain only. Shown while the contracts on the chain aren't the ones this checkout was built
 * for (after a `git checkout` or pull), when every chain call could fail or read the wrong thing.
 * `npm run chain` redeploys by itself within seconds; a chain started before it could only goes on
 * serving the old contracts, so the banner says to restart it.
 */
export function ChainStaleBanner() {
  const { data } = useQuery({
    queryKey: ["chain-build-hash"],
    enabled: IS_LOCAL,
    refetchInterval: 3_000,
    queryFn: async () => {
      const res = await fetch("/api/dev/epoch", { cache: "no-store" });
      return (await res.json()) as { epoch: string | null; buildHash: string | null };
    },
  });
  // No snapshot at all means the chain isn't running; ChainDownBanner covers that.
  if (!data?.epoch || data.buildHash === buildHash) return null;
  return (
    <div
      data-testid="chain-stale"
      className="flex items-center justify-center gap-2 bg-warn/15 px-4 py-2 text-center text-[12.5px] font-semibold text-warn"
    >
      <RefreshCw size={14} className="shrink-0" />
      {data.buildHash ? (
        <span>The local chain is running other contracts than this branch. It is redeploying them now; this page refreshes when it&apos;s done.</span>
      ) : (
        <span>
          The local chain was started by an older <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono">npm run chain</code>{" "}
          that can&apos;t tell when you switch branches. Stop it and run{" "}
          <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono">npm run chain</code> again.
        </span>
      )}
    </div>
  );
}
