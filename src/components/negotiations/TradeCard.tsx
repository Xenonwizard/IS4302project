"use client";

import clsx from "clsx";
import { ArrowLeftRight, Check, Lock, Undo2, X } from "lucide-react";
import { useState } from "react";
import type { Address } from "viem";
import { usePublicClient } from "wagmi";
import { contracts } from "@/lib/chain/config";
import { useTradeActions, type TradeOffer } from "@/lib/chain/trades";
import { useMarketChain } from "@/lib/chain/useMarketChain";
import { usd } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { ChatMessage, ChatTradeSide } from "@/lib/types";
import { Badge, Button } from "../ui/primitives";
import { BalancePanel, SlabTile } from "./TradeParts";

const exact = (n: number) => usd(n, { cents: true });

/**
 * A multi-slab trade offer in the chat. The chain says whether it is still open; the message says
 * what it is made of and what the sender counted each slab at. The balance is worked out for whoever
 * is looking and shown only to them.
 */
export function TradeCard({
  message,
  negotiationId,
  me,
  offer,
  onCounter,
}: {
  message: ChatMessage;
  negotiationId: string;
  me: { address: Address; handle: string };
  /** the live TradeEscrow record, once read */
  offer?: TradeOffer;
  onCounter: (trade: NonNullable<ChatMessage["trade"]>) => void;
}) {
  const trade = message.trade!;
  const iSent = trade.maker.toLowerCase() === me.address.toLowerCase();
  const { accept, decline, withdraw } = useTradeActions();
  const { cancelListing } = useMarketChain();
  const client = usePublicClient();
  const { pushToast, chatNote } = useStore();
  const [busy, setBusy] = useState<string | null>(null);

  // From my chair: what I give and what I get.
  const mine: ChatTradeSide = iSent ? trade.give : trade.get;
  const theirs: ChatTradeSide = iSent ? trade.get : trade.give;
  const status = offer?.status;
  const open = status === "Open";

  const act = async (name: string, fn: () => Promise<unknown>, done: string, note: string) => {
    setBusy(name);
    try {
      await fn();
      chatNote(negotiationId, note);
      pushToast({ title: done, tone: "success" });
    } catch (e) {
      pushToast({ title: `${name} failed`, body: (e as Error).message, tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  // Slabs that are listed for sale can't move in a trade, so the sale is cancelled first (a visible chain call).
  const delistMine = async () => {
    for (const id of offer?.takerSlabs ?? []) {
      const listed = await client?.readContract({ ...contracts.slabVault, functionName: "isListed", args: [BigInt(id)] }).catch(() => false);
      if (listed) await cancelListing(id);
    }
  };

  const tone = status === "Open" ? "accent" : status === "Accepted" ? "good" : "neutral";
  const label = !status ? "Checking…" : status === "Open" ? (iSent ? "Waiting for them" : "Your move") : status === "Countered" ? "Countered" : status;
  const faded = status && status !== "Open" && status !== "Accepted";

  return (
    <div
      data-testid="trade-card"
      data-offer-id={trade.offerId}
      className={clsx(
        "w-full max-w-[640px] rounded-2xl border bg-surface p-3.5 text-left",
        open ? "border-accent/60" : status === "Accepted" ? "border-good/50" : "border-hairline",
        faded && "opacity-70",
      )}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[12.5px]">
        <ArrowLeftRight size={14} className="text-accent" />
        <span className="font-bold text-white">
          {iSent ? "You offered a trade" : "Trade offer"} · #{trade.offerId}
        </span>
        {trade.counterOf ? <span className="text-dim">counter to #{trade.counterOf}</span> : null}
        <Badge tone={tone} className="ml-auto">
          {status === "Accepted" ? <Check size={11} /> : null}
          <span data-testid="trade-status">{label}</span>
        </Badge>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <Side title="You give" side={mine} locked={iSent && open} />
        <Side title="You get" side={theirs} locked={!iSent && open} />
      </div>

      <div className="mt-3">
        <BalancePanel give={mine} get={theirs} compact />
        <p className="mt-1.5 text-[11px] text-dim">Only you see this balance. The other side is not told how you read the offer.</p>
      </div>

      {open ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {iSent ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={Boolean(busy)}
              onClick={() => act("Withdraw", () => withdraw(trade.offerId), `Offer #${trade.offerId} withdrawn; your side is back`, `${me.handle} withdrew trade #${trade.offerId}.`)}
            >
              <Undo2 size={13} /> {busy === "Withdraw" ? "Withdrawing…" : "Withdraw offer"}
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                disabled={Boolean(busy)}
                onClick={() =>
                  act(
                    "Accept",
                    async () => {
                      await delistMine();
                      return accept(trade.offerId);
                    },
                    `Trade #${trade.offerId} settled: everything swapped`,
                    `${me.handle} accepted trade #${trade.offerId}. Every slab and the cash swapped in one transaction.`,
                  )
                }
              >
                <Check size={13} /> {busy === "Accept" ? "Swapping…" : "Accept trade"}
              </Button>
              <Button size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => onCounter(trade)}>
                <ArrowLeftRight size={13} /> Counter
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={Boolean(busy)}
                onClick={() => act("Decline", () => decline(trade.offerId), `Offer #${trade.offerId} declined; their side was refunded`, `${me.handle} declined trade #${trade.offerId}.`)}
              >
                <X size={13} /> {busy === "Decline" ? "Declining…" : "Decline"}
              </Button>
            </>
          )}
          <span className="text-[11.5px] text-dim">
            {iSent
              ? "Your side is locked in TradeEscrow until they answer or you withdraw."
              : "Accepting moves your side to them and their escrowed side to you, in one transaction."}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function Side({ title, side, locked }: { title: string; side: ChatTradeSide; locked?: boolean }) {
  return (
    <div className="rounded-xl bg-[#101014] p-2.5">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted">
        {title} {locked ? <Lock size={11} className="text-accent" aria-label="Locked in escrow" /> : null}
      </p>
      <div className="flex flex-wrap gap-2">
        {side.slabs.map((s) => (
          <SlabTile key={s.tokenId} slab={s} />
        ))}
        {side.cash > 0 ? (
          <span className="grid h-[84px] min-w-[84px] place-items-center rounded-lg border border-good/30 bg-good-bg px-2 text-[14px] font-bold text-good">
            {exact(side.cash)}
          </span>
        ) : null}
        {!side.slabs.length && !side.cash ? <span className="text-[12px] text-dim">Nothing</span> : null}
      </div>
    </div>
  );
}
