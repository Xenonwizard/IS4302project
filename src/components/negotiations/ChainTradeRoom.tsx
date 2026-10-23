"use client";

import clsx from "clsx";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowLeftRight, Check, Lock, Plus, Undo2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { isAddress, type Address } from "viem";
import { useReadContract } from "wagmi";
import { contracts } from "@/lib/chain/config";
import { useOnchainAccount } from "@/lib/chain/useOnchainAccount";
import {
  roomIdFor,
  useSlabDetails,
  useTradeActions,
  useTradeEvents,
  useTradeOffers,
  useTradeSlabs,
  type OfferTerms,
  type TradeOffer,
  type TradeSlab,
} from "@/lib/chain/trades";
import { usd } from "@/lib/format";
import { useStore } from "@/lib/store";
import { Fn, OnChainNote } from "../chain/ui";
import { Avatar, Badge, Button, TimeAgo, inputClass } from "../ui/primitives";

/**
 * A trade room between two collectors, run entirely on TradeEscrow. Either side builds an offer
 * from both vaults plus cash ("3 Pikachus + $50 for your 2 Articunos"); the sender's side is locked
 * in escrow; the other side accepts (everything swaps in one transaction), declines, or counters.
 * Route: /trades/chain-<their wallet address>.
 */
export function ChainTradeRoom({ other }: { other: string }) {
  const { user, ready, requireAuth } = useStore();
  const me = useOnchainAccount();
  const them = isAddress(other) ? (other as Address) : undefined;
  const { data: record } = useReadContract({
    ...contracts.accounts,
    functionName: "accountOf",
    args: them ? [them] : undefined,
    query: { enabled: Boolean(them) },
  });

  if (!ready) return <div className="px-4 py-5 lg:px-6"><div className="skeleton h-[70vh] rounded-card" /></div>;
  if (!user?.address || !me.address) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-xl font-bold">Log in with your wallet to trade</h1>
        <p className="max-w-sm text-sm text-muted">On-chain trades are signed by your wallet, so they need a wallet account.</p>
        <Button size="lg" onClick={() => requireAuth()}>Log in</Button>
      </div>
    );
  }
  if (!them || (record && record.status !== 1) || them.toLowerCase() === me.address.toLowerCase()) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-xl font-bold">No one to trade with here</h1>
        <p className="max-w-sm text-sm text-muted">
          {them?.toLowerCase() === me.address.toLowerCase()
            ? "That's your own wallet. You can't trade with yourself."
            : "That address has no active Pokechain account."}
        </p>
        <Link href="/trades"><Button size="lg">Back to negotiation rooms</Button></Link>
      </div>
    );
  }
  return <Room me={me.address} myHandle={user.username} them={them} theirHandle={record?.handle ?? "…"} cash={me.custodyBalance} />;
}

type Draft = OfferTerms & { counterOf?: string };

