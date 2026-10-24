import { makeSubmittedListing } from "../catalog";
import type { ChatTradeSlab, Grader, Listing } from "../types";
import type { ValueBasis } from "../valuation";
import { contracts } from "./config";
import type { TradeSlab } from "./trades";

/**
 * Market value of a tokenised slab: the marketplace's own estimate for that card and grade, the same one
 * the submit form shows before a slab is sent in. It comes from the cert, so both collectors in a
 * chat compute the same number. If the cert isn't in the registry, the stated value stands in.
 */
const marketCache = new Map<string, number>();

export function marketValueOf(slab: Pick<TradeSlab, "grader" | "certNumber" | "declaredValueCents">): number {
  const key = `${slab.grader}:${slab.certNumber}`;
  let value = marketCache.get(key);
  if (value === undefined) {
    const made = makeSubmittedListing({ grader: slab.grader as Grader, certNumber: slab.certNumber, owner: "-", nowMs: 0 });
    value = made?.fmv ?? slab.declaredValueCents / 100;
    marketCache.set(key, value);
  }
  return value;
}

/** A slab with both of its values worked out and the one that counts, ready for an offer. */
export function valuedSlab(slab: TradeSlab, basis: ValueBasis = "market"): ChatTradeSlab {
  return {
    tokenId: slab.tokenId,
    title: slab.title,
    image: slab.image,
    grader: slab.grader,
    certNumber: slab.certNumber,
    market: marketValueOf(slab),
    stated: slab.declaredValueCents / 100,
    basis,
  };
}

/**
 * The listing a chat about someone else's slab hangs on. Like every tokenised slab, its value is the
 * owner's declared value from the chain; the chat computes the market value next to it.
 */
export function anchorListing(slab: TradeSlab, ownerHandle: string, ownerAddress: string): Listing | null {
  const made = makeSubmittedListing({ grader: slab.grader as Grader, certNumber: slab.certNumber, owner: ownerHandle, nowMs: Date.now() });
  if (!made) return null;
  const stated = slab.declaredValueCents / 100;
  return {
    ...made,
    tokenId: slab.tokenId,
    contract: contracts.slabVault.address,
    ownerAddress,
    ...(stated > 0 ? { price: stated, fmv: stated } : {}),
  };
}
