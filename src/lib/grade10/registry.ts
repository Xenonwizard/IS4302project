/**
 * A stand-in for Grade10 (https://grade10.com/vault), the custodian Pokechain sends slabs to.
 *
 * The assumed real-world flow: the collector ships their slab to Grade10 through Pokechain.
 * When it arrives, Grade10 checks it in and records it on Solana as an NFT held by Grade10's
 * vault wallet. Pokechain only mints its own Polygon token once that Solana record exists.
 *
 * This module plays both of Grade10's parts:
 *   - its REST registry          (/api/grade10/...): cert lookup and the intake call
 *   - its Solana record          (/api/mock-solana): answers the Solana DAS `getAsset` JSON-RPC
 *                                method the way Helius / Triton / QuickNode do
 *
 * Intake records are kept in .data/grade10-intake.json so they survive a dev-server restart.
 * Addresses, asset ids and signatures are real-format base58, derived from the cert number.
 */
import "server-only";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { keccak256, toBytes } from "viem";
import { certPreview } from "../catalog";
import type { Grader } from "../types";

/* ---------------- base58, as Solana writes addresses and signatures ---------------- */

function digest(seed: string): Uint8Array {
  return toBytes(keccak256(toBytes(seed)));
}

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58(bytes: Uint8Array): string {
  const base = BigInt(58);
  let n = BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
  let out = "";
  while (n > BigInt(0)) {
    out = ALPHABET[Number(n % base)] + out;
    n /= base;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}

/** Grade10's vault wallet on Solana: every slab it holds is owned by this address. */
export const GRADE10_VAULT_WALLET = base58(digest("grade10:vault-wallet"));
/** The Solana collection (Metaplex certified collection) Grade10 mints its vault NFTs into. */
export const GRADE10_COLLECTION = base58(digest("grade10:collection"));
export const SOLANA_CLUSTER = "devnet";

export interface IntakeRecord {
  grader: Grader;
  certNumber: string;
  title: string;
  image: string;
  grade: number;
  /** Solana asset id (the NFT's mint address) */
  assetId: string;
  /** signature of the Solana transaction that minted the vault NFT */
  signature: string;
  slot: number;
  receivedAt: string;
  /** "in_vault" while Grade10 holds it; "released" once it has shipped back out */
  status: "in_vault" | "released";
}

const FILE = join(process.cwd(), ".data", "grade10-intake.json");

function load(): Record<string, IntakeRecord> {
  try {
    return JSON.parse(readFileSync(FILE, "utf8")) as Record<string, IntakeRecord>;
  } catch {
    return {};
  }
}

function save(records: Record<string, IntakeRecord>) {
  mkdirSync(join(process.cwd(), ".data"), { recursive: true });
  writeFileSync(FILE, JSON.stringify(records, null, 2));
}

const keyOf = (grader: string, cert: string) => `${grader.toUpperCase()}:${cert.trim()}`;

export function isGrader(g: string): g is Grader {
  return ["PSA", "CGC", "BGS", "SGC"].includes(g);
}

/** Grade10 checks a slab in: it is now in their vault and recorded on Solana. */
export function intake(grader: Grader, certNumber: string): { record: IntakeRecord; created: boolean } | { error: string } {
  const records = load();
  const key = keyOf(grader, certNumber);
  if (records[key]) return { record: records[key], created: false };
  const card = certPreview(grader, certNumber);
  if (!card) return { error: `${grader} has no record of cert ${certNumber}` };
  const record: IntakeRecord = {
    grader,
    certNumber: certNumber.trim(),
    title: card.title,
    image: card.image,
    grade: card.grade,
    assetId: base58(digest(`grade10:asset:${key}`)),
    signature: base58(new Uint8Array([...digest(`grade10:sig-a:${key}`), ...digest(`grade10:sig-b:${key}`)])),
    slot: 350_000_000 + Math.floor((Date.now() / 400) % 10_000_000),
    receivedAt: new Date().toISOString(),
    status: "in_vault",
  };
  records[key] = record;
  save(records);
  return { record, created: true };
}

/** Grade10 ships the slab back out (Pokechain redemption): the Solana NFT leaves the vault wallet. */
export function release(assetId: string): IntakeRecord | undefined {
  const records = load();
  const entry = Object.entries(records).find(([, r]) => r.assetId === assetId);
  if (!entry) return undefined;
  records[entry[0]] = { ...entry[1], status: "released" };
  save(records);
  return records[entry[0]];
}

export function lookup(grader: string, certNumber: string): IntakeRecord | undefined {
  return load()[keyOf(grader, certNumber)];
}

export function byAssetId(assetId: string): IntakeRecord | undefined {
  return Object.values(load()).find((r) => r.assetId === assetId);
}

export function allIntakes(): IntakeRecord[] {
  return Object.values(load()).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
}

/** The shape Solana's DAS API returns from `getAsset` (Metaplex Digital Asset Standard). */
export function dasAsset(r: IntakeRecord) {
  return {
    interface: "V1_NFT",
    id: r.assetId,
    content: {
      $schema: "https://schema.metaplex.com/nft1.0.json",
      json_uri: `https://grade10.com/vault/meta/${r.assetId}.json`,
      metadata: {
        name: r.title,
        symbol: "G10",
        attributes: [
          { trait_type: "Grader", value: r.grader },
          { trait_type: "Cert number", value: r.certNumber },
          { trait_type: "Grade", value: String(r.grade) },
          { trait_type: "Custodian", value: "Grade10 Vault" },
          { trait_type: "Received", value: r.receivedAt },
        ],
      },
      links: { image: r.image },
    },
    authorities: [{ address: GRADE10_VAULT_WALLET, scopes: ["full"] }],
    grouping: [{ group_key: "collection", group_value: GRADE10_COLLECTION }],
    royalty: { basis_points: 0, primary_sale_happened: true },
    ownership: {
      owner: r.status === "in_vault" ? GRADE10_VAULT_WALLET : base58(digest(`released:${r.assetId}`)),
      frozen: r.status === "in_vault",
      delegated: false,
      ownership_model: "single",
    },
    mutable: true,
    burnt: false,
    mint_extensions: null,
    _slot: r.slot,
    _mint_signature: r.signature,
  };
}
