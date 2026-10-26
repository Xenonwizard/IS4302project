"use client";

import { HandCoins, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import type { Address } from "viem";
import { newLoanOfferId, useLoanActions, useLoanListing } from "@/lib/chain/loans";
import { usd } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { Listing } from "@/lib/types";
import { Button, Field, inputClass } from "../ui/primitives";

export function LoanBuilder({
  listing,
  room,
  available,
  lender,
  borrower,
  onClose,
}: {
  listing: Listing;
  room: string;
  available: number;
  lender: Address;
  borrower: Address;
  onClose: () => void;
}) {
  const { data: chainListing } = useLoanListing(listing.tokenId);
  const terms = chainListing;
  const { create } = useLoanActions();
  const { pushToast, postLoan } = useStore();
  const [principal, setPrincipal] = useState(() => String(listing.loanAsk || ""));
  const [interest, setInterest] = useState("");
  const [days, setDays] = useState("30");
  const [busy, setBusy] = useState(false);

  const principalValue = Math.max(0, Number(principal) || 0);
  const interestValue = Math.max(0, Number(interest) || 0);
  const daysValue = Math.max(0, Number(days) || 0);
  const minimum = terms?.loanAsk || 0;
  const valid =
    terms?.acceptsLoan === true &&
    principalValue >= minimum &&
    principalValue < terms.price &&
    principalValue <= available &&
    daysValue >= 1 &&
    daysValue <= 365;
  const annualRate = principalValue > 0 && daysValue > 0 ? (interestValue / principalValue) * (365 / daysValue) * 100 : 0;

  const submit = async () => {
    if (!valid || busy || !listing.tokenId) return;
    setBusy(true);
    try {
      const receipt = await create(listing.tokenId, principalValue, interestValue, daysValue, room);
      const offerId = newLoanOfferId(receipt);
      if (!offerId) throw new Error("The loan was funded, but its offer id could not be read from the chain.");
      postLoan(room, {
        offerId,
        lender,
        borrower,
        tokenId: listing.tokenId,
        principal: principalValue,
        interest: interestValue,
        duration: Math.round(daysValue * 86400),
      });
      pushToast({
        title: "Loan offer funded",
        body: `${usd(principalValue, { cents: true })} is locked until the seller responds.`,
        tone: "success",
      });
      onClose();
    } catch (error) {
      pushToast({ title: "Loan offer failed", body: (error as Error).message, tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="overflow-hidden rounded-card border border-hairline bg-surface">
      <header className="flex items-center justify-between border-b border-hairline px-5 py-4">
        <div>
          <p className="flex items-center gap-2 text-sm font-bold"><HandCoins size={17} className="text-accent" />Offer a loan</p>
          <p className="mt-1 text-[12px] text-muted">The principal is funded when you send the offer.</p>
        </div>
        <button onClick={onClose} className="rounded-lg p-2 text-muted hover:bg-white/5 hover:text-white" aria-label="Close loan builder">
          <X size={17} />
        </button>
      </header>

      <div className="space-y-4 p-5">
        <div className="rounded-xl border border-accent/25 bg-accent/10 p-3 text-[12px] leading-relaxed text-muted">
          <p className="font-semibold text-white">Seller terms</p>
          <p className="mt-1">
            {terms?.acceptsLoan
              ? `Minimum loan ${usd(minimum, { cents: true })} · sale price ${usd(terms.price, { cents: true })}`
              : terms === undefined
                ? "Checking the seller’s on-chain loan terms…"
                : "This listing was not created with loans enabled."}
          </p>
        </div>

        <Field label="Loan amount" hint={`Available balance: ${usd(available, { cents: true })}`}>
          <MoneyInput value={principal} onChange={setPrincipal} disabled={busy} />
        </Field>
        <Field label="Interest due" hint="A fixed amount paid on top of the principal.">
          <MoneyInput value={interest} onChange={setInterest} disabled={busy} />
        </Field>
        <Field label="Repayment period" hint="The deadline starts when the seller accepts.">
          <div className="relative">
            <input
              className={`${inputClass} pr-16`}
              inputMode="numeric"
              value={days}
              onChange={(e) => setDays(e.target.value.replace(/[^\d]/g, ""))}
              disabled={busy}
            />
            <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[12px] text-muted">days</span>
          </div>
        </Field>

        <dl className="space-y-2 rounded-xl bg-surface-2 p-4 text-[12px]">
          <div className="flex justify-between"><dt className="text-muted">Borrower repays</dt><dd className="font-bold">{usd(principalValue + interestValue, { cents: true })}</dd></div>
          <div className="flex justify-between"><dt className="text-muted">Equivalent annual rate</dt><dd className="font-semibold">{Number.isFinite(annualRate) ? `${annualRate.toFixed(1)}%` : "—"}</dd></div>
          <div className="flex justify-between"><dt className="text-muted">Your principal locked now</dt><dd className="font-bold text-accent">{usd(principalValue, { cents: true })}</dd></div>
        </dl>

        {!valid ? (
          <p className="text-[12px] leading-relaxed text-bad">
            The amount must meet the seller minimum, stay below the sale price and your balance, with a 1–365 day term.
          </p>
        ) : null}

        <div className="flex items-start gap-2 rounded-xl bg-surface-2 p-3 text-[12px] leading-relaxed text-muted">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-good" />
          <p>If accepted, the seller receives the principal and the slab moves to escrow until repayment or default.</p>
        </div>

        <Button size="lg" className="w-full" disabled={!valid || busy} onClick={submit}>
          <HandCoins size={17} />
          {busy ? "Funding offer…" : `Fund loan offer · ${usd(principalValue, { cents: true })}`}
        </Button>
      </div>
    </aside>
  );
}

function MoneyInput({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled: boolean }) {
  return (
    <div className="relative">
      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
      <input
        className={`${inputClass} pl-7`}
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))}
        disabled={disabled}
      />
    </div>
  );
}
