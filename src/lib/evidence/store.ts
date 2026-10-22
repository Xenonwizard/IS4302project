/**
 * Intake evidence: the photos and declarations a collector submits with a slab.
 *
 * The photos are too big (and too personal) to put on a blockchain, so they are stored off-chain
 * and only a fingerprint goes on-chain:
 *
 *   each photo      →  keccak256(file bytes)                 listed in the manifest
 *   the manifest    →  keccak256(manifest JSON)  = evidenceHash, passed to SlabVault.requestSubmission
 *
 * Changing one pixel of one photo, the declared value or a condition note changes the evidenceHash,
 * so anyone can later prove exactly what was declared at intake by re-hashing the stored files and
 * comparing with the chain. That is what a lost-in-transit or damage claim needs.
 *
 * Stored under .data/evidence/<evidenceHash>/ (manifest.json + one file per photo). In production
 * this would be IPFS (the CID is a content hash too) or an S3 bucket with object lock.
 */
import "server-only";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { keccak256, toBytes, toHex } from "viem";

export const PHOTO_SLOTS = ["front", "back", "label", "extra"] as const;
export type PhotoSlot = (typeof PHOTO_SLOTS)[number];
/** front, back and a close-up of the grading label are required for a new submission */
export const REQUIRED_SLOTS: PhotoSlot[] = ["front", "back", "label"];
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

export interface PhotoEntry {
  slot: PhotoSlot;
  fileName: string;
  type: string;
  bytes: number;
  keccak256: `0x${string}`;
}

export interface EvidenceInput {
  grader: string;
  certNumber: string;
  declaredValueCents: number;
  condition: { caseCracked: boolean; caseScratched: boolean; labelDamaged: boolean; notes: string };
  shipping: { method: "courier" | "dropoff"; carrier: string; tracking: string };
  declarations: { owner: boolean; authentic: boolean; terms: boolean };
  submittedBy: string;
  /** "new" for a slab being sent in; "already-vaulted" when tokenising a slab Pokechain already holds */
  source: "new" | "already-vaulted";
}

export interface Manifest extends EvidenceInput {
  version: 1;
  photos: PhotoEntry[];
  createdAt: string;
}

const ROOT = join(process.cwd(), ".data", "evidence");
const dirOf = (hash: string) => join(ROOT, hash.toLowerCase());

export function hashBytes(bytes: Uint8Array): `0x${string}` {
  return keccak256(bytes);
}

/** Validates, stores, and returns the evidenceHash that goes on-chain. */
export function storeEvidence(input: EvidenceInput, files: { slot: PhotoSlot; name: string; type: string; data: Uint8Array }[]) {
  const required = input.source === "new" ? REQUIRED_SLOTS : [];
  const missing = required.filter((slot) => !files.some((f) => f.slot === slot));
  if (missing.length) return { error: `Missing photos: ${missing.join(", ")}` };
  const bad = files.find((f) => !f.type.startsWith("image/") || f.data.length > MAX_PHOTO_BYTES || f.data.length === 0);
  if (bad) return { error: `${bad.name} must be an image under 8 MB` };
  if (!input.declarations.owner || !input.declarations.authentic || !input.declarations.terms) {
    return { error: "All three declarations must be ticked" };
  }
  if (!(input.declaredValueCents > 0)) return { error: "Declare a value above $0" };

  const manifest: Manifest = {
    version: 1,
    ...input,
    photos: files.map((f) => ({ slot: f.slot, fileName: f.name, type: f.type, bytes: f.data.length, keccak256: hashBytes(f.data) })),
    createdAt: new Date().toISOString(),
  };
  const json = JSON.stringify(manifest, null, 2);
  const evidenceHash = keccak256(toBytes(json));

  const dir = dirOf(evidenceHash);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "manifest.json"), json);
  for (const f of files) writeFileSync(join(dir, f.slot), f.data);
  return { evidenceHash, manifest };
}

/**
 * Loads the evidence and re-checks it: the manifest's own hash must equal `hash` (the value on
 * chain), and every photo must still hash to what the manifest lists.
 */
export function loadEvidence(hash: string) {
  const dir = dirOf(hash);
  let json: string;
  try {
    json = readFileSync(join(dir, "manifest.json"), "utf8");
  } catch {
    return null;
  }
  const manifest = JSON.parse(json) as Manifest;
  const manifestOk = keccak256(toBytes(json)).toLowerCase() === hash.toLowerCase();
  const stored = new Set(readdirSync(dir));
  const photos = manifest.photos.map((p) => {
    const ok = stored.has(p.slot) && hashBytes(new Uint8Array(readFileSync(join(dir, p.slot)))) === p.keccak256;
    return { slot: p.slot, ok };
  });
  return { manifest, verified: { manifest: manifestOk, photos, all: manifestOk && photos.every((p) => p.ok) } };
}

export function readPhoto(hash: string, slot: string): { data: Buffer; type: string } | null {
  const ev = loadEvidence(hash);
  const entry = ev?.manifest.photos.find((p) => p.slot === slot);
  if (!entry) return null;
  return { data: readFileSync(join(dirOf(hash), entry.slot)), type: entry.type };
}

export const zeroHash = toHex(new Uint8Array(32));
