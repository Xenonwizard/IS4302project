import { buildOnChainListing, marketValueFor } from "../catalog";
import type { ChatTradeSlab, Grader, Listing } from "../types";
import type { ValueBasis } from "../valuation";
import { contracts } from "./config";
import type { TradeSlab } from "./trades";

/**
 * Market value of a tokenised slab, from the catalogue's graded pricing (see marketValueFor). Both collectors in
 * a chat compute the same number. If the card isn't in the catalogue, `fallback` (its asking price) stands in.
 */
const marketCache = new Map<string, number>();

export function marketValueOf(slab: { grader: string; certNumber: string; title?: string; image?: string; fallback?: number }): number {
  const key = `${slab.grader}:${slab.certNumber}:${slab.image ?? ""}`;
  let value = marketCache.get(key);
  if (value === undefined) {
    const found = marketValueFor({ ...slab, grader: slab.grader as Grader });
    if (found === null) return slab.fallback ?? 0;
    value = found;
    marketCache.set(key, value);
  }
  return value;
}

/**
 * A slab with its values worked out and the one that counts, ready for an offer. Its stated value is
 * the owner's asking price while it is listed for sale; an unlisted slab only has its market value.
 */
export function valuedSlab(slab: TradeSlab, basis: ValueBasis = "market"): ChatTradeSlab {
  const stated = slab.listed && slab.listedPrice !== undefined ? slab.listedPrice : null;
  return {
    tokenId: slab.tokenId,
    title: slab.title,
    image: slab.image,
    grader: slab.grader,
    certNumber: slab.certNumber,
    market: marketValueOf({ ...slab, fallback: slab.listedPrice }),
    stated,
    basis: stated === null ? "market" : basis,
  };
}

/**
 * The listing a chat about someone else's slab hangs on: the on-chain listing for the token (title,
 * image straight from SlabVault, id `token-<id>`), the same one their Vault and the marketplace use, so
 * both sides of the chat point at the same slab.
 */
export function anchorListing(slab: TradeSlab, ownerHandle: string, ownerAddress: string): Listing {
  return buildOnChainListing({
    tokenId: slab.tokenId,
    title: slab.title,
    image: slab.image,
    grader: slab.grader as Grader,
    certNumber: slab.certNumber,
    price: slab.listedPrice,
    owner: ownerHandle,
    ownerAddress,
    contract: contracts.slabVault.address,
  });
}
