"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { createPublicClient, webSocket } from "viem";
import { usePublicClient } from "wagmi";
import { IS_LOCAL, chain } from "@/lib/chain/config";

/**
 * The one place the app listens to the chain. When a new block is mined it refreshes every cached
 * chain read, so a transaction from any tab or terminal shows up straight away.
 *
 * On the local Hardhat node it subscribes over WebSocket (eth_subscribe "newHeads"): the node pushes
 * each new block, so an idle app sends no requests at all, and Hardhat only mines when a transaction
 * lands. On a public testnet without a WebSocket URL it falls back to asking for the block number
 * every few seconds.
 */
const WS_URL = chain.rpcUrls.default.webSocket?.[0] ?? (IS_LOCAL ? chain.rpcUrls.default.http[0].replace(/^http/, "ws") : undefined);

// Queries that don't follow the chain: off-chain APIs with their own timers, or results that never change.
const OFF_CHAIN = new Set(["graded-card-pricing", "cc-inbox", "evidence", "submission-evidence", "tx-details", "outtake-address", "blockNumber", "delay-reports"]);

export function ChainBlockSync() {
  const httpClient = usePublicClient();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!httpClient) return;
    let last: bigint | undefined;
    const refresh = () => void queryClient.invalidateQueries({ predicate: (q) => !OFF_CHAIN.has(String(q.queryKey[0])) });
    // A tab coming back to the front may have missed blocks while it slept, or while its socket reconnected.
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", refresh);
    const stopListening = () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", refresh);
    };

    if (WS_URL) {
      // The subscription only reports blocks mined after it is confirmed, and Hardhat only mines when a
      // transaction lands. A block mined while the page loaded would otherwise be missed until the next
      // transaction, so refresh once the node confirms the subscription.
      let stopped = false;
      let unsubscribe: (() => unknown) | undefined;
      createPublicClient({ chain, transport: webSocket(WS_URL) })
        .transport.subscribe({ params: ["newHeads"], onData: refresh, onError: () => {} })
        .then((sub) => {
          if (stopped) return void sub.unsubscribe().catch(() => {});
          unsubscribe = () => sub.unsubscribe().catch(() => {});
          refresh();
        })
        .catch(() => {});
      return () => {
        stopped = true;
        unsubscribe?.();
        stopListening();
      };
    }
    const unwatch = httpClient.watchBlockNumber({
      poll: true,
      pollingInterval: 4_000,
      emitMissed: false,
      // A poll reports the current block first, so refresh only when it changes.
      onBlockNumber: (block) => {
        if (last !== undefined && block !== last) refresh();
        last = block;
      },
      onError: () => {},
    });
    return () => {
      unwatch();
      stopListening();
    };
  }, [httpClient, queryClient]);

  return null;
}
