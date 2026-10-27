"use client";

import { useEffect, useRef } from "react";
import { type FoundCase, useFoundCases } from "@/lib/chain/useLostAndFound";
import { usd } from "@/lib/format";
import { useStore } from "@/lib/store";

/** The case updates each side hears about: only the steps the other side (or Pokechain) took. */
const UPDATES: Record<"owner" | "finder", Partial<Record<number, (c: FoundCase) => string>>> = {
  owner: {
    1: () => "Someone found your lost slab and is sending it to Pokechain.",
    2: () => "Your found slab was authenticated. Choose vault or delivery in Status Center.",
    4: (c) => (c.returnTo === 1 ? "Your slab is back at Pokechain and is being re-vaulted at Collector Crypt." : "Your slab is on its way. Confirm when it arrives."),
    5: (c) => `The finder collected the ${usd(c.paid, { cents: true })} bounty. Case closed.`,
  },
  finder: {
    2: () => "Pokechain authenticated the slab you found. Waiting for the owner.",
    3: (c) => `The owner chose ${c.returnTo === 1 ? "the vault" : "delivery"}.`,
    4: (c) => (c.returnTo === 1 ? "The slab is being re-vaulted. Your bounty unlocks once it's Vaulted." : "The slab is on its way to the owner."),
    6: () => "Pokechain could not match the slab you sent to the lost token.",
  },
};

/**
 * Watches LostAndFound for the signed-in collector: a toast for each case update. Once the slab is
 * back its SlabVault custody leaves Lost, which is what takes it off the Lost page.
 */
export function FoundCaseSync() {
  const { user, pushToast } = useStore();
  const { data: cases } = useFoundCases();
  const seen = useRef<{ who: string; status: Map<string, number> } | null>(null);
  const me = user?.address?.toLowerCase() ?? "";

  useEffect(() => {
    if (!cases) return;
    const before = seen.current?.who === me ? seen.current.status : null;
    seen.current = { who: me, status: new Map(cases.map((c) => [c.claimId, c.status])) };
    if (!before || !me) return; // first read for this user: nothing has changed yet
    for (const c of cases) {
      const role = c.owner.toLowerCase() === me ? "owner" : c.finder.toLowerCase() === me ? "finder" : null;
      if (!role || before.get(c.claimId) === c.status) continue;
      const message = UPDATES[role][c.status]?.(c);
      if (message) pushToast({ title: `Found-slab case #${c.claimId}`, body: message, tone: "success" });
    }
  }, [cases, me, pushToast]);

  return null;
}
