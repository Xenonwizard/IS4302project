"use client";

import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, Check, CircleDollarSign, PackagePlus, Save, X } from "lucide-react";
import type { Address } from "viem";
import { newOfferId, useTradeActions, useTradeSlabs, type TradeSlab } from "@/lib/chain/trades";
import { anchorListing, valuedSlab } from "@/lib/chain/slabValue";
import { useMarketChain } from "@/lib/chain/useMarketChain";
import { usd } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { ChatTrade, ChatTradeSide, ChatTradeSlab } from "@/lib/types";
import { Avatar, Badge, Button, inputClass, Modal } from "../ui/primitives";
import { Slab } from "../slab/Slab";
import { BalancePanel } from "./TradeParts";

/** What to start the builder from when answering an offer with a counter-offer. */
export interface CounterOf {
  offerId: string;
  /** what the other side offered: their slabs are in escrow now, but can still be asked for again */
  theirSide: ChatTradeSide;
  mySide: ChatTradeSide;
}

const exact = (n: number) => usd(n, { cents: true });

/**
 * Builds a trade inside a chat: pick slabs from both vaults, compare their Pokechain records,
 * and add cash either way. Sending locks your side in TradeEscrow and drops the offer into the chat.
 */
export function TradeBuilder({
  open,
  onClose,
  negotiationId,
  me,
  them,
  cash,
  counterOf,
  initialRequestedTokenId,
}: {
  open: boolean;
  onClose: () => void;
  negotiationId: string;
  me: { address: Address; handle: string };
  them: { address: Address; handle: string };
  /** USDC in my Pokechain account, the cash I can put in an offer */
  cash: number;
  counterOf?: CounterOf;
  /** Slab whose asset page opened this trade builder. */
  initialRequestedTokenId?: string;
}) {
  if (!open) return null;
  return <Form key={`${negotiationId}:${counterOf?.offerId ?? "new"}`} onClose={onClose} negotiationId={negotiationId} me={me} them={them} cash={cash} counterOf={counterOf} initialRequestedTokenId={initialRequestedTokenId} />;
}

type TradeDraft = { give: string[]; get: string[]; giveCash: string; getCash: string };

function draftKey(negotiationId: string, counterOf?: CounterOf) {
  return `pokechain:trade-draft:${negotiationId}:${counterOf?.offerId ?? "new"}`;
}

