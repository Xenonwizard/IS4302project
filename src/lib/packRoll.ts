import { rollPack } from "./catalog";
import type { Listing, Pack } from "./types";

/**
 * Draws one slab from a pack: roll the published payout bands, then roll inside
 * the band. Randomness lives here rather than in a component so the pull is a
 * single impure call from an event handler.
 */
export function drawFromPack(pack: Pack): Listing {
  const roll = Math.random() * 100;
  let acc = 0;
  let tier = 0;
  for (let i = 0; i < pack.odds.length; i++) {
    acc += pack.odds[i].chance;
    if (roll <= acc) {
      tier = i;
      break;
    }
  }
  return rollPack(pack.slug, Math.random(), tier);
}
