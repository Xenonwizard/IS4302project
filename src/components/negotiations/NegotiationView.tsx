"use client";

import clsx from "clsx";
import Link from "next/link";
import { ArrowLeft, ArrowLeftRight, Check, Gavel, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { keccak256, toBytes, zeroAddress } from "viem";
import { usePublicClient } from "wagmi";
import { BRAND } from "@/lib/brand";
import { getListing } from "@/lib/catalog";
import { contracts } from "@/lib/chain/config";
import { useHandleAddress, useTradeEvents, useTradeOffers } from "@/lib/chain/trades";
import { useMarketChain } from "@/lib/chain/useMarketChain";
import { useOnchainAccount } from "@/lib/chain/useOnchainAccount";
import { useSlabChain } from "@/lib/chain/useSlabChain";
import { usd } from "@/lib/format";
import { offerMix, pendingOffer } from "@/lib/negotiation";
import { sellerFee, useStore } from "@/lib/store";
import type { ChatMessage, Listing, Negotiation, OfferStatus } from "@/lib/types";
import { OfferModal } from "../modals/OfferModal";
import { Slab } from "../slab/Slab";
import { Avatar, Badge, Button, TimeAgo, inputClass } from "../ui/primitives";
import { INBOX_URL_KEY } from "./NegotiationsInbox";
import { ReportLostModal, reportItemLabel } from "./ReportLostModal";
import { TradeBuilder, type CounterOf } from "./TradeBuilder";
import { SoldBanner } from "./SoldBanner";
import { TradeCard } from "./TradeCard";

const exact = (n: number) => usd(n, { cents: true });

const BUYER_QUICK = ["Is this still available?", "Any flaws on the slab?", "Is the price negotiable?"];
const SELLER_QUICK = ["Yes, it's available.", "Price is firm, sorry.", "Can you go a bit higher?"];

/**
 * A one-to-one chat between two collectors about one slab. Between two wallet accounts it also carries
 * multi-slab trade offers, settled on-chain by TradeEscrow.
 */
export function NegotiationView({ id, openTrade = false }: { id: string; openTrade?: boolean }) {
  return <ListingChat id={id} openTrade={openTrade} />;
}

function ListingChat({ id, openTrade }: { id: string; openTrade: boolean }) {
  const { ready, user, negotiations, requireAuth, slabs } = useStore();
  const n = negotiations[id];
  const base = n
    ? getListing(n.listingId) ||
      slabs.find(
        (s) =>
          s.id === n.listingId ||
          s.tokenId === n.listingId ||
          s.id === `token-${n.listingId}` ||
          (s.tokenId && `token-${s.tokenId}` === n.listingId),
      )
    : undefined;

  if (!ready) {
    return (
      <div className="px-4 py-5 lg:px-6">
        <div className="skeleton h-[70vh] rounded-card" />
      </div>
    );
  }
  if (!user || !n || !base) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-xl font-bold">{user ? "Chat not found" : "Log in to see this chat"}</h1>
        <p className="max-w-sm text-sm text-muted">
          {user
            ? "This negotiation does not exist or belongs to another account."
            : "Negotiations are private between the buyer and the seller."}
        </p>
        {user ? (
          <Link href="/trades">
            <Button size="lg">Back to negotiations</Button>
          </Link>
        ) : (
          <Button size="lg" onClick={() => requireAuth()}>
            Log in
          </Button>
        )}
      </div>
    );
  }
  return <Chat negotiation={n} base={base} me={user.username} openTrade={openTrade} />;
}

