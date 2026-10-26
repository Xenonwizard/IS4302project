"use client";

import { useEffect } from "react";
import { IS_LOCAL } from "@/lib/chain/config";

const EPOCH_KEY = "pokechain.chainEpoch";

/** Everything this browser saved about the chain and the session, as the Reset button clears it. */
function clearSavedState() {
  try {
    Object.keys(window.localStorage)
      .filter((k) => (k.startsWith("pokechain.") && k !== EPOCH_KEY) || k.startsWith("wagmi.") || k.startsWith("rk-"))
      .forEach((k) => window.localStorage.removeItem(k));
  } catch {
    /* storage blocked: nothing saved to clear */
  }
}

/**
 * Local chain only. Every tab saves its copy of the app state (Vault, submissions, chats) to this
 * browser, so after the chain is reset, a tab that was open would write the old slabs and requests
 * straight back. This checks which run of the chain is live (/api/dev/epoch) on load and every few
 * seconds; when it isn't the one the saved state belongs to, the saved state is dropped and the tab
 * reloads, so every tab, including /intake, starts again from the chain.
 */
export function ChainEpochGuard() {
  useEffect(() => {
    if (!IS_LOCAL) return;
    let seen: string | null = null;
    let stopped = false;

    const check = async () => {
      const res = await fetch("/api/dev/epoch", { cache: "no-store" }).catch(() => null);
      if (!res?.ok || stopped) return;
      const { epoch } = (await res.json()) as { epoch: string | null };
      if (!epoch) return;
      let saved: string | null = null;
      try {
        saved = window.localStorage.getItem(EPOCH_KEY);
      } catch {
        return;
      }
      // Saved state from before this chain run, found on load or noticed while open: start over.
      if ((seen ?? saved) !== null && (seen ?? saved) !== epoch) {
        stopped = true;
        clearSavedState();
        window.localStorage.setItem(EPOCH_KEY, epoch);
        window.location.replace(`${window.location.origin}${window.location.pathname}`);
        return;
      }
      if (saved !== epoch) window.localStorage.setItem(EPOCH_KEY, epoch);
      seen = epoch;
    };

    void check();
    const timer = window.setInterval(() => void check(), 3_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, []);
  return null;
}
