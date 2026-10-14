"use client";

import { useState } from "react";
import { BRAND } from "@/lib/brand";
import { usd } from "@/lib/format";
import { sellerFee, useStore } from "@/lib/store";
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
  const { listFromVault } = useStore();
  const [price, setPrice] = useState(String(listing.fmv));
  const value = Math.max(0, Number(price) || 0);

  return (
    <div>
      <Field
        label="Asking price"
        hint="Listing opens a negotiation room where collectors bid cash or trade slabs."
      >
        <div className="relative">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
          <input
            className={`${inputClass} pl-7 text-base font-bold`}
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))}
          />
        </div>
      </Field>

      <dl className="mt-4 space-y-2.5 rounded-2xl bg-surface p-4 text-[13px]">
        <div className="flex justify-between">
          <dt className="text-muted">Market value</dt>
          <dd className="font-semibold">{usd(listing.fmv, { cents: true })}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted">Seller fee ({BRAND.sellerFee * 100}% of cash)</dt>
          <dd className="font-semibold">−{usd(sellerFee(value), { cents: true })}</dd>
        </div>
        <div className="h-px bg-hairline" />
        <div className="flex justify-between">
          <dt className="text-muted">You receive for a full-cash sale at this price</dt>
          <dd className="font-bold">{usd(value - sellerFee(value), { cents: true })}</dd>
        </div>
      </dl>

      <Button
        size="lg"
        className="mt-5 w-full"
        disabled={value <= 0}
        onClick={() => {
          listFromVault(listing.id, value);
          onListed?.();
        }}
      >
        List for {usd(value, { cents: true })}
      </Button>
    </div>
  );
}
