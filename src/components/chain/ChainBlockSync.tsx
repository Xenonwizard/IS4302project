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
 *
 * A socket can drop (the laptop sleeps, the chain restarts). While it is down the page asks for the
 * block number every few seconds instead and keeps trying to subscribe again, so an open tab never
 * stops updating until it is reloaded.
 */
const WS_URL = chain.rpcUrls.default.webSocket?.[0] ?? (IS_LOCAL ? chain.rpcUrls.default.http[0].replace(/^http/, "ws") : undefined);
const POLL_MS = 4_000;
const RESUBSCRIBE_MS = 5_000;
/** A socket that neither opens nor fails by then counts as dropped. */
const CONNECT_TIMEOUT_MS = 10_000;

// Queries that don't follow the chain: off-chain APIs with their own timers, or results that never change.
const OFF_CHAIN = new Set(["graded-card-pricing", "cc-inbox", "evidence", "submission-evidence", "tx-details", "outtake-address", "blockNumber", "delay-reports"]);

export function ChainBlockSync() {
  const httpClient = usePublicClient();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!httpClient) return;
    let stopped = false;
    let stopPolling: (() => void) | undefined;
    let closeSocket: (() => void) | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => void queryClient.invalidateQueries({ predicate: (q) => !OFF_CHAIN.has(String(q.queryKey[0])) });

    const startPolling = () => {
      if (stopPolling) return;
      let last: bigint | undefined;
      stopPolling = httpClient.watchBlockNumber({
        poll: true,
        pollingInterval: POLL_MS,
        emitMissed: false,
        // A poll reports the current block first, so refresh only when it changes.
        onBlockNumber: (block) => {
          if (last !== undefined && block !== last) refresh();
          last = block;
        },
        onError: () => {},
      });
    };
    const endPolling = () => {
      stopPolling?.();
      stopPolling = undefined;
    };

    const subscribe = async () => {
      if (stopped || !WS_URL) return;
      retry = undefined;
      // viem's own reconnect gives up after a few tries, so this component reconnects itself.
      const { transport } = createPublicClient({ chain, transport: webSocket(WS_URL, { reconnect: false }) });
      let socket: { close: () => void } | undefined;
      let dropped = false;
      const drop = () => {
        if (dropped) return;
        dropped = true;
        closeSocket = undefined;
        // viem keeps a dropped socket cached (shared by every client on this URL); closing it removes
        // it, so the next try opens a fresh one. A healthy socket is never closed, since a second
        // mount of this component (React's dev double-mount) may be using it.
        socket?.close();
        if (stopped) return;
        startPolling();
        retry = setTimeout(subscribe, RESUBSCRIBE_MS);
      };
      try {
        socket = await Promise.race([
          transport.getRpcClient(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("WebSocket connect timed out")), CONNECT_TIMEOUT_MS)),
        ]);
        const sub = await transport.subscribe({ params: ["newHeads"], onData: refresh, onError: drop });
        if (stopped) return void sub.unsubscribe().catch(() => {});
        if (dropped) return;
        closeSocket = () => void sub.unsubscribe().catch(() => {});
        endPolling();
        // The subscription only reports blocks mined after it is confirmed, and Hardhat only mines
        // when a transaction lands. Blocks mined while the page loaded, or while the socket was
        // down, would otherwise be missed until the next transaction, so refresh once now.
        refresh();
      } catch {
        drop();
      }
    };

    // A tab coming back to the front may have missed blocks while it slept, or while its socket reconnected.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      refresh();
      if (retry) {
        clearTimeout(retry);
        void subscribe();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);

    if (WS_URL) void subscribe();
    else startPolling();

    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      closeSocket?.();
      endPolling();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [httpClient, queryClient]);

  return null;
}
