/**
 * A stand-in for Collector Crypt (CC), the vault Pokechain stores slabs with. Nothing here talks to
 * the real CC; it plays the two parts of CC that Pokechain depends on:
 *
 *   - CC's vault API     (/api/collector-crypt/...): intake (a slab arrives and is vaulted),
 *                        card lookup, and redemptions (ship a vaulted slab to an address,
 *                        with carrier tracking updates)
 *   - CC's Solana NFTs   (/api/mock-solana): each vaulted slab is a Solana NFT, answered through
 *                        the DAS JSON-RPC methods real providers (Helius, Triton) serve:
 *                        getAsset, getSignaturesForAsset, getAssetsByOwner
 *
 * Pokechain's flow: the collector ships to Pokechain, Pokechain forwards to CC, and CC mints the
 * slab's NFT straight to Pokechain's Solana escrow wallet. That NFT never moves while the slab
 * trades on Pokechain. On redemption, the escrow (as holder) asks CC to ship to the buyer.
 *
 * Traceability: this mock does not burn on redemption. The NFT stays in the escrow, frozen and
 * marked Redeemed, with every step (mint, redemption, carrier scans) as a Solana transaction in
 * its history. If the real CC does burn, the burn is itself a transaction in that history, and
 * Pokechain's own token keeps CC's asset id, redemption id and tracking number regardless.
 *
 * Records live in .data/collector-crypt.json so they survive a dev-server restart. Addresses,
 * asset ids and signatures are real-format base58.
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

const signature = (seed: string) => base58(new Uint8Array([...digest(`${seed}:a`), ...digest(`${seed}:b`)]));
const currentSlot = () => 350_000_000 + Math.floor((Date.now() / 400) % 10_000_000);

/** Pokechain's Solana escrow wallet: holds the CC NFT of every slab listed on Pokechain. */
export const POKECHAIN_ESCROW = process.env.POKECHAIN_SOLANA_ESCROW ?? base58(digest("pokechain:solana-escrow"));
/** CC's Solana collection (Metaplex certified collection) for vaulted slabs. */
export const CC_COLLECTION = base58(digest("collector-crypt:collection"));
/** CC's own authority wallet (update authority on its NFTs). */
export const CC_AUTHORITY = base58(digest("collector-crypt:authority"));
export const SOLANA_CLUSTER = "devnet";

export type VaultStatus = "Vaulted" | "Redemption requested" | "Shipped" | "Delivered" | "Lost";
export type CarrierStatus = "label_created" | "in_transit" | "delivered" | "lost";

export interface SolanaTx {
  signature: string;
  slot: number;
  at: string;
  /** DAS-style transaction type */
  type: "MINT" | "FREEZE" | "REDEEM_REQUEST" | "UPDATE_METADATA";
  description: string;
}

export interface Redemption {
  id: string;
  assetId: string;
  /** the address CC ships to; only CC and Pokechain's server ever see it */
  shipTo: string;
  requestedBy: string;
  carrier: string;
  trackingNumber: string;
  status: CarrierStatus;
  createdAt: string;
  events: { at: string; status: CarrierStatus; note: string }[];
}

export interface CcCard {
  assetId: string;
  grader: Grader;
  certNumber: string;
  title: string;
  image: string;
  grade: number;
  /** Solana wallet that holds the NFT */
  owner: string;
  /** reference printed on the inbound parcel, e.g. Pokechain submission #3 */
  depositorRef?: string;
  vaultStatus: VaultStatus;
  frozen: boolean;
  vaultedAt: string;
  redemptionId?: string;
  history: SolanaTx[];
}

interface Db {
  cards: Record<string, CcCard>;
  redemptions: Record<string, Redemption>;
}

const FILE = join(process.cwd(), ".data", "collector-crypt.json");

function load(): Db {
  try {
    return { cards: {}, redemptions: {}, ...(JSON.parse(readFileSync(FILE, "utf8")) as Partial<Db>) };
  } catch {
    return { cards: {}, redemptions: {} };
  }
}

function save(db: Db) {
  mkdirSync(join(process.cwd(), ".data"), { recursive: true });
  writeFileSync(FILE, JSON.stringify(db, null, 2));
}

const keyOf = (grader: string, cert: string) => `${grader.toUpperCase()}:${cert.trim()}`;

export function isGrader(g: string): g is Grader {
  return ["PSA", "CGC", "BGS", "SGC"].includes(g);
}

function solanaTx(seed: string, type: SolanaTx["type"], description: string): SolanaTx {
  return { signature: signature(`${seed}:${Date.now()}`), slot: currentSlot(), at: new Date().toISOString(), type, description };
}

/* ---------------- vault API ---------------- */

/** A slab arrives at CC: vaulted, and its NFT is minted to `owner` (Pokechain's escrow by default). */
export function intake(input: { grader: Grader; certNumber: string; owner?: string; depositorRef?: string }) {
  const db = load();
  const key = keyOf(input.grader, input.certNumber);
  if (db.cards[key]) return { card: db.cards[key], created: false };
  const preview = certPreview(input.grader, input.certNumber);
  if (!preview) return { error: `${input.grader} has no record of cert ${input.certNumber}` };
  const assetId = base58(digest(`collector-crypt:asset:${key}`));
  const owner = input.owner ?? POKECHAIN_ESCROW;
  const card: CcCard = {
    assetId,
    grader: input.grader,
    certNumber: input.certNumber.trim(),
    title: preview.title,
    image: preview.image,
    grade: preview.grade,
    owner,
    depositorRef: input.depositorRef,
    vaultStatus: "Vaulted",
    frozen: false,
    vaultedAt: new Date().toISOString(),
    history: [
      solanaTx(`${assetId}:mint`, "MINT", `Minted ${preview.title} to ${owner} on vault intake`),
    ],
  };
  db.cards[key] = card;
  save(db);
  return { card, created: true };
}

