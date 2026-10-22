"use client";

import { AlertTriangle } from "lucide-react";
import { IS_LOCAL, chain } from "@/lib/chain/config";
import { useOnchainAccount } from "@/lib/chain/useOnchainAccount";

/** Shown on every page while the chain's RPC doesn't answer, with the command that fixes it. */
export function ChainDownBanner() {
  const { reachable } = useOnchainAccount();
  if (reachable) return null;
  return (
    <div className="flex items-center justify-center gap-2 bg-warn/15 px-4 py-2 text-center text-[12.5px] font-semibold text-warn">
      <AlertTriangle size={14} className="shrink-0" />
      {IS_LOCAL ? (
        <span>
          The local blockchain isn&apos;t running ({chain.rpcUrls.default.http[0]}). Start it in a terminal with{" "}
          <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono">npm run chain</code>
        </span>
      ) : (
        <span>Can&apos;t reach {chain.name}. Check NEXT_PUBLIC_RPC_URL.</span>
      )}
    </div>
  );
}
