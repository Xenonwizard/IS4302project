"use client";

import clsx from "clsx";
import { Check, Clock3, HandCoins, Lock, Undo2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Address } from "viem";
import { useLoanActions, type LoanOffer } from "@/lib/chain/loans";
import { usd } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { ChatMessage } from "@/lib/types";
import { Badge, Button } from "../ui/primitives";

export function LoanCard({
  message,
  negotiationId,
  me,
  offer,
}: {
  message: ChatMessage;
  negotiationId: string;
  me: { address: Address; handle: string };
  offer?: LoanOffer;
}) {
  const loan = message.loan!;
  const iAmLender = loan.lender.toLowerCase() === me.address.toLowerCase();
  const { accept, decline, withdraw, repay, claimDefault } = useLoanActions();
  const { pushToast, chatNote } = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const status = offer?.status;
  const open = status === "Open";
  const active = status === "Active";
  const expired = Boolean(active && offer?.deadline && now > offer.deadline * 1000);
  const total = loan.principal + loan.interest;

  const act = async (name: string, fn: () => Promise<unknown>, note: string) => {
    setBusy(name);
    try {
      await fn();
      chatNote(negotiationId, note);
      pushToast({ title: `${name} complete`, tone: "success" });
    } catch (error) {
      pushToast({ title: `${name} failed`, body: (error as Error).message, tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const tone = active ? (expired ? "warn" : "good") : open ? "accent" : "neutral";
  const label = !status
    ? "Checking…"
    : active && expired
      ? "Past due"
      : open
        ? (iAmLender ? "Waiting for seller" : "Your move")
        : status;

  return (
    <div
      data-testid="loan-card"
      data-offer-id={loan.offerId}
      className={clsx(
        "w-full max-w-[640px] rounded-2xl border bg-surface p-3.5 text-left",
        open ? "border-accent/60" : active ? "border-good/50" : "border-hairline",
        status && !open && !active && status !== "Repaid" && "opacity-70",
      )}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[12.5px]">
        <HandCoins size={15} className="text-accent" />
        <span className="font-bold text-white">{iAmLender ? "You offered a loan" : "Loan offer"} · #{loan.offerId}</span>
        <Badge tone={tone} className="ml-auto">
          {status === "Repaid" ? <Check size={11} /> : null}
          {label}
        </Badge>
      </div>

      <div className="grid grid-cols-3 gap-2 text-[12px]">
        <Term label="Principal" value={usd(loan.principal, { cents: true })} />
        <Term label="Interest" value={usd(loan.interest, { cents: true })} />
        <Term label="Total repayment" value={usd(total, { cents: true })} />
      </div>

      <p className="mt-3 flex items-center gap-1.5 text-[11.5px] text-muted">
        {active ? <Lock size={13} className="text-good" /> : <Clock3 size={13} />}
        {active && offer?.deadline
          ? `Slab in escrow · due ${new Date(offer.deadline * 1000).toLocaleString()}`
          : `${Math.round(loan.duration / 86400)} days to repay after acceptance`}
      </p>

      {open ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {iAmLender ? (
            <Button size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => void act("Withdraw", () => withdraw(loan.offerId), `${me.handle} withdrew loan offer #${loan.offerId}.`)}>
              <Undo2 size={13} /> Withdraw offer
            </Button>
          ) : (
            <>
              <Button size="sm" disabled={Boolean(busy)} onClick={() => void act("Accept", () => accept(loan.offerId), `${me.handle} accepted loan #${loan.offerId}. The slab is now in escrow.`)}>
                <Check size={13} /> Accept loan
              </Button>
              <Button size="sm" variant="danger" disabled={Boolean(busy)} onClick={() => void act("Decline", () => decline(loan.offerId), `${me.handle} declined loan offer #${loan.offerId}.`)}>
                <X size={13} /> Decline
              </Button>
            </>
          )}
        </div>
      ) : null}

      {active && !iAmLender && !expired ? (
        <Button size="sm" className="mt-3" disabled={Boolean(busy)} onClick={() => void act("Repayment", () => repay(loan.offerId), `${me.handle} repaid loan #${loan.offerId}. The slab returned to the borrower.`)}>
          Repay {usd(total, { cents: true })}
        </Button>
      ) : null}
      {active && iAmLender && expired ? (
        <Button size="sm" variant="danger" className="mt-3" disabled={Boolean(busy)} onClick={() => void act("Collateral claim", () => claimDefault(loan.offerId), `${me.handle} claimed the slab for defaulted loan #${loan.offerId}.`)}>
          Claim slab collateral
        </Button>
      ) : null}
    </div>
  );
}

function Term({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-surface-2 p-2.5"><p className="text-dim">{label}</p><p className="mt-0.5 font-bold text-white">{value}</p></div>;
}