export function lookup(grader: string, certNumber: string): CcCard | undefined {
  return load().cards[keyOf(grader, certNumber)];
}

export function byAssetId(assetId: string): CcCard | undefined {
  return Object.values(load().cards).find((c) => c.assetId === assetId);
}

export function allCards(): CcCard[] {
  return Object.values(load().cards).sort((a, b) => b.vaultedAt.localeCompare(a.vaultedAt));
}

const CARRIERS = ["DHL Express", "FedEx", "UPS"];

/**
 * The NFT's holder asks CC to ship the slab. The NFT is not burned: it is frozen and marked
 * "Redemption requested" so it can never be redeemed twice, and the request is a Solana tx.
 */
export function requestRedemption(input: { assetId: string; shipTo: string; requestedBy: string }) {
  const db = load();
  const entry = Object.entries(db.cards).find(([, c]) => c.assetId === input.assetId);
  if (!entry) return { error: `No vaulted slab for asset ${input.assetId}`, status: 404 };
  const [key, card] = entry;
  if (card.owner !== input.requestedBy) return { error: "Only the NFT's holder can redeem it", status: 403 };
  if (card.vaultStatus !== "Vaulted") return { error: `Slab is ${card.vaultStatus}, not vaulted`, status: 409 };

  const n = Object.keys(db.redemptions).length + 1;
  const id = `CCR-${String(n).padStart(5, "0")}`;
  const carrier = CARRIERS[n % CARRIERS.length];
  const trackingNumber = `${carrier.slice(0, 2).toUpperCase()}${Date.now().toString().slice(-10)}`;
  const now = new Date().toISOString();
  const redemption: Redemption = {
    id,
    assetId: card.assetId,
    shipTo: input.shipTo,
    requestedBy: input.requestedBy,
    carrier,
    trackingNumber,
    status: "label_created",
    createdAt: now,
    events: [{ at: now, status: "label_created", note: `CC packed the slab; ${carrier} label ${trackingNumber}` }],
  };
  db.redemptions[id] = redemption;
  db.cards[key] = {
    ...card,
    vaultStatus: "Shipped",
    frozen: true,
    redemptionId: id,
    history: [
      ...card.history,
      solanaTx(`${card.assetId}:redeem`, "REDEEM_REQUEST", `Redemption ${id} requested by ${input.requestedBy}; NFT frozen`),
    ],
  };
  save(db);
  return { redemption };
}

export function getRedemption(id: string): Redemption | undefined {
  return load().redemptions[id];
}

/** A carrier scan (or a lost-parcel claim), as Postman sends it. Mirrored onto the NFT's metadata. */
export function addCarrierEvent(id: string, status: CarrierStatus, note?: string) {
  const db = load();
  const r = db.redemptions[id];
  if (!r) return undefined;
  const at = new Date().toISOString();
  db.redemptions[id] = { ...r, status, events: [...r.events, { at, status, note: note ?? defaultNote(status, r) }] };
  const key = Object.keys(db.cards).find((k) => db.cards[k].assetId === r.assetId);
  if (key && (status === "delivered" || status === "lost")) {
    const card = db.cards[key];
    const vaultStatus: VaultStatus = status === "delivered" ? "Delivered" : "Lost";
    db.cards[key] = {
      ...card,
      vaultStatus,
      history: [
        ...card.history,
        solanaTx(`${card.assetId}:${status}`, "UPDATE_METADATA", `Vault status → ${vaultStatus} (${r.carrier} ${r.trackingNumber})`),
      ],
    };
  }
  save(db);
  return db.redemptions[id];
}

function defaultNote(status: CarrierStatus, r: Redemption) {
  if (status === "in_transit") return `${r.carrier} scan: in transit`;
  if (status === "delivered") return `${r.carrier}: delivered`;
  if (status === "lost") return `${r.carrier}: parcel reported lost`;
  return "Label created";
}

/* ---------------- Solana DAS views ---------------- */

/** The shape Solana's DAS API returns from `getAsset` (Metaplex Digital Asset Standard). */
export function dasAsset(c: CcCard) {
  return {
    interface: "ProgrammableNFT",
    id: c.assetId,
    content: {
      $schema: "https://schema.metaplex.com/nft1.0.json",
      json_uri: `https://collectorcrypt.com/meta/${c.assetId}.json`,
      metadata: {
        name: c.title,
        symbol: "CARDS",
        attributes: [
          { trait_type: "Grader", value: c.grader },
          { trait_type: "Cert number", value: c.certNumber },
          { trait_type: "Grade", value: String(c.grade) },
          { trait_type: "Vault", value: "Collector Crypt" },
          { trait_type: "Vault status", value: c.vaultStatus },
          ...(c.redemptionId ? [{ trait_type: "Redemption", value: c.redemptionId }] : []),
        ],
      },
      links: { image: c.image },
    },
    authorities: [{ address: CC_AUTHORITY, scopes: ["full"] }],
    grouping: [{ group_key: "collection", group_value: CC_COLLECTION }],
    royalty: { basis_points: 0, primary_sale_happened: true },
    ownership: { owner: c.owner, frozen: c.frozen, delegated: false, ownership_model: "single" },
    mutable: true,
    burnt: false,
  };
}

/** `getSignaturesForAsset`: every Solana transaction that touched the NFT, newest first. */
export function dasSignatures(c: CcCard) {
  const items = [...c.history].reverse();
  return { total: items.length, limit: 1000, page: 1, items: items.map((t) => [t.signature, t.type]), _details: items };
}