function Form({
  onClose,
  negotiationId,
  me,
  them,
  cash,
  counterOf,
  initialRequestedTokenId,
}: {
  onClose: () => void;
  negotiationId: string;
  me: { address: Address; handle: string };
  them: { address: Address; handle: string };
  cash: number;
  counterOf?: CounterOf;
  initialRequestedTokenId?: string;
}) {
  const { create, counter } = useTradeActions();
  const { pushToast, postTrade } = useStore();
  const { cancelListing } = useMarketChain();
  const { data: mine = [] } = useTradeSlabs(me.address);
  const { data: theirs = [] } = useTradeSlabs(them.address);

  const [give, setGive] = useState<string[]>(counterOf?.mySide.slabs.map((s) => s.tokenId) ?? []);
  const requestedTokenId = counterOf ? undefined : initialRequestedTokenId;
  const [get, setGet] = useState<string[]>(
    counterOf?.theirSide.slabs.map((s) => s.tokenId) ?? (requestedTokenId ? [requestedTokenId] : []),
  );
  // Strings, so the fields can be cleared and retyped.
  const [giveCash, setGiveCash] = useState(counterOf?.mySide.cash ? String(counterOf.mySide.cash) : "");
  const [getCash, setGetCash] = useState(counterOf?.theirSide.cash ? String(counterOf.theirSide.cash) : "");
  const [draftReady, setDraftReady] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [draftDirty, setDraftDirty] = useState(false);
  const [restartOpen, setRestartOpen] = useState(false);
  const [itemPicker, setItemPicker] = useState<{ side: "give" | "get"; selected: string[] } | null>(null);
  const [cashDialog, setCashDialog] = useState<{ side: "give" | "get"; value: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const key = draftKey(negotiationId, counterOf);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) {
        const draft = JSON.parse(raw) as Partial<TradeDraft>;
        if (Array.isArray(draft.give)) setGive(draft.give.filter((id): id is string => typeof id === "string"));
        if (Array.isArray(draft.get)) {
          const saved = draft.get.filter((id): id is string => typeof id === "string");
          setGet(requestedTokenId && !saved.includes(requestedTokenId) ? [...saved, requestedTokenId] : saved);
        }
        if (typeof draft.giveCash === "string") setGiveCash(draft.giveCash);
        if (typeof draft.getCash === "string") setGetCash(draft.getCash);
        setDraftSaved(true);
      }
    } catch {
      // Ignore unavailable or malformed local drafts.
    }
    setDraftReady(true);
  }, [key, requestedTokenId]);

  // Their slabs the offer being countered already names are in escrow, so they aren't in their vault list.
  const theirPool: TradeSlab[] = useMemo(() => {
    const held = new Set(theirs.map((s) => s.tokenId));
    const fromOffer = (counterOf?.theirSide.slabs ?? []).filter((s) => !held.has(s.tokenId)).map((s) => ({ tokenId: s.tokenId, title: s.title, image: s.image, grader: s.grader, certNumber: s.certNumber }));
    return [...theirs, ...fromOffer];
  }, [theirs, counterOf]);

  const face = (s: TradeSlab): ChatTradeSlab => valuedSlab(s);
  const myCash = Number(giveCash || 0);
  const theirCash = Number(getCash || 0);
  const giveSide: ChatTradeSide = { slabs: mine.filter((s) => give.includes(s.tokenId)).map(face), cash: Number.isFinite(myCash) ? myCash : 0 };
  const getSide: ChatTradeSide = { slabs: theirPool.filter((s) => get.includes(s.tokenId)).map(face), cash: Number.isFinite(theirCash) ? theirCash : 0 };
  const pickerSlabs = itemPicker?.side === "give" ? mine : itemPicker?.side === "get" ? theirPool : [];
  const openItemPicker = (side: "give" | "get") => setItemPicker({ side, selected: side === "give" ? give : get });
  const openCashDialog = (side: "give" | "get") => setCashDialog({ side, value: side === "give" ? giveCash : getCash });
  const confirmItems = () => {
    if (!itemPicker) return;
    if (itemPicker.side === "give") setGive(itemPicker.selected);
    else setGet(itemPicker.selected);
    setDraftDirty(true);
    setItemPicker(null);
  };
  const confirmCash = () => {
    if (!cashDialog) return;
    if (cashDialog.side === "give") setGiveCash(cashDialog.value);
    else setGetCash(cashDialog.value);
    setDraftDirty(true);
    setCashDialog(null);
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
      try { window.localStorage.removeItem(key); } catch { /* storage may be unavailable */ }
      pushToast({ title: counterOf ? "Counter-offer sent" : "Offer sent", body: "Your side is locked in TradeEscrow until they answer.", tone: "success" });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = () => {
    try {
      window.localStorage.setItem(key, JSON.stringify({ give, get, giveCash, getCash } satisfies TradeDraft));
      setDraftSaved(true);
      setDraftDirty(false);
      setError("");
      pushToast({ title: "Draft saved", body: "Your trade offer is saved in this browser for this chat.", tone: "success" });
    } catch {
      setError("This browser could not save the draft. Check your local storage settings and try again.");
    }
  };

  const restartFresh = () => {
    try { window.localStorage.removeItem(key); } catch { /* storage may be unavailable */ }
    setGive([]);
    setGet([]);
    setGiveCash("");
    setGetCash("");
    setDraftSaved(false);
    setDraftDirty(false);
    setRestartOpen(false);
    pushToast({ title: "Draft discarded", body: "You can build a new offer from scratch.", tone: "success" });
  };

  return (
    <>
    <section className="trade-room-enter flex h-[calc(100dvh-230px)] min-h-[480px] flex-col overflow-hidden rounded-card border border-hairline bg-surface lg:h-[calc(100vh-150px)]">
      <header className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-[14px] font-bold">{counterOf ? `Counter offer #${counterOf.offerId}` : `Trade offer to @${them.handle}`}</h2>
          <p className="text-[11px] text-muted">Choose slabs and USDC to exchange</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {draftReady ? (
            <Badge tone={draftDirty ? "warn" : draftSaved ? "good" : "neutral"}>
              {draftDirty ? "Unsaved changes" : draftSaved ? "Draft saved" : "No draft saved"}
            </Badge>
          ) : <Badge tone="neutral">Loading draft</Badge>}
          <button type="button" onClick={onClose} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-white/5 hover:text-white" aria-label="Close trade builder"><X size={17} /></button>
        </div>
      </header>

      <div className="cy-scroll flex-1 space-y-3 overflow-y-auto p-4">
        <p className="text-[12px] leading-relaxed text-muted">
          Build your side of the offer, then request the cards or USDC you want. Compare each card&apos;s Pokechain listings and completed trades to agree on your terms.
        </p>

        <TradeHeader
          me={me.handle}
          them={them.handle}
          onGiveCash={() => openCashDialog("give")}
          onGiveItems={() => openItemPicker("give")}
          onGetCash={() => openCashDialog("get")}
          onGetItems={() => openItemPicker("get")}
        />

      <div className="grid gap-3 md:grid-cols-2">
        <Column
          title="You give"
          slabs={mine}
          owner={me}
          selected={give}
          cash={giveCash}
          empty="No slabs added. Use Add items above to choose from your vault."
          onRemove={(id) => { setGive((current) => current.filter((tokenId) => tokenId !== id)); setDraftDirty(true); }}
        />
        <Column
          title={`You get from @${them.handle}`}
          slabs={theirPool}
          owner={them}
          selected={get}
          cash={getCash}
          empty={`No slabs requested. Use Request items above to choose from @${them.handle}'s vault.`}
          onRemove={(id) => { setGet((current) => current.filter((tokenId) => tokenId !== id)); setDraftDirty(true); }}
        />
      </div>

      <BalancePanel give={giveSide} get={getSide} />

      {error ? <p role="alert" className="rounded-lg bg-bad/10 px-3 py-2 text-[12.5px] text-bad">{error}</p> : null}
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline p-3">
        <span className="text-[11px] text-muted">{draftDirty ? "Save your latest changes to update this draft" : draftSaved ? "Saved in this browser" : "Your offer is not saved yet"}</span>
        <div className="flex flex-wrap justify-end gap-2">
          {draftSaved ? <Button variant="ghost" size="sm" onClick={() => setRestartOpen(true)} disabled={busy}>Start fresh</Button> : null}
          <Button variant="outline" size="sm" onClick={saveDraft} disabled={busy || !draftReady}><Save size={14} />Save draft</Button>
          <Button onClick={submit} disabled={busy || !draftReady} size="sm"><ArrowLeftRight size={14} />{busy ? "Signing…" : counterOf ? "Send counter-offer" : "Send offer"}</Button>
        </div>
      </footer>
    </section>
      <Modal open={restartOpen} onClose={() => setRestartOpen(false)} title="Start a fresh offer?" width="max-w-md">
        <div className="space-y-4 p-5">
          <p className="text-[13px] leading-relaxed text-muted">This clears the saved draft and resets the slabs and USDC in this offer. You can save a new draft at any time.</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRestartOpen(false)}>Keep draft</Button>
            <Button variant="danger" onClick={restartFresh}>Discard draft</Button>
          </div>
        </div>
      </Modal>
      <Modal
        open={itemPicker !== null}
        onClose={() => setItemPicker(null)}
        title={itemPicker?.side === "get" ? `Request items from @${them.handle}` : "Add items to your offer"}
        width="max-w-5xl"
      >
        <div className="flex max-h-[78vh] flex-col">
          <div className="cy-scroll flex-1 overflow-y-auto p-5">
            <p className="mb-4 text-[12px] text-muted">Choose the slabs you want to {itemPicker?.side === "get" ? "request" : "add"}. Select multiple cards if you like.</p>
            {pickerSlabs.length ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {pickerSlabs.map((slab) => {
                  const selected = Boolean(itemPicker?.selected.includes(slab.tokenId));
                  const owner = itemPicker?.side === "get" ? them : me;
                  const ownerAddress = itemPicker?.side === "get" ? them.address : me.address;
                  return (
                    <button
                      key={slab.tokenId}
                      type="button"
                      onClick={() => setItemPicker((current) => current ? {
                        ...current,
                        selected: current.selected.includes(slab.tokenId)
                          ? current.selected.filter((id) => id !== slab.tokenId)
                          : [...current.selected, slab.tokenId],
                      } : current)}
                      aria-pressed={selected}
                      className={clsx(
                        "group relative overflow-hidden rounded-xl border text-left transition hover:border-white/25",
                        selected ? "border-accent ring-1 ring-accent" : "border-hairline",
                      )}
                    >
                      <div className="bg-[#0c0c10] p-3">
                        <Slab listing={anchorListing(slab, owner.handle, ownerAddress)} sizes="(min-width: 640px) 200px, 42vw" />
                      </div>
                      <div className="p-3">
                        <p className="line-clamp-2 text-[12px] font-semibold">{slab.title}</p>
                        <p className="mt-1 text-[11px] text-muted">{slab.grader} · token #{slab.tokenId}</p>
                        {slab.listed && slab.listedPrice !== undefined ? <p className="mt-1 text-[11px] text-muted">Seller ask {exact(slab.listedPrice)}</p> : null}
                      </div>
                      {selected ? <span className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-accent text-white"><Check size={14} /></span> : null}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-hairline p-8 text-center text-[13px] text-muted">{itemPicker?.side === "get" ? `@${them.handle} has no vaulted slabs available to request.` : "You have no vaulted slabs available to add."}</p>
            )}
          </div>
          <footer className="flex items-center justify-between gap-3 border-t border-hairline px-5 py-3">
            <span className="text-[12px] text-muted">{itemPicker?.selected.length ?? 0} selected</span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setItemPicker(null)}>Cancel</Button>
              <Button onClick={confirmItems} disabled={!pickerSlabs.length}>{itemPicker?.side === "get" ? "Request items" : "Add items"}</Button>
            </div>
          </footer>
        </div>
      </Modal>

      <Modal
        open={cashDialog !== null}
        onClose={() => setCashDialog(null)}
        title={cashDialog?.side === "get" ? "Request USDC" : "Add USDC to your offer"}
        width="max-w-lg"
      >
        <div className="space-y-5 p-5">
          <label className="block text-center text-[12px] font-medium text-muted">
            Amount
            <div className="mx-auto mt-2 flex max-w-[260px] items-center justify-center gap-2">
              <input
                autoFocus
                className={clsx(inputClass, "h-12 text-center text-xl font-bold")}
                inputMode="decimal"
                placeholder="0"
                value={cashDialog?.value ?? ""}
                onChange={(event) => setCashDialog((current) => current ? { ...current, value: event.target.value.replace(/[^\d.]/g, "") } : current)}
                aria-label="USDC amount"
              />
              <span className="shrink-0 text-[12px] font-semibold text-muted">USDC</span>
            </div>
          </label>
          <div className="flex items-center justify-between rounded-xl bg-surface px-3 py-3 text-[12px]">
            <span className="text-muted">{cashDialog?.side === "get" ? "Requested amount" : "Available USDC"}</span>
            <strong>{cashDialog?.side === "get" ? exact(Number(cashDialog.value || 0)) : exact(cash)} USDC</strong>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCashDialog(null)}>Cancel</Button>
            <Button onClick={confirmCash}>{cashDialog?.side === "get" ? "Request cash" : "Add cash"}</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

function TradeHeader({
  me,
  them,
  onGiveCash,
  onGiveItems,
  onGetCash,
  onGetItems,
}: {
  me: string;
  them: string;
  onGiveCash: () => void;
  onGiveItems: () => void;
  onGetCash: () => void;
  onGetItems: () => void;
}) {
  const actions = (side: "give" | "get") => {
    const adding = side === "give";
    const cashClick = adding ? onGiveCash : onGetCash;
    const itemsClick = adding ? onGiveItems : onGetItems;
    return (
      <div className="flex flex-wrap gap-1.5">
        <Button type="button" size="sm" variant="outline" className="h-8 px-2.5 text-[11px]" onClick={cashClick}>
          <CircleDollarSign size={13} />{adding ? "Add cash" : "Request cash"}
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-8 px-2.5 text-[11px]" onClick={itemsClick}>
          <PackagePlus size={13} />{adding ? "Add items" : "Request items"}
        </Button>
      </div>
    );
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 rounded-xl border border-hairline bg-[#101014] px-3 py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Avatar name={me} size={26} />
        <span className="mr-1 text-[12px] font-bold">You</span>
        {actions("give")}
      </div>
      <div className="grid h-8 w-8 place-items-center rounded-full border border-hairline bg-surface-2 text-muted" aria-label="Trade between collectors">
        <ArrowLeftRight size={15} />
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
        {actions("get")}
        <Avatar name={them} size={26} />
        <span className="max-w-[90px] truncate text-[12px] font-bold" title={them}>{them}</span>
      </div>
    </div>
  );
}

function Column({
  title,
  slabs,
  owner,
  selected,
  cash,
  empty,
  onRemove,
}: {
  title: string;
  slabs: TradeSlab[];
  owner: { address: Address; handle: string };
  selected: string[];
  cash: string;
  empty: string;
  onRemove: (id: string) => void;
}) {
  const selectedSlabs = slabs.filter((slab) => selected.includes(slab.tokenId));
  return (
    <div className="rounded-xl bg-[#101014] p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-[11.5px] font-bold uppercase tracking-wide text-muted">{title}</p>
        <span className="text-[10px] font-medium text-muted">{selectedSlabs.length} selected</span>
      </div>
      {cash ? <p className="mb-3 rounded-lg bg-surface-2 px-3 py-2 text-[12px] text-muted">{title === "You give" ? "Adding" : "Requesting"} <strong className="text-white">{exact(Number(cash))} USDC</strong></p> : null}

      {selectedSlabs.length ? (
        <div className="mb-3 grid grid-cols-2 gap-2 2xl:grid-cols-3">
          {selectedSlabs.map((slab) => (
            <SelectedTradeCard
              key={`selected-${slab.tokenId}`}
              slab={slab}
              owner={owner}
              onRemove={() => onRemove(slab.tokenId)}
            />
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-hairline px-3 py-4 text-center text-[11px] text-dim">{empty}</p>
      )}
    </div>
  );
}

function SelectedTradeCard({
  slab,
  owner,
  onRemove,
}: {
  slab: TradeSlab;
  owner: { address: Address; handle: string };
  onRemove: () => void;
}) {
  const listing = anchorListing(slab, owner.handle, owner.address);
  return (
    <div className="fade-up overflow-hidden rounded-xl border border-hairline bg-surface-2/50 transition-all duration-200 hover:-translate-y-0.5 hover:border-white/20 hover:shadow-lg motion-reduce:transition-none">
      <div className="relative flex aspect-square items-center justify-center bg-[radial-gradient(ellipse_at_center,_rgba(255,255,255,0.12),_rgba(18,18,22,1)_70%)] p-2">
        <div className="h-[82%] aspect-[0.62]">
          <Slab listing={listing} fit sizes="(min-width: 1024px) 120px, 28vw" />
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${slab.title} from trade`}
          className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-black/70 text-white transition-transform duration-150 hover:scale-105 hover:bg-black"
        >
          <X size={15} />
        </button>
      </div>
      <div className="p-2.5">
        <p className="line-clamp-2 text-[11px] font-semibold" title={slab.title}>{slab.title}</p>
        <p className="mt-1 text-[10px] text-muted">{slab.grader} · token #{slab.tokenId}</p>
        {slab.listed && slab.listedPrice !== undefined ? <p className="mt-1 text-[10px] text-muted">Seller ask {exact(slab.listedPrice)}</p> : null}
      </div>
    </div>
  );
}
