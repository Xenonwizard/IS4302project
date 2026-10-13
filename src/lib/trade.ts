import { LISTINGS, getListing } from "./catalog";
import { HANDLES } from "./pools";
import { hashString, makeRandom } from "./rng";
import type { Listing, TradeBid, TradeMessage, TradeRoom } from "./types";

/**
 * Live trade rooms: one chat per slab where collectors bid in messages and the
 * owner accepts a bid to settle. Other participants are simulated on the client,
 * so the logic below decides what the "crowd" says next.
 */

const ROOM_HOURS = 48;

const CHATTER = [
  "Centering looks close to 55/45 from the scans, anyone confirm?",
  "Any print lines under the holo?",
  "Comps on this have been climbing all month.",
  "Watching. Not chasing past market.",
  "Would you take a slab plus cash?",
  "That label is crisp. Clean copy.",
  "Out at this level, good luck all.",
  "Back side scan looks great too.",
  "Pop count is tiny at this grade.",
  "Is the vault report attached to the token?",
];

const SELLER_LINES = [
  "Appreciate the bids. Holding out for something closer to ask.",
  "Slab is fresh from the grader, no scuffs on the case.",
  "Happy to look at slab + cash combos.",
  "Will accept the best bid before the room closes.",
];

export function bidValue(bid: TradeBid): number {
  return (
    Math.round(
      (bid.cash + bid.slabIds.reduce((sum, id) => sum + (getListing(id)?.fmv ?? 0), 0)) * 100,
    ) / 100
  );
}

export function topBid(room: TradeRoom): TradeMessage | undefined {
  let best: TradeMessage | undefined;
  for (const m of room.messages) {
    if (m.kind !== "bid" || !m.bid) continue;
    if (!best || bidValue(m.bid) > bidValue(best.bid!)) best = m;
  }
  return best;
}

export function bidders(room: TradeRoom): string[] {
  return [...new Set(room.messages.filter((m) => m.kind === "bid").map((m) => m.from))];
}

let seq = 0;
export function messageId(): string {
  seq += 1;
  return `m${Date.now().toString(36)}${seq}`;
}

/**
 * A room someone else opened starts mid-conversation, with the listing's open
 * offers already posted as bids. A room the signed-in user opens starts empty, so
 * nothing is ever said in their name.
 */
export function seedRoom(
  listing: Listing,
  seller: string,
  nowMs: number,
  openedByMe = false,
): TradeRoom {
  const rnd = makeRandom(hashString(`room${listing.id}`));
  const openedAt = openedByMe ? nowMs : nowMs - rnd.int(20, 180) * 60_000;
  if (openedByMe) {
    return {
      id: listing.id,
      listingId: listing.id,
      seller,
      status: "live",
      openedAt: new Date(openedAt).toISOString(),
      closesAt: new Date(openedAt + ROOM_HOURS * 3_600_000).toISOString(),
      messages: [
        {
          id: messageId(),
          from: "system",
          at: new Date(openedAt).toISOString(),
          kind: "system",
          text: `You opened a live trade room. Asking ${listing.price.toLocaleString("en-US", { style: "currency", currency: "USD" })}. Collectors will start bidding shortly.`,
        },
      ],
    };
  }
  const messages: TradeMessage[] = [
    {
      id: `${listing.id}-open`,
      from: "system",
      at: new Date(openedAt).toISOString(),
      kind: "system",
      text: `${seller} opened a live trade room. Asking ${listing.price.toLocaleString("en-US", { style: "currency", currency: "USD" })}.`,
    },
    {
      id: `${listing.id}-hello`,
      from: seller,
      at: new Date(openedAt + 40_000).toISOString(),
      kind: "text",
      text: rnd.pick(SELLER_LINES),
    },
  ];
  const offers = [...listing.offers].sort((a, b) => a.amount - b.amount);
  let t = openedAt + 60_000;
  offers.forEach((o, i) => {
    t += rnd.int(2, 18) * 60_000;
    if (rnd.chance(0.5)) {
      messages.push({
        id: `${listing.id}-c${i}`,
        from: o.from,
        at: new Date(t - 30_000).toISOString(),
        kind: "text",
        text: rnd.pick(CHATTER),
      });
    }
    messages.push({
      id: `${listing.id}-b${i}`,
      from: o.from,
      at: new Date(t).toISOString(),
      kind: "bid",
      bid: { cash: o.amount, slabIds: [] },
    });
  });
  return {
    id: listing.id,
    listingId: listing.id,
    seller,
    status: "live",
    openedAt: new Date(openedAt).toISOString(),
    closesAt: new Date(openedAt + ROOM_HOURS * 3_600_000).toISOString(),
    messages,
  };
}

