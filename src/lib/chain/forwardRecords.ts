/**
 * Pokechain's private record of each forwarded parcel: the exact message it encrypted for
 * Collector Crypt and the salt behind the on-chain commitment. Kept off-chain (it is the secret
 * half of the commitment) and only revealed for a dispute, when SlabVault.verifyForwardCommitment
 * checks it. Stored in .data/pokechain-forward-records.json; cleared by reset.
 */
import "server-only";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Hex } from "viem";

export interface ForwardRecord {
  message: string;
  salt: Hex;
  commitment: Hex;
}

const FILE = join(process.cwd(), ".data", "pokechain-forward-records.json");

function load(): Record<string, ForwardRecord> {
  try {
    return JSON.parse(readFileSync(FILE, "utf8")) as Record<string, ForwardRecord>;
  } catch {
    return {};
  }
}

export function saveForwardRecord(submissionId: string, record: ForwardRecord) {
  const all = load();
  all[submissionId] = record;
  mkdirSync(join(process.cwd(), ".data"), { recursive: true });
  writeFileSync(FILE, JSON.stringify(all, null, 2));
}

export function getForwardRecord(submissionId: string): ForwardRecord | undefined {
  return load()[submissionId];
}
