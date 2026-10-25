import { buildOnChainListing } from "../catalog";
import type { ChatTradeSlab, Grader, Listing } from "../types";
import { contracts } from "./config";
import type { TradeSlab } from "./trades";

/** Snapshot the seller's ask for reference; no value is assigned to an unlisted slab. */
export function valuedSlab(slab: TradeSlab): ChatTradeSlab {
  return {
    tokenId: slab.tokenId, title: slab.title, image: slab.image,
    grader: slab.grader, certNumber: slab.certNumber,
    stated: slab.listed && slab.listedPrice !== undefined ? slab.listedPrice : null,
  };
}

export function anchorListing(slab: TradeSlab, ownerHandle: string, ownerAddress: string): Listing {
  return buildOnChainListing({
    tokenId: slab.tokenId, title: slab.title, image: slab.image,
    grader: slab.grader as Grader, certNumber: slab.certNumber,
    price: slab.listedPrice, owner: ownerHandle, ownerAddress,
    contract: contracts.slabVault.address,
  });
}