function Chat({ negotiation: n, base, me, openTrade }: { negotiation: Negotiation; base: Listing; me: string; openTrade: boolean }) {
  const { resolve, isListed, sendMessage, respondToOffer, withdrawOffer, lostReports, user, pushToast } = useStore();
  const { transfer } = useSlabChain();
  const { cancelListing } = useMarketChain();
  const client = usePublicClient();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const listing = resolve(base);
  const iAmBuyer = n.buyer === me;
  const other = iAmBuyer ? n.seller : n.buyer;
  const pending = pendingOffer(n);
  const [text, setText] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const reports = lostReports.filter((r) => r.negotiationId === n.id);

  // Between two wallet accounts the offers are on-chain trades; with anyone else they stay the simple kind.
  const wallet = useOnchainAccount();
  const { data: otherAddress } = useHandleAddress(other);
  const chainMode = Boolean(user?.address && wallet.address && otherAddress && otherAddress.toLowerCase() !== wallet.address.toLowerCase());
  useTradeEvents(chainMode);
  const { data: chainOffers = [] } = useTradeOffers(wallet.address, otherAddress ?? undefined);
  // "Make an offer" on the asset page lands here with the builder already open.
  const [builder, setBuilder] = useState<{ counter?: CounterOf } | null>(openTrade ? {} : null);
  const openTrades = chainOffers.filter((o) => o.status === "Open");


  const counterTrade = (trade: NonNullable<ChatMessage["trade"]>) =>
    setBuilder({
      counter: {
        offerId: trade.offerId,
        // I'm answering, so what they wanted from me is now what I give.
        mySide: trade.get,
        theirSide: trade.give,
      },
    });
  const [backHref] = useState(() => {
    try {
      return window.sessionStorage.getItem(INBOX_URL_KEY) ?? "/trades";
    } catch {
      return "/trades";
    }
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  const count = n.messages.length;
  const lastKind = n.messages.at(-1)?.kind;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const last = el.lastElementChild as HTMLElement | null;
    // A trade offer is taller than the chat, so show it from its top instead of its bottom edge.
    if (last && lastKind === "trade") {
      el.scrollTo({ top: el.scrollTop + last.getBoundingClientRect().top - el.getBoundingClientRect().top - 8, behavior: "smooth" });
    } else {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [count, lastKind]);

  const sendingRef = useRef(false);
  const send = (value: string) => {
    if (!value.trim() || sendingRef.current) return;
    sendingRef.current = true;
    sendMessage(n.id, value.trim());
    setText("");
    setTimeout(() => {
      sendingRef.current = false;
    }, 400);
  };

  // If the card was already transferred on-chain to the buyer, automatically finalize the deal in the negotiation room
  useEffect(() => {
    if (!client || !listing.tokenId || !user?.address || n.status !== "open" || !pending) return;
    let cancelled = false;
    async function checkAutoSettle() {
      try {
        const buyerHandle = n.buyer.trim().toLowerCase().replace(/^@/, "");
        const [ownerAddr, buyerAddr] = await Promise.all([
          client!.readContract({
            ...contracts.slabVault,
            functionName: "ownerOf",
            args: [BigInt(listing.tokenId!)],
          }).catch(() => zeroAddress),
          client!.readContract({
            ...contracts.accounts,
            functionName: "handleOwner",
            args: [keccak256(toBytes(buyerHandle))],
          }).catch(() => zeroAddress),
        ]);
        if (cancelled) return;
        if (buyerAddr && buyerAddr !== zeroAddress && ownerAddr.toLowerCase() === buyerAddr.toLowerCase()) {
          respondToOffer(n.id, pending!.id, true);
        }
      } catch {
        /* ignore */
      }
    }
    void checkAutoSettle();
    return () => {
      cancelled = true;
    };
  }, [client, listing.tokenId, user?.address, n.status, n.id, n.buyer, pending, respondToOffer]);

  const handleAccept = async () => {
    if (!pending || busy) return;
    setBusy(true);
    try {
      let txHash: string | undefined;
      // If token is on-chain and user has a connected wallet
      if (listing.tokenId && user?.address && client) {
        // Resolve buyer's handle to wallet address
        const buyerHandle = n.buyer.trim().toLowerCase().replace(/^@/, "");
        const [ownerAddr, buyerAddress] = await Promise.all([
          client.readContract({
            ...contracts.slabVault,
            functionName: "ownerOf",
            args: [BigInt(listing.tokenId)],
          }).catch(() => zeroAddress),
          client.readContract({
            ...contracts.accounts,
            functionName: "handleOwner",
            args: [keccak256(toBytes(buyerHandle))],
          }).catch(() => zeroAddress),
        ]);

        const alreadyTransferred =
          buyerAddress !== zeroAddress &&
          ownerAddr.toLowerCase() === buyerAddress.toLowerCase();

        if (!alreadyTransferred) {
          // 1. Check if listed on SlabMarket. If so, cancel listing so token is unlocked
          const isListed = await client
            .readContract({
              ...contracts.slabVault,
              functionName: "isListed",
              args: [BigInt(listing.tokenId)],
            })
            .catch(() => false);

          if (isListed) {
            await cancelListing(listing.tokenId);
          }

          if (buyerAddress && buyerAddress !== zeroAddress) {
            const receipt = await transfer(listing.tokenId, buyerAddress, buyerHandle);
            txHash = receipt.transactionHash;
          }
        }
      }

      respondToOffer(n.id, pending.id, true, txHash);
      void queryClient.invalidateQueries({ queryKey: ["owned-slabs"] });
    } catch (err) {
      pushToast({ title: "Could not accept offer", body: (err as Error).message, tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-4 py-5 lg:px-6">
      <div className={clsx("grid gap-5 transition-[grid-template-columns] duration-300", builder ? "lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]" : "xl:grid-cols-[minmax(0,1fr)_340px]")}>
        <section className="flex h-[calc(100dvh-230px)] min-h-[480px] flex-col lg:h-[calc(100vh-150px)] overflow-hidden rounded-card border border-hairline bg-surface">
          {/* who you are talking to */}
          <header className="flex items-center gap-3 border-b border-hairline px-4 py-3">
            <Link href={backHref} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-white/5 hover:text-white" aria-label="Back to negotiations">
              <ArrowLeft size={17} />
            </Link>
            <Avatar name={other} size={34} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold">{other}</p>
              <p className="text-[12px] text-muted">{iAmBuyer ? "Seller" : "Buyer"} · only you two see this chat</p>
            </div>
          </header>

          {/* the slab this chat is about, once it has gone to someone in a trade */}
          <div className="border-b border-hairline px-4 py-2 empty:hidden">
            <SoldBanner tokenId={listing.tokenId} from={n.seller} />
          </div>
          {/* the listing and the offer on the table */}
          <div className="flex flex-wrap items-center gap-3 border-b border-hairline bg-surface-2/50 px-4 py-3">
            <Link href={`/asset/${listing.id}`} className="w-10 shrink-0">
              <Slab listing={listing} flat />
            </Link>
            <div className="min-w-0 flex-1">
              <Link href={`/asset/${listing.id}`} className="line-clamp-1 text-[13px] font-semibold hover:underline">
                {listing.title}
              </Link>
              <p className="text-[12px] text-muted">
                {chainMode
                  ? (isListed(listing.id) ? `Asking ${exact(listing.price)}` : "Not listed")
                  : `Asking ${exact(listing.price)}`}
              </p>
            </div>
            {chainMode ? (
              n.status === "open" ? (
                <div className="flex items-center gap-2">
                  {openTrades.length ? <Badge tone="accent">{openTrades.length} open trade{openTrades.length === 1 ? "" : "s"}</Badge> : null}
                  {builder ? (
                    <Badge tone="good"><ArrowLeftRight size={12} />Trade room open</Badge>
                  ) : (
                    <Button size="sm" onClick={() => setBuilder({})}>
                      <ArrowLeftRight size={14} />
                      Make a trade offer
                    </Button>
                  )}
                </div>
              ) : (
                <Badge tone="neutral">Closed</Badge>
              )
            ) : (
              <OfferBar
                n={n}
                iAmBuyer={iAmBuyer}
                pending={pending}
                busy={busy}
                onEdit={() => setEditOpen(true)}
                onWithdraw={() => pending && withdrawOffer(n.id, pending.id)}
                onAccept={handleAccept}
                onDecline={() => pending && respondToOffer(n.id, pending.id, false)}
              />
            )}
          </div>

          <div ref={scrollRef} className="cy-scroll flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {n.messages.map((m) => (
              <MessageRow
                key={m.id}
                message={m}
                me={me}
                trade={
                  m.kind === "trade" && m.trade && wallet.address ? (
                    <TradeCard
                      message={m}
                      negotiationId={n.id}
                      me={{ address: wallet.address, handle: me }}
                      offer={chainOffers.find((o) => o.id === m.trade!.offerId)}
                      onCounter={counterTrade}
                    />
                  ) : null
                }
              />
            ))}
          </div>

          {n.status === "open" ? (
            <div className="border-t border-hairline p-3">
              <div className="no-scrollbar mb-2 flex gap-2 overflow-x-auto">
                {(iAmBuyer ? BUYER_QUICK : SELLER_QUICK).map((q) => (
                  <button
                    key={q}
                    onClick={() => send(q)}
                    className="shrink-0 rounded-full border border-hairline px-3 py-1.5 text-[12px] font-medium text-muted transition hover:bg-white/5 hover:text-white"
                  >
                    {q}
                  </button>
                ))}
              </div>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  send(text);
                }}
              >
                <input
                  className={inputClass}
                  placeholder={`Message ${other}…`}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
                <Button type="submit" aria-label="Send">
                  <Send size={16} />
                </Button>
              </form>
            </div>
          ) : (
            <p className="border-t border-hairline p-4 text-center text-[13px] text-muted">
              {n.status === "sold" ? "Deal done. This chat is now read-only." : "This chat is closed."}
            </p>
          )}
        </section>

        {chainMode && wallet.address && otherAddress && builder ? (
          <TradeBuilder
            open
            onClose={() => setBuilder(null)}
            negotiationId={n.id}
            me={{ address: wallet.address, handle: me }}
            them={{ address: otherAddress, handle: other }}
            cash={wallet.custodyBalance}
            counterOf={builder.counter}
          />
        ) : <aside className="space-y-4">
          <div className="rounded-card border border-hairline bg-[#0c0c10] p-6">
            <div className="mx-auto w-[62%] max-w-[220px]">
              <Slab listing={listing} interactive sizes="240px" />
            </div>
          </div>
          <div className="rounded-card border border-hairline bg-surface p-4 text-[12px] leading-relaxed text-muted">
            <p className="mb-2 text-[13px] font-bold text-white">How negotiating works</p>
            {chainMode ? (
              <ul className="list-disc space-y-1 pl-4">
                <li>Chat as long as you like, then make a trade offer: slabs from both vaults, plus cash either way.</li>
                <li>Compare listings and completed Pokechain transactions on each slab page, then agree on slabs and cash with the other collector.</li>
                <li>Your side is locked in TradeEscrow. They accept, counter or decline; accepting swaps everything in one transaction.</li>
                <li>Nothing ships: only the tokens change hands, the slabs stay vaulted.</li>
              </ul>
            ) : (
              <ul className="list-disc space-y-1 pl-4">
                <li>Offers are full cash, or slabs from your vault plus a cash top-up.</li>
                <li>The seller accepts or declines. The buyer can edit or cancel a pending offer.</li>
                <li>On accept the token moves on-chain and the vault updates custody. Nothing ships.</li>
                <li>The seller pays a {BRAND.sellerFee * 100}% fee on the cash part only.</li>
              </ul>
            )}
          </div>
          {reports.length ? (
            <div className="rounded-card border border-hairline bg-surface p-4">
              <p className="mb-3 text-[13px] font-bold">Lost item reports</p>
              <ul className="space-y-2">
                {reports.map((r) => (
                  <li key={r.id} className="rounded-xl bg-surface-2 p-3 text-[12px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-bold">{r.id}</span>
                      <Badge tone="warn">{r.status}</Badge>
                    </div>
                    <p className="mt-1.5 text-muted">
                      {reportItemLabel(r.item)} · filed <TimeAgo value={r.filedAt} />
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </aside>}
      </div>

      {!chainMode || !wallet.address || !otherAddress ? (
        <OfferModal listing={listing} open={editOpen} onClose={() => setEditOpen(false)} editing />
      ) : null}
      <ReportLostModal negotiation={n} open={reportOpen} onClose={() => setReportOpen(false)} />
    </div>
  );
}

/** The current offer and the buttons that act on it, Carousell-style. */
function OfferBar({
  n,
  iAmBuyer,
  pending,
  busy,
  onEdit,
  onWithdraw,
  onAccept,
  onDecline,
}: {
  n: Negotiation;
  iAmBuyer: boolean;
  pending?: ChatMessage;
  busy?: boolean;
  onEdit: () => void;
  onWithdraw: () => void;
  onAccept: () => void;
  onDecline: () => void;
}) {
  if (n.status === "sold") return <Badge tone="good">Deal done</Badge>;
  if (n.status === "closed") return <Badge tone="neutral">Closed</Badge>;

  if (iAmBuyer) {
    return pending ? (
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" onClick={onEdit}>
          Edit offer
        </Button>
        <Button size="sm" variant="outline" onClick={onWithdraw}>
          Cancel offer
        </Button>
      </div>
    ) : (
      <Button size="sm" onClick={onEdit}>
        <Gavel size={14} />
        Make offer
      </Button>
    );
  }

  if (!pending?.offer || pending.status !== "pending") return <span className="text-[12px] text-dim">Waiting for an offer</span>;
  const { cash, slabIds } = pending.offer;
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={onDecline} disabled={busy}>
          Decline
        </Button>
        <Button size="sm" onClick={onAccept} disabled={busy}>
          {busy ? "Accepting…" : "Accept offer"}
        </Button>
      </div>
      <p className="text-[11px] text-dim">
        You receive {exact(cash - sellerFee(cash))} cash
        {slabIds.length ? ` + ${slabIds.length} slab${slabIds.length === 1 ? "" : "s"}` : ""} after the{" "}
        {BRAND.sellerFee * 100}% fee
      </p>
    </div>
  );
}

const STATUS_LABEL: Record<OfferStatus, string> = {
  pending: "Pending",
  accepted: "Accepted",
  declined: "Declined",
  withdrawn: "Cancelled",
  replaced: "Replaced",
};

function MessageRow({ message: m, me, trade }: { message: ChatMessage; me: string; trade?: React.ReactNode }) {
  if (m.kind === "trade") {
    return <div className={clsx("flex", m.from === me && "justify-end")}>{trade}</div>;
  }
  if (m.kind === "system") {
    return (
      <p className="mx-auto max-w-md rounded-full bg-surface-2 px-3 py-1.5 text-center text-[11px] font-medium text-muted">
        {m.text}
      </p>
    );
  }
  const mine = m.from === me;
  return (
    <div className={clsx("flex gap-2.5", mine && "flex-row-reverse")}>
      {!mine ? <Avatar name={m.from} size={28} className="mt-5" /> : null}
      <div className={clsx("min-w-0 max-w-[80%]", mine && "text-right")}>
        <p className={clsx("mb-1 flex items-center gap-1.5 text-[11px] text-dim", mine && "justify-end")}>
          <span className="font-semibold text-muted">{mine ? "You" : m.from}</span>
          <TimeAgo value={m.at} />
        </p>
        {m.kind === "text" ? (
          <p
            className={clsx(
              "inline-block rounded-2xl px-3.5 py-2 text-left text-[13px] leading-relaxed",
              mine ? "rounded-tr-md bg-accent text-white" : "rounded-tl-md bg-surface-2",
            )}
          >
            {m.text}
          </p>
        ) : m.offer ? (
          <OfferCard message={m} mine={mine} />
        ) : null}
      </div>
    </div>
  );
}

function OfferCard({ message: m, mine }: { message: ChatMessage; mine: boolean }) {
  const offer = m.offer!;
  const status = m.status ?? "pending";
  const slabs = offer.slabIds.map((id) => getListing(id)).filter((l): l is Listing => Boolean(l));
  const faded = status === "replaced" || status === "withdrawn" || status === "declined";
  return (
    <div
      className={clsx(
        "inline-block min-w-[230px] rounded-2xl border p-3 text-left",
        status === "accepted" ? "border-good/50 bg-good-bg" : status === "pending" ? "border-accent/60 bg-accent/10" : "border-hairline bg-surface-2",
        mine ? "rounded-tr-md" : "rounded-tl-md",
        faded && "opacity-60",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted">
          <Gavel size={12} /> {mine ? "You offered" : "Offered"}
        </span>
        <Badge tone={status === "accepted" ? "good" : status === "pending" ? "accent" : "neutral"}>
          {status === "accepted" ? <Check size={11} /> : null}
          {STATUS_LABEL[status]}
        </Badge>
      </div>
      <p className={clsx("mt-1 text-[20px] font-bold leading-tight", faded && "line-through")}>
        {offer.slabIds.length ? `${offer.slabIds.length} slab${offer.slabIds.length === 1 ? "" : "s"} + ${exact(offer.cash)} cash` : exact(offer.cash)}
      </p>
      <p className="text-[12px] text-muted">{offerMix(offer)}</p>
      {slabs.length ? (
        <ul className="mt-2 space-y-1.5">
          {slabs.map((s) => (
            <li key={s.id} className="flex items-center gap-2">
              <span className="w-7 shrink-0">
                <Slab listing={s} flat />
              </span>
              <Link href={`/asset/${s.id}`} className="min-w-0 truncate text-[12px] font-semibold hover:underline">
                {s.shortName} · {s.grader} {s.grade}
              </Link>
            </li>
          ))}
          {offer.cash > 0 ? (
            <li className="flex justify-between text-[12px] text-muted">
              <span>Cash top-up</span>
              <span>{exact(offer.cash)}</span>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-dim" style={{ animationDelay: delay }} />
  );
}
