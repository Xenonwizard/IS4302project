"use client";

import { Clock3, HandCoins, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import type { Address } from "viem";
import { useLoanActions, useLoanOffers, type LoanOffer } from "@/lib/chain/loans";
import { usd } from "@/lib/format";
import { useStore } from "@/lib/store";
import { Badge, Button } from "../ui/primitives";

export function LoanStatusPanel({ me, other, tokenId }: { me: Address; other: Address; tokenId: string }) {
  const { data: offers = [] } = useLoanOffers(me, other, tokenId);
  const actions = useLoanActions();
  const { pushToast } = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (!offers.length) return null;

  const act = async (offer: LoanOffer, action: "accept" | "decline" | "withdraw" | "repay" | "claimDefault") => {
    setBusy(`${offer.id}:${action}`);
    try {
      await actions[action](offer.id);
      pushToast({ title: actionLabel(action), body: `Loan #${offer.id} has been updated on-chain.`, tone: "success" });
    } catch (error) {
      pushToast({ title: "Loan action failed", body: (error as Error).message, tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-card border border-hairline bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-[13px] font-bold"><HandCoins size={16} className="text-accent" />Loans on this slab</p>
        <Badge tone="accent">{offers.length}</Badge>
      </div>
      <div className="space-y-3">
        {offers.map((offer) => {
          const amLender = offer.lender.toLowerCase() === me.toLowerCase();
          const expired = offer.deadline > 0 && now > offer.deadline * 1000;
          return (
            <article key={offer.id} className="rounded-xl bg-surface-2 p-3 text-[12px]">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">Loan #{offer.id} · {amLender ? "You lend" : "You borrow"}</span>
                <Badge tone={offer.status === "Active" ? (expired ? "warn" : "good") : offer.status === "Open" ? "accent" : "neutral"}>
                  {offer.status === "Active" && expired ? "Past due" : offer.status}
                </Badge>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2">
                <Stat label="Principal" value={usd(offer.principal, { cents: true })} />
                <Stat label="Repayment" value={usd(offer.principal + offer.interest, { cents: true })} />
              </dl>
              <p className="mt-2 flex items-center gap-1.5 text-muted">
                <Clock3 size={13} />
                {offer.status === "Open"
                  ? `${Math.round(offer.duration / 86400)} days after acceptance`
                  : offer.deadline
                    ? `Due ${new Date(offer.deadline * 1000).toLocaleString()}`
                    : "Closed"}
              </p>

              {offer.status === "Open" ? (
                <div className="mt-3 flex gap-2">
                  {amLender ? (
                    <Button size="sm" variant="outline" className="w-full" disabled={Boolean(busy)} onClick={() => void act(offer, "withdraw")}>Withdraw</Button>
                  ) : (
                    <>
                      <Button size="sm" className="flex-1" disabled={Boolean(busy)} onClick={() => void act(offer, "accept")}><ShieldCheck size={14} />Accept</Button>
                      <Button size="sm" variant="outline" className="flex-1" disabled={Boolean(busy)} onClick={() => void act(offer, "decline")}>Decline</Button>
                    </>
                  )}
                </div>
              ) : null}

              {offer.status === "Active" && !amLender && !expired ? (
                <Button size="sm" className="mt-3 w-full" disabled={Boolean(busy)} onClick={() => void act(offer, "repay")}>Repay {usd(offer.principal + offer.interest, { cents: true })}</Button>
              ) : null}
              {offer.status === "Active" && amLender && expired ? (
                <Button size="sm" variant="danger" className="mt-3 w-full" disabled={Boolean(busy)} onClick={() => void act(offer, "claimDefault")}>Claim slab collateral</Button>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-surface px-2.5 py-2"><dt className="text-muted">{label}</dt><dd className="mt-0.5 font-bold text-white">{value}</dd></div>;
}

function actionLabel(action: string) {
  if (action === "accept") return "Loan accepted";
  if (action === "repay") return "Loan repaid";
  if (action === "claimDefault") return "Collateral claimed";
  if (action === "withdraw") return "Offer withdrawn";
  return "Offer declined";
}
