/**
 * Pokechain's private copy of each redemption's delivery address. The chain only holds
 * keccak256(address) (SlabVault.slabOf(tokenId).shippingHash); the plaintext is handed to Pokechain
 * when the owner withdraws, so the outtake step can pass it on to Collector Crypt. Stored in
 * .data/pokechain-redemption-addresses.json; cleared by reset.
 */
import "server-only";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FILE = join(process.cwd(), ".data", "pokechain-redemption-addresses.json");

function load(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(FILE, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

export function saveRedemptionAddress(tokenId: string, shipTo: string) {
  const all = load();
  all[tokenId] = shipTo;
  mkdirSync(join(process.cwd(), ".data"), { recursive: true });
  writeFileSync(FILE, JSON.stringify(all, null, 2));
}

export function getRedemptionAddress(tokenId: string): string | undefined {
  return load()[tokenId];
}