function Room({ me, myHandle, them, theirHandle, cash }: { me: Address; myHandle: string; them: Address; theirHandle: string; cash: number }) {
  useTradeEvents(true);
  const { data: offers = [] } = useTradeOffers(me, them);
  const { data: mySlabs = [] } = useTradeSlabs(me);
  const { data: theirSlabs = [] } = useTradeSlabs(them);
  const allIds = offers.flatMap((o) => [...o.makerSlabs, ...o.takerSlabs]);
  const { data: details = {} } = useSlabDetails(allIds);
  const [draft, setDraft] = useState<Draft | null>(null);
  const open = offers.filter((o) => o.status === "Open");

  const slab = (id: string): TradeSlab | undefined =>
    mySlabs.find((s) => s.tokenId === id) ?? theirSlabs.find((s) => s.tokenId === id) ?? details[id];

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-6 lg:px-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/trades" className="grid h-9 w-9 place-items-center rounded-xl bg-surface-2 text-muted hover:text-white" aria-label="Back to negotiation rooms">
          <ArrowLeft size={17} />
        </Link>
        <Avatar name={theirHandle} size={34} />
        <div className="min-w-0 flex-1">
          <h1 className="text-[20px] font-bold">Trade with @{theirHandle}</h1>
          <p className="text-[12.5px] text-muted">
            Slabs and cash, both ways. Settled on-chain by <Fn>TradeEscrow</Fn>: all at once, or not at all.
          </p>
        </div>
        {!draft ? (
          <Button onClick={() => setDraft({ mySlabs: [], myCash: 0, theirSlabs: [], theirCash: 0 })}>
            <Plus size={15} /> Make an offer
          </Button>
        ) : null}
      </div>

      {draft ? (
        <OfferBuilder
          key={draft.counterOf ?? "new"}
          draft={draft}
          me={me}
          them={them}
          theirHandle={theirHandle}
          mySlabs={mySlabs}
          theirSlabs={[
            ...theirSlabs,
            // Countering: the slabs they offered are in escrow now, but you can still ask for them.
            ...(draft.counterOf ? draft.theirSlabs.filter((id) => !theirSlabs.some((s) => s.tokenId === id)).flatMap((id) => (slab(id) ? [slab(id)!] : [])) : []),
          ]}
          cash={cash}
          onClose={() => setDraft(null)}
        />
      ) : null}

      <section className="space-y-3">
        <h2 className="text-[15px] font-bold">
          Offers {open.length ? <Badge tone="accent">{open.length} open</Badge> : null}
        </h2>
        {offers.length ? (
          offers.map((o) => (
            <OfferCard
              key={o.id}
              offer={o}
              me={me}
              myHandle={myHandle}
              theirHandle={theirHandle}
              slab={slab}
              onCounter={() =>
                setDraft({ counterOf: o.id, mySlabs: o.takerSlabs, myCash: o.takerCash, theirSlabs: o.makerSlabs, theirCash: o.makerCash })
              }
            />
          ))
        ) : (
          <div className="rounded-card border border-dashed border-hairline py-10 text-center text-[13px] text-muted">
            No offers yet. Click <b className="text-white">Make an offer</b> and pick slabs from both vaults, plus cash on either side.
          </div>
        )}
      </section>
    </div>
  );
}

/* ------------------------------- offer card ------------------------------- */

