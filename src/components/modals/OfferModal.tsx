"use client";

import { useState } from "react";
import { discountPct } from "@/lib/catalog";
import { usd } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { Listing } from "@/lib/types";
import { Button, Field, Modal, inputClass } from "../ui/primitives";

const EXPIRY = [
  { hours: 12, label: "12 hours" },
  { hours: 24, label: "24 hours" },
  { hours: 48, label: "48 hours" },
  { hours: 168, label: "7 days" },
];

export function OfferModal({
  listing,
  open,
  onClose,
}: {
  listing: Listing;
  open: boolean;
  onClose: () => void;
}) {
  const { makeOffer } = useStore();
  const top = listing.offers[0];
  const [amount, setAmount] = useState(String(Math.round(listing.price * 0.9 * 100) / 100));
  const [hours, setHours] = useState(48);
  const value = Number(amount) || 0;
  const vsFmv = listing.fmv > 0 ? Math.round(((listing.fmv - value) / listing.fmv) * 100) : 0;
  const tooLow = top ? value <= top.amount : false;

  return (
    <Modal open={open} onClose={onClose} title="Make an offer">
      <div className="p-5">
        <p className="mb-4 text-[13px] leading-relaxed text-muted">
          Offers are binding for the window you choose. The owner can accept, counter, or let it
          lapse.
        </p>

        <Field label="Your offer">
          <div className="relative">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
            <input
              className={`${inputClass} pl-7 text-base font-bold`}
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
            />
          </div>
        </Field>

        <div className="mt-3 flex gap-2">
          {[0.8, 0.9, 0.95, 1].map((pct) => (
            <button
              key={pct}
              onClick={() => setAmount(String(Math.round(listing.price * pct * 100) / 100))}
              className="h-9 flex-1 rounded-lg bg-surface-2 text-[12px] font-semibold text-muted transition hover:bg-surface-3 hover:text-white"
            >
              {pct === 1 ? "Asking" : `${pct * 100}%`}
            </button>
          ))}
        </div>

        <div className="mt-5 space-y-2.5 rounded-2xl bg-surface p-4 text-[13px]">
          <div className="flex justify-between">
            <span className="text-muted">Listed for</span>
            <span className="font-semibold">{usd(listing.price)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Market value</span>
            <span className="font-semibold">
              {usd(listing.fmv)}{" "}
              <span className="text-[11px] text-dim">
                ({discountPct(listing) >= 0 ? `${discountPct(listing)}% under` : `${-discountPct(listing)}% over`})
              </span>
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Top offer</span>
            <span className="font-semibold">{top ? usd(top.amount) : "None yet"}</span>
          </div>
          <div className="h-px bg-hairline" />
          <div className="flex justify-between">
            <span className="text-muted">Your offer vs market</span>
            <span className={`font-semibold ${vsFmv >= 0 ? "text-good" : "text-warn"}`}>
              {vsFmv >= 0 ? `${vsFmv}% under` : `${-vsFmv}% over`}
            </span>
          </div>
        </div>

        <div className="mt-5">
          <p className="mb-2 text-[12px] font-bold uppercase tracking-wide text-muted">
            Expires in
          </p>
          <div className="flex gap-2">
            {EXPIRY.map((e) => (
              <button
                key={e.hours}
                onClick={() => setHours(e.hours)}
                className={`h-9 flex-1 rounded-lg text-[12px] font-semibold transition ${
                  hours === e.hours
                    ? "bg-accent text-white"
                    : "bg-surface-2 text-muted hover:bg-surface-3 hover:text-white"
                }`}
              >
                {e.label}
              </button>
            ))}
          </div>
        </div>

        {tooLow ? (
          <p className="mt-4 rounded-xl bg-warn/10 p-3 text-[12px] text-warn">
            Your offer is at or below the current top offer of {usd(top!.amount)}.
          </p>
        ) : null}

        <Button
          size="lg"
          className="mt-5 w-full"
          disabled={value <= 0}
          onClick={() => {
            makeOffer(listing.id, value, hours);
            onClose();
          }}
        >
          Submit offer · {usd(value)}
        </Button>
      </div>
    </Modal>
  );
}
