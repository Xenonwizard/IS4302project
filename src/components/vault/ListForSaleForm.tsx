"use client";

import { useState } from "react";
import { Lock } from "lucide-react";
import { usd } from "@/lib/format";
import { useStore } from "@/lib/store";
import { useMarketChain } from "@/lib/chain/useMarketChain";
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
  const [price, setPrice] = useState("");
  const [acceptsLoan, setAcceptsLoan] = useState(false);
  const [loanAsk, setLoanAsk] = useState("");
  const [busy, setBusy] = useState(false);
  const value = Math.max(0, Number(price) || 0);
  const loanValue = Math.max(0, Number(loanAsk) || 0);
  const loanTermsValid = !acceptsLoan || (loanValue > 0 && loanValue < value);

  const handleSubmit = async () => {
    if (value <= 0 || !loanTermsValid) return;
    setBusy(true);
    try {
      if (user?.address && listing.tokenId) {
        await listCard(listing.tokenId, value, acceptsLoan, loanValue);
      }
      listFromVault(listing.id, value, acceptsLoan, loanValue);
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

      <div className="mt-4 rounded-2xl border border-hairline bg-surface p-4">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={acceptsLoan}
            onChange={(e) => setAcceptsLoan(e.target.checked)}
            disabled={busy}
            className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
          />
          <span>
            <span className="block text-sm font-semibold text-white">Accept loan offers</span>
            <span className="mt-1 block text-[12px] leading-relaxed text-muted">
              A funded offer uses this slab as collateral. It returns after repayment, or transfers to the lender after default.
            </span>
          </span>
        </label>

        {acceptsLoan ? (
          <div className="mt-4">
            <Field label="Minimum loan principal" hint={`Must be less than your ${usd(value, { cents: true })} sale price.`}>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
                <input
                  className={`${inputClass} pl-7`}
                  inputMode="decimal"
                  value={loanAsk}
                  onChange={(e) => setLoanAsk(e.target.value.replace(/[^\d.]/g, ""))}
                  disabled={busy}
                  aria-invalid={!loanTermsValid}
                />
              </div>
            </Field>
            {!loanTermsValid ? <p className="mt-2 text-[12px] text-bad">Enter an amount above $0 and below the sale price.</p> : null}
          </div>
        ) : null}
      </div>

      <dl className="mt-4 space-y-2.5 rounded-2xl bg-surface p-4 text-[13px]">
        <div className="flex justify-between">
          <dt className="text-muted">Pokéchain platform fee (Rule 2)</dt>
          <dd className="font-semibold text-good">0% ($0.00)</dd>
        </div>
        <div className="h-px bg-hairline" />
        <div className="flex justify-between">
          <dt className="text-muted">You receive upon settlement</dt>
          <dd className="font-bold text-accent">{usd(value, { cents: true })} USDC</dd>
        </div>
      </dl>

      <div className="mt-3 flex items-start gap-2 rounded-xl bg-surface-2 p-3 text-[12px] text-muted">
        <Lock size={15} className="mt-0.5 shrink-0 text-accent" />
        <p>
          Listed slabs cannot simultaneously be pledged, redeemed, or transferred. Cancelling this listing releases the restriction.
        </p>
      </div>

      <Button
        size="lg"
        className="mt-5 w-full"
        disabled={!Number.isFinite(Number(price)) || value <= 0 || !loanTermsValid || busy}
        onClick={handleSubmit}
      >
        {busy ? "Broadcasting transaction..." : `List for ${usd(value, { cents: true })}`}
      </Button>
    </div>
  );
}
