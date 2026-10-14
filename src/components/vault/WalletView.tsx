"use client";

import clsx from "clsx";
import Link from "next/link";
import { Plus, Wallet } from "lucide-react";
import { shortDate, usd } from "@/lib/format";
import { pendingOffer } from "@/lib/negotiation";
import { useStore } from "@/lib/store";
import { Button } from "../ui/primitives";
import { Empty, LoginPrompt } from "./shared";

/** Wallet balance with every credit and debit that makes it up. */
export function WalletView() {
  const { user, ledger, balance, negotiations, topUp } = useStore();

  if (!user) {
    return (
      <LoginPrompt
        icon={<Wallet size={26} />}
        title="Wallet"
        body="Log in to see your balance and every payment in and out."
      />
    );
  }

  // Balance after each entry: everything from that entry back to the oldest.
  const rows = ledger.map((e, i) => ({
    ...e,
    after: Math.round(ledger.slice(i).reduce((sum, x) => sum + x.amount, 0) * 100) / 100,
  }));
  const pendingCash = Object.values(negotiations)
    .filter((n) => n.buyer === user.username && n.status === "open")
    .map(pendingOffer)
    .reduce((sum, m) => sum + (m?.offer?.cash ?? 0), 0);

  return (
    <div className="space-y-4 px-4 py-5 lg:px-6">
      <h1 className="text-[24px] font-bold">Wallet</h1>

      <div className="grid gap-3 rounded-card border border-hairline bg-surface p-5 sm:grid-cols-[1fr_auto] sm:items-center">
        <div>
          <p className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-wide text-dim">
            <Wallet size={14} /> Wallet balance
          </p>
          <p className="mt-1 text-[30px] font-bold leading-none">{usd(balance, { cents: true })}</p>
          <p className="mt-2 text-[12px] text-muted">
            The sum of every entry below. Demo money only.
            {pendingCash > 0
              ? ` ${usd(pendingCash, { cents: true })} is in offers waiting on sellers. It is not held, and only leaves your wallet if an offer is accepted.`
              : ""}
          </p>
        </div>
        <Button variant="secondary" onClick={() => topUp(1000)}>
          <Plus size={15} />
          Top up $1,000 (demo)
        </Button>
      </div>

      {rows.length ? (
        <div className="overflow-hidden rounded-card border border-hairline bg-surface">
          <div className="grid grid-cols-[1fr_auto_auto] gap-4 border-b border-hairline px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide text-dim">
            <span>Entry</span>
            <span className="w-24 text-right">Amount</span>
            <span className="hidden w-24 text-right sm:block">Balance</span>
          </div>
          <ul className="divide-y divide-[rgba(255,255,255,0.08)]">
            {rows.map((e) => (
              <li key={e.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-4 py-3 text-[13px]">
                <span className="min-w-0">
                  {e.listingId ? (
                    <Link href={`/asset/${e.listingId}`} className="block truncate font-semibold hover:underline">
                      {e.label}
                    </Link>
                  ) : (
                    <span className="block truncate font-semibold">{e.label}</span>
                  )}
                  <span className="text-[11px] text-dim">{shortDate(e.at)}</span>
                </span>
                <span className={clsx("w-24 text-right font-bold", e.amount >= 0 ? "text-good" : "text-white")}>
                  {e.amount >= 0 ? "+" : "−"}
                  {usd(Math.abs(e.amount), { cents: true })}
                </span>
                <span className="hidden w-24 text-right text-muted sm:block">{usd(e.after, { cents: true })}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <Empty icon={<Wallet size={24} />} title="No payments yet" body="Purchases, sales and top-ups show up here." />
      )}
    </div>
  );
}
