"use client";

/**
 * "Reset demo data": a clean slate for testing.
 *   1. local chain: POST /api/dev/reset reverts the Hardhat node to its just-deployed snapshot
 *      (no accounts, no slabs) and clears the mock Collector Crypt records
 *   2. disconnects the wallet
 *   3. clears everything the app keeps in this browser (state, chain log, wallet flags)
 *   4. reloads, so every cached chain read starts again
 * On Amoy only steps 2–4 run: a public chain can't be rolled back.
 *
 * Confirmation is a second click (`request` arms, a second `request` within a few seconds
 * resets), not window.confirm, which embedded browsers such as the Claude app's pane block.
 */
import { useCallback, useEffect, useState } from "react";
import { useDisconnect } from "wagmi";
import { useStore } from "../store";
import { IS_LOCAL } from "./config";

export function useResetDemo() {
  const { disconnect } = useDisconnect();
  const { pushToast } = useStore();
  const [resetting, setResetting] = useState(false);
  const [armed, setArmed] = useState(false);

  // An armed button quietly disarms if the second click doesn't come.
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 8000);
    return () => window.clearTimeout(timer);
  }, [armed]);

  const reset = useCallback(async () => {
    setArmed(false);
    setResetting(true);
    if (IS_LOCAL) {
      const res = await fetch("/api/dev/reset", { method: "POST" });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        pushToast({ title: "Couldn't reset the chain", body: body.error, tone: "error" });
        setResetting(false);
        return;
      }
    }
    disconnect();
    try {
      Object.keys(window.localStorage)
        .filter((k) => k.startsWith("pokechain.") || k.startsWith("wagmi.") || k.startsWith("rk-"))
        .forEach((k) => window.localStorage.removeItem(k));
    } catch {
      /* storage blocked: nothing saved to clear */
    }
    // A full page load, not router.push: in-memory wagmi and query caches must go too.
    window.location.replace(`${window.location.origin}/`);
  }, [disconnect, pushToast]);

  /** First call arms, second call resets. */
  const request = useCallback(() => {
    if (resetting) return;
    if (armed) void reset();
    else setArmed(true);
  }, [armed, resetting, reset]);

  return { request, armed, resetting };
}
