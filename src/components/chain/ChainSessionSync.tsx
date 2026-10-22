"use client";

import { useEffect, useRef } from "react";
import { useAccount } from "wagmi";
import { useOnchainAccount } from "@/lib/chain/useOnchainAccount";
import { useStore } from "@/lib/store";

/** A wallet that never reconnects after a page load ends the session after this long. */
const NO_WALLET_TIMEOUT_MS = 8000;

/**
 * Log in = prove you control a wallet that has an Active account in AccountRegistry. There is no
 * password: when the connected wallet's on-chain record says Active, the app signs in as its
 * handle, and when the wallet disconnects (or switches to another address) it signs out.
 */
export function ChainSessionSync() {
  const { ready, user, login, logout } = useStore();
  const { status: connection } = useAccount();
  const { address, isConnected, status, handle, loaded } = useOnchainAccount();
  /** wagmi starts every page load "disconnected" until it reconnects, so only a real drop counts */
  const seenConnected = useRef(false);
  // Runs before the effect below (effects run in order), so a drop in this render is seen.
  useEffect(() => {
    if (isConnected) seenConnected.current = true;
  }, [isConnected]);

  useEffect(() => {
    if (!ready || connection === "connecting" || connection === "reconnecting") return;
    // Someone using the off-chain demo login is left alone.
    if (user && !user.address) return;
    if (isConnected && address && loaded && status === "Active") {
      if (user?.address !== address || user.username !== handle) login(handle, undefined, address);
      return;
    }
    if (!user?.address) return;
    if (isConnected && loaded && (user.address !== address || status !== "Active")) {
      logout(); // switched to another address, or the account was closed
    } else if (connection === "disconnected") {
      if (seenConnected.current) logout();
      else {
        const timer = window.setTimeout(logout, NO_WALLET_TIMEOUT_MS);
        return () => window.clearTimeout(timer);
      }
    }
  }, [ready, connection, loaded, user, isConnected, address, status, handle, login, logout]);

  return null;
}
