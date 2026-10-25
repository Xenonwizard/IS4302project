"use client";

import clsx from "clsx";
import { useMemo, useState } from "react";
import type { Address } from "viem";
import { newOfferId, useTradeActions, useTradeSlabs, type TradeSlab } from "@/lib/chain/trades";
import { valuedSlab } from "@/lib/chain/slabValue";
import { useMarketChain } from "@/lib/chain/useMarketChain";
import { usd } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { ChatTrade, ChatTradeSide, ChatTradeSlab } from "@/lib/types";
import { type ValueBasis } from "@/lib/valuation";
import { Fn, OnChainNote } from "../chain/ui";
import { Button, Modal, inputClass } from "../ui/primitives";
import { BalancePanel, SlabTile } from "./TradeParts";

/** What to start the builder from when answering an offer with a counter-offer. */
export interface CounterOf {
  offerId: string;
  /** what the other side offered: their slabs are in escrow now, but can still be asked for again */
  theirSide: ChatTradeSide;
  mySide: ChatTradeSide;
}

const exact = (n: number) => usd(n, { cents: true });

/**
 * Builds a trade inside a chat: pick slabs from both vaults, choose for each whether it counts at its
 * market value or at the value its owner stated, add cash either way, and watch the balance before
 * sending. Sending locks your side in TradeEscrow and drops the offer into the chat.
 */
export function TradeBuilder({
  open,
  onClose,
  negotiationId,
  me,
  them,
  cash,
  counterOf,
  preselect,
}: {
  open: boolean;
  onClose: () => void;
  negotiationId: string;
  me: { address: Address; handle: string };
  them: { address: Address; handle: string };
  /** USDC in my Pokechain account, the cash I can put in an offer */
  cash: number;
  counterOf?: CounterOf;
  /** a new offer starts with these picked, e.g. the slab the chat is about */
  preselect?: { mine: string[]; theirs: string[] };
}) {
  return (
    <Modal open={open} onClose={onClose} title={counterOf ? `Counter offer #${counterOf.offerId}` : `Trade offer to @${them.handle}`} width="max-w-5xl">
      {/* remounted per open so the fields start from the right place */}
      <Form key={counterOf?.offerId ?? "new"} onClose={onClose} negotiationId={negotiationId} me={me} them={them} cash={cash} counterOf={counterOf} preselect={preselect} />
    </Modal>
  );
}