function OfferCard({
  offer: o,
  me,
  myHandle,
  theirHandle,
  slab,
  onCounter,
}: {
  offer: TradeOffer;
  me: Address;
  myHandle: string;
  theirHandle: string;
  slab: (id: string) => TradeSlab | undefined;
  onCounter: () => void;
}) {
  const { accept, decline, withdraw } = useTradeActions();
  const { pushToast } = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  const iMade = o.maker === me;
  const makerName = iMade ? `You (@${myHandle})` : `@${theirHandle}`;
  const takerName = iMade ? `@${theirHandle}` : `You (@${myHandle})`;

  const act = async (name: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(name);
    try {
      await fn();
      pushToast({ title: done, tone: "success" });
    } catch (e) {
      pushToast({ title: `${name} failed`, body: (e as Error).message, tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const tone = o.status === "Open" ? "accent" : o.status === "Accepted" ? "good" : "neutral";
  return (
    <div className={clsx("rounded-card border bg-surface p-4", o.status === "Open" ? "border-accent/40" : "border-hairline")}>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[12.5px]">
        <span className="font-bold text-white">Offer #{o.id}</span>
        <Badge tone={tone}>{o.status === "Open" ? (iMade ? "Waiting for them" : "Your move") : o.status}</Badge>
        {o.counterOf !== "0" ? <span className="text-dim">counter to #{o.counterOf}</span> : null}
        <span className="ml-auto text-dim">
          <TimeAgo value={(o.closedAt || o.createdAt) * 1000} />
        </span>
      </div>

      <div className="grid items-stretch gap-3 md:grid-cols-[1fr_auto_1fr]">
        <Side title={`${makerName} give${iMade ? "" : "s"}`} ids={o.makerSlabs} cash={o.makerCash} slab={slab} locked={o.status === "Open"} />
        <span className="grid place-items-center text-dim"><ArrowLeftRight size={18} /></span>
        <Side title={`${takerName} give${iMade ? "s" : ""}`} ids={o.takerSlabs} cash={o.takerCash} slab={slab} />
      </div>

      {o.status === "Open" ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {iMade ? (
            <Button size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => act("Withdraw", () => withdraw(o.id), `Offer #${o.id} withdrawn; your side is back`)}>
              <Undo2 size={13} /> {busy === "Withdraw" ? "Withdrawing…" : "Withdraw offer"}
            </Button>
          ) : (
            <>
              <Button size="sm" disabled={Boolean(busy)} onClick={() => act("Accept", () => accept(o.id), `Trade #${o.id} settled: everything swapped`)}>
                <Check size={13} /> {busy === "Accept" ? "Swapping…" : "Accept trade"}
              </Button>
              <Button size="sm" variant="secondary" disabled={Boolean(busy)} onClick={onCounter}>
                <ArrowLeftRight size={13} /> Counter
              </Button>
              <Button size="sm" variant="danger" disabled={Boolean(busy)} onClick={() => act("Decline", () => decline(o.id), `Offer #${o.id} declined; their side was refunded`)}>
                <X size={13} /> {busy === "Decline" ? "Declining…" : "Decline"}
              </Button>
            </>
          )}
          <span className="text-[11.5px] text-dim">
            {iMade
              ? "Your side is locked in TradeEscrow until they answer or you withdraw."
              : "Accepting moves your side to them and their escrowed side to you, in one transaction."}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function Side({ title, ids, cash, slab, locked }: { title: string; ids: string[]; cash: number; slab: (id: string) => TradeSlab | undefined; locked?: boolean }) {
  return (
    <div className="rounded-xl bg-[#101014] p-3">
      <p className="mb-2 flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-wide text-muted">
        {title} {locked ? <Lock size={11} className="text-accent" aria-label="Locked in escrow" /> : null}
      </p>
      <div className="flex flex-wrap gap-2">
        {ids.map((id) => (
          <SlabThumb key={id} slab={slab(id)} id={id} />
        ))}
        {cash > 0 ? (
          <span className="grid h-[84px] min-w-[72px] place-items-center rounded-lg border border-good/30 bg-good-bg px-2 text-[14px] font-bold text-good">
            {usd(cash, { cents: true })}
          </span>
        ) : null}
        {!ids.length && !cash ? <span className="text-[12px] text-dim">Nothing</span> : null}
      </div>
    </div>
  );
}

function SlabThumb({ slab, id, selected, onClick }: { slab?: TradeSlab; id: string; selected?: boolean; onClick?: () => void }) {
  const body = (
    <>
      <span className="relative block h-[84px] w-[60px] overflow-hidden rounded-md bg-surface-2">
        {slab?.image ? <Image src={slab.image} alt="" fill sizes="60px" className="object-cover" /> : null}
        {selected ? (
          <span className="absolute inset-0 grid place-items-center bg-accent/50 text-white"><Check size={20} /></span>
        ) : null}
      </span>
      <span className="mt-1 block w-[60px] truncate text-[10.5px] font-semibold text-white" title={slab?.title}>
        {cardName(slab?.title) ?? `Token #${id}`}
      </span>
      <span className="block text-[10px] text-dim">#{id}</span>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={clsx("rounded-lg p-1 text-left transition", selected ? "bg-accent/20 ring-2 ring-accent" : "hover:bg-white/5")} aria-pressed={selected} aria-label={`${slab?.title ?? "Token"} #${id}`}>
      {body}
    </button>
  ) : (
    <span className="p-1">{body}</span>
  );
}

/** "2023 Pokémon 151 #173/165 Pikachu - Illustration Rare (PSA 9 MINT)" → "Pikachu" */
function cardName(title?: string) {
  if (!title) return undefined;
  return title.match(/#\S+\s+(.+?)\s+-\s/)?.[1] ?? title;
}

/* ------------------------------ offer builder ------------------------------ */

function OfferBuilder({
  draft,
  them,
  theirHandle,
  mySlabs,
  theirSlabs,
  cash,
  me,
  onClose,
}: {
  draft: Draft;
  me: Address;
  them: Address;
  theirHandle: string;
  mySlabs: TradeSlab[];
  theirSlabs: TradeSlab[];
  cash: number;
  onClose: () => void;
}) {
  const { create, counter } = useTradeActions();
  const { pushToast } = useStore();
  const [give, setGive] = useState<string[]>(draft.mySlabs);
  const [get, setGet] = useState<string[]>(draft.theirSlabs);
  // Strings, so the fields can be cleared and retyped.
  const [giveCash, setGiveCash] = useState(draft.myCash ? String(draft.myCash) : "");
  const [getCash, setGetCash] = useState(draft.theirCash ? String(draft.theirCash) : "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const myCash = Number(giveCash || 0);
  const theirCash = Number(getCash || 0);
  const summary = useMemo(() => {
    const part = (n: number, c: number) => [n ? `${n} slab${n > 1 ? "s" : ""}` : "", c ? usd(c, { cents: true }) : ""].filter(Boolean).join(" + ") || "nothing";
    return `You give ${part(give.length, myCash)} · you get ${part(get.length, theirCash)}`;
  }, [give.length, get.length, myCash, theirCash]);

  const submit = async () => {
    const problem =
      !Number.isFinite(myCash) || !Number.isFinite(theirCash) || myCash < 0 || theirCash < 0
        ? "Cash amounts must be numbers of 0 or more."
        : !give.length && !myCash
          ? "Add at least one of your slabs, or some cash, to what you give."
          : !get.length && !theirCash
            ? `Pick at least one of @${theirHandle}'s slabs, or ask for cash.`
            : give.length > 10 || get.length > 10
              ? "At most 10 slabs on each side."
              : myCash > cash
                ? `You have ${usd(cash, { cents: true })} in your Pokechain account. Deposit more in Wallet first.`
                : "";
    setError(problem);
    if (problem) return;
    setBusy(true);
    try {
      const terms = { mySlabs: give, myCash, theirSlabs: get, theirCash };
      if (draft.counterOf) await counter(draft.counterOf, terms);
      else await create(them, theirHandle, terms, roomIdFor(me, them));
      pushToast({ title: draft.counterOf ? "Counter-offer sent" : "Offer sent", body: "Your side is locked in TradeEscrow until they answer.", tone: "success" });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-card border border-accent/40 bg-surface p-4">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="flex-1 text-[15px] font-bold">{draft.counterOf ? `Counter offer #${draft.counterOf}` : `New offer to @${theirHandle}`}</h2>
        <Button size="sm" variant="ghost" onClick={onClose}><X size={14} /> Cancel</Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Picker title="You give" slabs={mySlabs} selected={give} onToggle={(id) => toggle(give, setGive, id)} cash={giveCash} onCash={setGiveCash} hint={`You have ${usd(cash, { cents: true })} in your account`} empty="No vaulted slabs to offer. Slabs in another open offer are locked there." />
        <Picker title={`You get from @${theirHandle}`} slabs={theirSlabs} selected={get} onToggle={(id) => toggle(get, setGet, id)} cash={getCash} onCash={setGetCash} hint="Cash they add" empty={`@${theirHandle} has no vaulted slabs right now. You can still ask for cash.`} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <p className="flex-1 text-[13px] font-semibold text-white">{summary}</p>
        <Button onClick={submit} disabled={busy}>{busy ? "Signing…" : draft.counterOf ? "Send counter-offer" : "Send offer"}</Button>
      </div>
      {error ? <p className="mt-2 rounded-lg bg-bad/10 px-3 py-2 text-[12.5px] text-bad">{error}</p> : null}
      <div className="mt-3">
        <OnChainNote>
          {draft.counterOf ? (
            <>
              <Fn>TradeEscrow.counter(#{draft.counterOf}, …)</Fn> refunds their offer and, in the same transaction, makes yours:
              your slabs and cash move into escrow.
            </>
          ) : (
            <>
              <Fn>TradeEscrow.createOffer(@{theirHandle}, yourSlabs, yourCash, theirSlabs, theirCash)</Fn> moves your slabs into the
              escrow contract and your cash into its custody balance. Nothing of theirs moves until they accept; then{" "}
              <Fn>accept</Fn> swaps both sides in one transaction, or reverts if any piece can&apos;t move.
            </>
          )}
        </OnChainNote>
      </div>
    </section>
  );
}

function Picker({
  title,
  slabs,
  selected,
  onToggle,
  cash,
  onCash,
  hint,
  empty,
}: {
  title: string;
  slabs: TradeSlab[];
  selected: string[];
  onToggle: (id: string) => void;
  cash: string;
  onCash: (v: string) => void;
  hint: string;
  empty: string;
}) {
  return (
    <div className="rounded-xl bg-[#101014] p-3">
      <p className="mb-2 text-[11.5px] font-bold uppercase tracking-wide text-muted">{title}</p>
      <div className="flex max-h-[260px] flex-wrap gap-1 overflow-y-auto">
        {slabs.length ? slabs.map((s) => <SlabThumb key={s.tokenId} id={s.tokenId} slab={s} selected={selected.includes(s.tokenId)} onClick={() => onToggle(s.tokenId)} />) : <p className="text-[12px] text-dim">{empty}</p>}
      </div>
      <label className="mt-3 block text-[12px] font-semibold text-muted">
        Plus cash (USDC)
        <input className={clsx(inputClass, "mt-1 h-10")} inputMode="decimal" placeholder="0" value={cash} onChange={(e) => onCash(e.target.value.replace(/[^\d.]/g, ""))} aria-label={`${title}: cash`} />
      </label>
      <p className="mt-1 text-[11px] text-dim">{hint}</p>
    </div>
  );
}
