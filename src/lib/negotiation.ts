import { LISTINGS, getListing } from "./catalog";
import { usd } from "./format";
import { HANDLES } from "./pools";
import { hashString } from "./rng";
import type { ChatMessage, Listing, Negotiation, TradeBid } from "./types";

/**
 * Negotiations work like Carousell: a buyer makes an offer on a listing, which
 * opens a one-to-one chat with the seller. The seller accepts or declines; the
 * buyer can edit or cancel the offer. The other party is simulated on the client.
 */

export function bidValue(bid: TradeBid): number {
  // Cash only: slabs are negotiated individually and have no assigned dollar value.
  return Math.round(bid.cash * 100) / 100;
}

/** "full cash" or what a trade is made of, e.g. "trade: Mew ex + $40.00 cash". */
export function offerMix(o: TradeBid): string {
  if (!o.slabIds.length) return "full cash";
  const names = o.slabIds.map((id) => getListing(id)?.shortName ?? "slab");
  const slabs = names.length === 1 ? names[0] : `${names.length} slabs`;
  return o.cash > 0 ? `trade: ${slabs} + ${usd(o.cash, { cents: true })} cash` : `trade: ${slabs}`;
}

let seq = 0;
export function messageId(): string {
  seq += 1;
  return `m${Date.now().toString(36)}${seq}`;
}

/** One chat per buyer per listing, so offering again reuses it. */
export function negotiationId(listingId: string, buyer: string): string {
  return `${listingId.slice(0, 16)}-${hashString(buyer).toString(36)}`;
}

/** The offer waiting on a response, if any. */
export function pendingOffer(n: Negotiation): ChatMessage | undefined {
  return [...n.messages].reverse().find((m) => m.kind === "offer" && m.status === "pending");
}

/** The most recent offer whatever its state, for inbox previews. */
export function latestOffer(n: Negotiation): ChatMessage | undefined {
  return [...n.messages].reverse().find((m) => m.kind === "offer");
}

export function lastActivity(n: Negotiation): string {
  return n.messages.at(-1)?.at ?? n.createdAt;
}

export function systemMessage(text: string, by?: string): ChatMessage {
  return { id: messageId(), from: "system", at: new Date().toISOString(), kind: "system", text, by };
}

const BUYER_OPENERS = [
  "Hi, is this still available?",
  "Hey! Keen on this slab.",
  "Hi there, would you take this?",
  "Interested. Centering looks clean from the scans.",
];

const BUYER_LINES = [
  "Thanks for getting back to me.",
  "Ok, let me think about it.",
  "Any flaws on the case I should know about?",
  "Can you share a close-up of the label?",
];

const SELLER_LINES = [
  "Yes, still available.",
  "Slab is in great shape, no scuffs on the case.",
  "Happy to answer anything about it.",
  "It's vaulted, so the token transfers the moment we agree.",
];

export type BotAction =
  /** chat: a plain answer to the user's message, which an LLM may write instead */
  | { type: "text"; text: string; chat?: boolean }
  | { type: "accept"; offerId: string; text: string }
  | { type: "decline"; offerId: string; text: string }
  | { type: "offer"; offer: TradeBid; text?: string };

/**
 * What the simulated other party does after the signed-in user's latest move.
 * Returns null when there is nothing to answer.
 */
export function botReply(
  n: Negotiation,
  listing: Listing,
  me: string,
  rand: () => number = Math.random,
): BotAction | null {
  if (n.status !== "open") return null;
  const last = n.messages.at(-1);
  if (!last) return null;
  const mine = last.from === me || last.by === me;
  if (!mine) return null;
  const ask = listing.price;

  if (n.buyer === me) {
    // The bot is the seller.
    const pending = pendingOffer(n);
    if (last.kind === "offer" && pending && pending.from === me && pending.offer) {
      const value = bidValue(pending.offer);
      if (value >= ask * 0.95) {
        return { type: "accept", offerId: pending.id, text: "Deal! Accepting your offer now." };
      }
      if (value >= ask * 0.75) {
        const counter = Math.max(value * 1.06, ask * 0.96);
        return {
          type: "text",
          text: `Bit low for me. Could you do ${usd(counter)}? Edit your offer and I'll accept.`,
        };
      }
      return {
        type: "decline",
        offerId: pending.id,
        text: `Sorry, that's too far from my asking price of ${usd(ask)}.`,
      };
    }
    if (last.kind === "text") return { type: "text", text: pick(SELLER_LINES, rand), chat: true };
    return null;
  }

  // The bot is the buyer and the user is selling.
  if (last.kind === "system" && last.by === me) {
    // The user declined: come back once with a better offer, or bow out.
    const declined = [...n.messages].reverse().find((m) => m.kind === "offer" && m.status === "declined");
    const tries = n.messages.filter((m) => m.kind === "offer" && m.from === n.buyer).length;
    if (declined?.offer && tries < 3 && rand() < 0.6) {
      const value = Math.min(ask, bidValue(declined.offer) * (1.06 + rand() * 0.06));
      return { type: "offer", offer: buyerBid(listing, value, me, rand), text: "How about this instead?" };
    }
    return { type: "text", text: "No worries, thanks anyway." };
  }
  if (last.kind === "text") return { type: "text", text: pick(BUYER_LINES, rand), chat: true };
  return null;
}

/** A simulated collector opening a chat on one of the user's listings. */
export function newBuyerChat(
  listing: Listing,
  me: string,
  taken: string[],
  rand: () => number = Math.random,
): Negotiation | null {
  const pool = HANDLES.filter((h) => h !== me && !taken.includes(h));
  if (!pool.length) return null;
  const buyer = pool[Math.floor(rand() * pool.length)];
  const now = Date.now();
  const value = listing.price * (0.72 + rand() * 0.26);
  const messages: ChatMessage[] = [
    { id: messageId(), from: buyer, at: new Date(now).toISOString(), kind: "text", text: pick(BUYER_OPENERS, rand) },
    {
      id: messageId(),
      from: buyer,
      at: new Date(now + 1000).toISOString(),
      kind: "offer",
      offer: buyerBid(listing, value, me, rand),
      status: "pending",
    },
  ];
  return {
    id: negotiationId(listing.id, buyer),
    listingId: listing.id,
    seller: me,
    buyer,
    status: "open",
    createdAt: new Date(now).toISOString(),
    messages,
  };
}

/** Sometimes a buyer offers one of their own cheaper slabs plus cash. */
function buyerBid(listing: Listing, value: number, me: string, rand: () => number): TradeBid {
  const round = (n: number) => (n >= 100 ? Math.round(n) : Math.round(n * 100) / 100);
  if (rand() < 0.3) {
    const pool = LISTINGS.filter(
      (l) => l.id !== listing.id && l.owner !== me && l.price < value * 0.6 && l.price > value * 0.15,
    );
    const slab = pool[Math.floor(rand() * pool.length)];
    if (slab) return { cash: round(Math.max(0, value * 0.5)), slabIds: [slab.id] };
  }
  return { cash: round(value), slabIds: [] };
}

function pick<T>(list: T[], rand: () => number): T {
  return list[Math.floor(rand() * list.length)];
}