export type BotEvent =
  | { type: "message"; message: TradeMessage }
  | { type: "accept"; bidId: string; from: string; text: string };

/**
 * One step of the simulated crowd. `me` is the signed-in user, `iAmSeller` says
 * whose slab it is. Returns null when the crowd has nothing to say this tick.
 */
export function nextBotEvent(
  room: TradeRoom,
  listing: Listing,
  me: string,
  iAmSeller: boolean,
  rand: () => number = Math.random,
): BotEvent | null {
  if (room.status !== "live") return null;
  const now = new Date().toISOString();
  const top = topBid(room);
  const topValue = top?.bid ? bidValue(top.bid) : 0;
  const ask = listing.price;

  // The simulated owner reacts to the user's bids.
  if (!iAmSeller && top && top.from === me) {
    const lastMine = [...room.messages].reverse().find((m) => m.kind === "bid" && m.from === me);
    const answered = room.messages.some(
      (m) => m.from === room.seller && lastMine && Date.parse(m.at) > Date.parse(lastMine.at),
    );
    if (topValue >= ask * 0.96 && rand() < 0.6) {
      return {
        type: "accept",
        bidId: top.id,
        from: room.seller,
        text: "Deal. Accepting your bid, sending the token now.",
      };
    }
    if (!answered && rand() < 0.7) {
      const counter = Math.round(Math.max(topValue * 1.06, ask * 0.98));
      return {
        type: "message",
        message: {
          id: messageId(),
          from: room.seller,
          at: now,
          kind: "text",
          text:
            topValue >= ask * 0.85
              ? `Close. Meet me at $${counter.toLocaleString()} and it's yours.`
              : `Too light for me. I'd need around $${counter.toLocaleString()}.`,
        },
      };
    }
  }

  const crowd = [
    ...new Set([
      ...listing.offers.map((o) => o.from),
      ...pickHandles(listing.id, 6),
    ]),
  ].filter((h) => h !== me && h !== room.seller);
  const who = crowd[Math.floor(rand() * crowd.length)] ?? "collector";

  // The crowd stops pushing once bids are past the ask.
  const ceiling = (iAmSeller ? listing.fmv : ask) * 1.04;
  if (topValue < ceiling && rand() < 0.6) {
    const floor = (iAmSeller ? listing.fmv : ask) * 0.7;
    const target = Math.max(floor, topValue * (1.02 + rand() * 0.06));
    const amount = Math.min(ceiling, target);
    const bid = withSlab(listing, amount, me, rand);
    return {
      type: "message",
      message: { id: messageId(), from: who, at: now, kind: "bid", bid },
    };
  }

  return {
    type: "message",
    message: {
      id: messageId(),
      from: who,
      at: now,
      kind: "text",
      text: CHATTER[Math.floor(rand() * CHATTER.length)],
    },
  };
}

function pickHandles(seed: string, n: number): string[] {
  const rnd = makeRandom(hashString(`crowd${seed}`));
  return rnd.shuffle(HANDLES).slice(0, n);
}

/** Sometimes a bidder sweetens the deal with a cheaper slab of their own. */
function withSlab(listing: Listing, value: number, me: string, rand: () => number): TradeBid {
  const round = (n: number) => (n >= 100 ? Math.round(n) : Math.round(n * 100) / 100);
  if (rand() < 0.25) {
    const pool = LISTINGS.filter(
      (l) => l.id !== listing.id && l.owner !== me && l.fmv < value * 0.45 && l.fmv > value * 0.1,
    );
    const slab = pool[Math.floor(rand() * pool.length)];
    if (slab) return { cash: round(value - slab.fmv), slabIds: [slab.id] };
  }
  return { cash: round(value), slabIds: [] };
}

/** Rooms featured as "live now": the slabs drawing the most bids. */
export const LIVE_ROOMS: Listing[] = [...LISTINGS]
  .filter((l) => l.offers.length >= 2)
  .sort((a, b) => b.offers.length - a.offers.length || b.fmv - a.fmv)
  .slice(0, 18);
