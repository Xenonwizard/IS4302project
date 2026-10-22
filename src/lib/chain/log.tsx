"use client";

/**
 * A running log of every blockchain interaction the app makes: wallet transactions,
 * off-chain signatures, the vault operator's server-side transactions and its Grade10 /
 * Solana custody checks. The Chain log panel shows it, so a demo can point at exactly which
 * contract function ran, with which arguments, in which block, for how much gas.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/** tx: user's wallet · signature: off-chain EIP-712 · operator: server key · check: Grade10 / Solana read */
export type ChainLogKind = "tx" | "signature" | "operator" | "check";

export interface ChainLogEntry {
  id: string;
  at: string;
  kind: ChainLogKind;
  /** what the user was doing, e.g. "Open account" */
  label: string;
  /** e.g. "AccountRegistry.register" */
  call: string;
  args: string[];
  from?: string;
  hash?: string;
  status: "pending" | "success" | "failed";
  blockNumber?: string;
  gasUsed?: string;
  error?: string;
}

interface ChainLogValue {
  entries: ChainLogEntry[];
  add: (entry: Omit<ChainLogEntry, "id" | "at">) => string;
  update: (id: string, patch: Partial<ChainLogEntry>) => void;
  clear: () => void;
  open: boolean;
  setOpen: (open: boolean) => void;
}

const STORAGE_KEY = "pokechain.chainlog.v1";
const MAX_ENTRIES = 80;

const ChainLogContext = createContext<ChainLogValue | null>(null);

let seq = 0;

export function ChainLogProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<ChainLogEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      // Reading storage after mount keeps server and client markup identical.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setEntries(JSON.parse(raw) as ChainLogEntry[]);
    } catch {
      /* unreadable log: start empty */
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
      /* storage blocked: the log lasts for this tab only */
    }
  }, [entries, ready]);

  const add = useCallback((entry: Omit<ChainLogEntry, "id" | "at">) => {
    seq += 1;
    const id = `${Date.now().toString(36)}-${seq}`;
    setEntries((prev) => [{ ...entry, id, at: new Date().toISOString() }, ...prev].slice(0, MAX_ENTRIES));
    return id;
  }, []);

  const update = useCallback((id: string, patch: Partial<ChainLogEntry>) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }, []);

  const clear = useCallback(() => setEntries([]), []);

  const value = useMemo(() => ({ entries, add, update, clear, open, setOpen }), [entries, add, update, clear, open]);
  return <ChainLogContext.Provider value={value}>{children}</ChainLogContext.Provider>;
}

export function useChainLog(): ChainLogValue {
  const ctx = useContext(ChainLogContext);
  if (!ctx) throw new Error("useChainLog must be used inside ChainLogProvider");
  return ctx;
}
