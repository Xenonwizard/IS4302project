"use client";

import { useState } from "react";
import clsx from "clsx";
import { Lock } from "lucide-react";
import { usd } from "@/lib/format";
import { useStore } from "@/lib/store";
import { useMarketChain, useMarketFeeBps } from "@/lib/chain/useMarketChain";
import type { Listing } from "@/lib/types";
import { Button, Field, inputClass } from "../ui/primitives";

/** Asking-price form for putting a vaulted slab on the marketplace. */
export function ListForSaleForm({
  listing,
  onListed,
}: {
  listing: Listing;
  onListed?: () => void;
}) {
  const { user, listFromVault, pushToast } = useStore();
  const { listCard } = useMarketChain();
  const { data: marketFeeBps = 0 } = useMarketFeeBps();
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const value = Math.max(0, Number(price) || 0);
  const feeAmount = (value * marketFeeBps) / 10000;
  const netProceeds = value - feeAmount;

  const handleSubmit = async () => {
    if (value <= 0) return;
    setBusy(true);
    try {
      let listedAt: string | undefined;
      if (user?.address && listing.tokenId) {
        ({ listedAt } = await listCard(listing.tokenId, value));
      }
      listFromVault(listing.id, value, listedAt);
      onListed?.();
    } catch (err) {
      pushToast({
        title: "Listing failed",
        body: (err as Error).message,
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Field
        label="Asking price (USDC)"
        hint="Choose your asking price. Compare Pokechain listings and transactions on the slab page."
      >
        <div className="relative">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
          <input
            className={`${inputClass} pl-7 text-base font-bold`}
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))}
            disabled={busy}
          />
        </div>
      </Field>

      <dl className="mt-4 space-y-2.5 rounded-2xl bg-surface p-4 text-[13px]">
        <div className="flex justify-between">
          <dt className="text-muted">Pokéchain platform fee {marketFeeBps > 0 ? `(${marketFeeBps / 100}%)` : "(Rule 2)"}</dt>
          <dd className={clsx("font-semibold", marketFeeBps > 0 ? "text-accent" : "text-good")}>
            {marketFeeBps > 0 ? `${marketFeeBps / 100}% (${usd(feeAmount, { cents: true })})` : "0% ($0.00)"}
          </dd>
        </div>
        <div className="h-px bg-hairline" />
        <div className="flex justify-between">
          <dt className="text-muted">You receive upon settlement</dt>
          <dd className="font-bold text-accent">{usd(netProceeds, { cents: true })} USDC</dd>
        </div>
      </dl>

      <div className="mt-3 flex items-start gap-2 rounded-xl bg-surface-2 p-3 text-[12px] text-muted">
        <Lock size={15} className="mt-0.5 shrink-0 text-accent" />
        <p>
          Listed slabs cannot be redeemed or transferred. Cancelling this listing releases the restriction.
        </p>
      </div>

      <Button
        size="lg"
        className="mt-5 w-full"
        disabled={!Number.isFinite(Number(price)) || value <= 0 || busy}
        onClick={handleSubmit}
      >
        {busy ? "Broadcasting transaction..." : `List for ${usd(value, { cents: true })}`}
      </Button>
    </div>
  );
}