function Form({
  onClose,
  negotiationId,
  me,
  them,
  cash,
  counterOf,
  preselect,
}: {
  onClose: () => void;
  negotiationId: string;
  me: { address: Address; handle: string };
  them: { address: Address; handle: string };
  cash: number;
  counterOf?: CounterOf;
  preselect?: { mine: string[]; theirs: string[] };
}) {
  const { create, counter } = useTradeActions();
  const { pushToast, postTrade } = useStore();
  const { cancelListing } = useMarketChain();
  const { data: mine = [] } = useTradeSlabs(me.address);
  const { data: theirs = [] } = useTradeSlabs(them.address);

  const [give, setGive] = useState<string[]>(counterOf?.mySide.slabs.map((s) => s.tokenId) ?? preselect?.mine ?? []);
  const [get, setGet] = useState<string[]>(counterOf?.theirSide.slabs.map((s) => s.tokenId) ?? preselect?.theirs ?? []);
  const [basis, setBasis] = useState<Record<string, ValueBasis>>(() =>
    Object.fromEntries([...(counterOf?.mySide.slabs ?? []), ...(counterOf?.theirSide.slabs ?? [])].map((s) => [s.tokenId, s.basis])),
  );
  // Strings, so the fields can be cleared and retyped.
  const [giveCash, setGiveCash] = useState(counterOf?.mySide.cash ? String(counterOf.mySide.cash) : "");
  const [getCash, setGetCash] = useState(counterOf?.theirSide.cash ? String(counterOf.theirSide.cash) : "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Their slabs the offer being countered already names are in escrow, so they aren't in their vault list.
  const theirPool: TradeSlab[] = useMemo(() => {
    const held = new Set(theirs.map((s) => s.tokenId));
    const fromOffer = (counterOf?.theirSide.slabs ?? []).filter((s) => !held.has(s.tokenId)).map((s) => ({ ...s, declaredValueCents: Math.round(s.stated * 100) }));
    return [...theirs, ...fromOffer];
  }, [theirs, counterOf]);

  const face = (s: TradeSlab): ChatTradeSlab => valuedSlab(s, basis[s.tokenId] ?? "market");
  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const myCash = Number(giveCash || 0);
  const theirCash = Number(getCash || 0);
  const giveSide: ChatTradeSide = { slabs: mine.filter((s) => give.includes(s.tokenId)).map(face), cash: Number.isFinite(myCash) ? myCash : 0 };
  const getSide: ChatTradeSide = { slabs: theirPool.filter((s) => get.includes(s.tokenId)).map(face), cash: Number.isFinite(theirCash) ? theirCash : 0 };

  const evenOut = (side: "give" | "get", extra: number) => {
    const add = (v: string) => String(Math.round((Number(v || 0) + extra) * 100) / 100);
    if (side === "give") setGiveCash(add);
    else setGetCash(add);
  };

  const submit = async () => {
    const problem =
      !Number.isFinite(myCash) || !Number.isFinite(theirCash) || myCash < 0 || theirCash < 0
        ? "Cash amounts must be numbers of 0 or more."
        : !giveSide.slabs.length && !myCash
          ? "Add at least one of your slabs, or some cash, to what you give."
          : !getSide.slabs.length && !theirCash
            ? `Pick at least one of @${them.handle}'s slabs, or ask for cash.`
            : give.length > 10 || get.length > 10
              ? "At most 10 slabs on each side."
              : myCash > cash
                ? `You have ${exact(cash)} in your Pokechain account. Deposit more in Wallet first.`
                : "";
    setError(problem);
    if (problem) return;
    setBusy(true);
    try {
      // A listed slab can't be locked in escrow, so its sale is cancelled first (its own transaction).
      for (const x of mine) if (give.includes(x.tokenId) && x.listed) await cancelListing(x.tokenId);
      const terms = { mySlabs: giveSide.slabs.map((x) => x.tokenId), myCash, theirSlabs: getSide.slabs.map((x) => x.tokenId), theirCash };
      const receipt = counterOf ? await counter(counterOf.offerId, terms) : await create(them.address, them.handle, terms, negotiationId);
      const offerId = newOfferId(receipt);
      if (!offerId) throw new Error("The offer went through, but its id could not be read from the chain.");
      const trade: ChatTrade = {
        offerId,
        maker: me.address,
        taker: them.address,
        give: giveSide,
        get: getSide,
        ...(counterOf ? { counterOf: counterOf.offerId } : {}),
      };
      postTrade(negotiationId, trade);
      pushToast({ title: counterOf ? "Counter-offer sent" : "Offer sent", body: "Your side is locked in TradeEscrow until they answer.", tone: "success" });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 p-5">
      <p className="text-[13px] leading-relaxed text-muted">
        Pick slabs from both vaults and add cash if you like. Count each slab at its <b className="text-white">market</b> value or the value
        its owner <b className="text-white">stated</b> when they submitted it. The balance below shows who comes out ahead, only to you.
      </p>

      <div className="grid gap-3 md:grid-cols-2">
        <Column
          title="You give"
          slabs={mine}
          face={face}
          selected={give}
          onToggle={(id) => toggle(give, setGive, id)}
          onBasis={(id, b) => setBasis((p) => ({ ...p, [id]: b }))}
          cash={giveCash}
          onCash={setGiveCash}
          hint={`You have ${exact(cash)} in your Pokechain account`}
          empty="You have no vaulted slabs to offer. Slabs in another open offer are locked there."
          listedNote="Listed for sale: the listing is cancelled when you send"
        />
        <Column
          title={`You get from @${them.handle}`}
          slabs={theirPool}
          face={face}
          selected={get}
          onToggle={(id) => toggle(get, setGet, id)}
          onBasis={(id, b) => setBasis((p) => ({ ...p, [id]: b }))}
          cash={getCash}
          onCash={setGetCash}
          hint="Cash they add"
          empty={`@${them.handle} has no vaulted slabs right now. You can still ask for cash.`}
          listedNote="Listed for sale: it is delisted if they accept"
        />
      </div>

      <BalancePanel give={giveSide} get={getSide} onEvenOut={evenOut} />

      {error ? <p role="alert" className="rounded-lg bg-bad/10 px-3 py-2 text-[12.5px] text-bad">{error}</p> : null}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={submit} disabled={busy}>
          {busy ? "Signing…" : counterOf ? "Send counter-offer" : "Send offer"}
        </Button>
      </div>

      <OnChainNote
        tech={
          counterOf ? (
            <>
              <Fn>TradeEscrow.counter(#{counterOf.offerId}, mySlabs, myCash, theirSlabs, theirCash)</Fn> closes their offer (refunding it) and opens
              yours in one transaction. A listed slab of yours goes through <Fn>SlabMarket.cancelListing</Fn> first.
            </>
          ) : (
            <>
              <Fn>TradeEscrow.createOffer(@{them.handle}, yourSlabs, yourCash, theirSlabs, theirCash, chat)</Fn>, after{" "}
              <Fn>SlabMarket.cancelListing</Fn> for any listed slab of yours. They answer with <Fn>accept</Fn>, <Fn>counter</Fn> or{" "}
              <Fn>decline</Fn>; you can <Fn>withdraw</Fn>.
            </>
          )
        }
      >
        {counterOf
          ? "Their offer is cancelled and they get their slabs and cash back. Your counter-offer takes its place: your slabs and cash are held by the trade contract until they answer."
          : `Your slabs and cash are held by the trade contract, so you can't sell or move them while the offer is open. Nothing of @${them.handle}'s moves until they accept. When they do, everything swaps in one go, or nothing does. If one of your slabs is listed for sale, its listing is cancelled first.`}{" "}
        The market and stated values only help you two weigh the deal; the contract moves exactly what the offer lists.
      </OnChainNote>
    </div>
  );
}

function Column({
  title,
  slabs,
  face,
  selected,
  onToggle,
  onBasis,
  cash,
  onCash,
  hint,
  empty,
  listedNote,
}: {
  title: string;
  slabs: TradeSlab[];
  face: (s: TradeSlab) => ChatTradeSlab;
  selected: string[];
  onToggle: (id: string) => void;
  onBasis: (id: string, b: ValueBasis) => void;
  cash: string;
  onCash: (v: string) => void;
  hint: string;
  empty: string;
  /** what happens to a slab that is listed for sale if it goes into the trade */
  listedNote: string;
}) {
  return (
    <div className="rounded-xl bg-[#101014] p-3">
      <p className="mb-2 text-[11.5px] font-bold uppercase tracking-wide text-muted">{title}</p>
      <div className="flex max-h-[330px] flex-wrap gap-2 overflow-y-auto">
        {slabs.length ? (
          slabs.map((s) => (
            <SlabTile
              key={s.tokenId}
              slab={face(s)}
              selected={selected.includes(s.tokenId)}
              note={s.listed ? listedNote : undefined}
              onClick={() => onToggle(s.tokenId)}
              onBasis={(b) => onBasis(s.tokenId, b)}
            />
          ))
        ) : (
          <p className="text-[12px] text-dim">{empty}</p>
        )}
      </div>
      <label className="mt-3 block text-[12px] font-semibold text-muted">
        Plus cash (USDC)
        <input
          className={clsx(inputClass, "mt-1 h-10")}
          inputMode="decimal"
          placeholder="0"
          value={cash}
          onChange={(e) => onCash(e.target.value.replace(/[^\d.]/g, ""))}
          aria-label={`${title}: cash`}
        />
      </label>
      <p className="mt-1 text-[11px] text-dim">{hint}</p>
    </div>
  );
}
