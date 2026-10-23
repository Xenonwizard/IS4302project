/**
 * How Pokechain's operator talks to Collector Crypt (CC) and to Solana. Every call is real HTTP:
 *
 *   CC vault API   {CC_API_URL}          GET  /cards/{grader}/{cert}      has CC vaulted it?
 *                                        POST /redemptions                ship it to an address
 *                                        GET  /redemptions/{id}           carrier tracking
 *   Solana (DAS)   {SOLANA_RPC_URL}      getAsset, getSignaturesForAsset  the NFT itself
 *
 * Both default to this app's mocks; point the env vars at real services and nothing else changes.
 */
import "server-only";
import { CC_COLLECTION, POKECHAIN_ESCROW, type Redemption } from "./store";

export interface CheckStep {
  /** e.g. "Collector Crypt GET /cards/PSA/12345678" */
  call: string;
  ok: boolean;
  detail: string;
}

const ccUrl = (origin: string) => process.env.CC_API_URL ?? `${origin}/api/collector-crypt`;
const solanaUrl = (origin: string) => process.env.SOLANA_RPC_URL ?? `${origin}/api/mock-solana`;

interface DasAsset {
  id: string;
  ownership: { owner: string; frozen: boolean };
  burnt: boolean;
  grouping: { group_key: string; group_value: string }[];
  content: { metadata: { name: string; attributes: { trait_type: string; value: string }[] } };
}

export async function solanaRpc<T>(origin: string, method: string, params: unknown): Promise<{ result?: T; error?: { message: string } }> {
  const res = await fetch(solanaUrl(origin), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "pokechain", method, params }),
    cache: "no-store",
  });
  return res.json();
}

export const attr = (a: DasAsset, name: string) => a.content.metadata.attributes.find((x) => x.trait_type === name)?.value;

export type CustodyResult =
  | { status: "verified"; assetId: string; checks: CheckStep[] }
  | { status: "awaiting_custodian" | "mismatch"; checks: CheckStep[] };

/**
 * Before minting: has CC vaulted the slab, and does its Solana NFT sit in Pokechain's escrow?
 *   1. CC GET /cards/{grader}/{cert}     → asset id (404 = not vaulted yet)
 *   2. Solana getAsset(asset id)         → owner == Pokechain escrow, CC collection, same cert,
 *                                          vault status Vaulted, not burnt
 */
export async function verifyCustody(origin: string, grader: string, cert: string): Promise<CustodyResult> {
  const checks: CheckStep[] = [];
  const call = `Collector Crypt GET /cards/${grader}/${cert}`;
  const res = await fetch(`${ccUrl(origin)}/cards/${encodeURIComponent(grader)}/${encodeURIComponent(cert)}`, { cache: "no-store" });
  const card = (await res.json()) as { found: boolean; solana?: { assetId: string } };
  if (!card.found || !card.solana) {
    checks.push({ call, ok: false, detail: "Not vaulted at Collector Crypt yet" });
    return { status: "awaiting_custodian", checks };
  }
  const assetId = card.solana.assetId;
  checks.push({ call, ok: true, detail: `Vaulted, Solana NFT ${assetId}` });

  const solCall = `Solana getAsset(${assetId.slice(0, 6)}…)`;
  const { result: a, error } = await solanaRpc<DasAsset>(origin, "getAsset", { id: assetId });
  if (!a) {
    checks.push({ call: solCall, ok: false, detail: error?.message ?? "No asset" });
    return { status: "mismatch", checks };
  }
  const problems = [
    a.ownership.owner !== POKECHAIN_ESCROW && `held by ${a.ownership.owner}, not Pokechain's escrow`,
    a.burnt && "burnt",
    !a.grouping.some((g) => g.group_key === "collection" && g.group_value === CC_COLLECTION) && "not in Collector Crypt's collection",
    attr(a, "Cert number") !== cert && `cert on Solana is ${attr(a, "Cert number")}`,
    attr(a, "Vault status") !== "Vaulted" && `vault status is ${attr(a, "Vault status")}`,
  ].filter(Boolean);
  if (problems.length) {
    checks.push({ call: solCall, ok: false, detail: problems.join(", ") });
    return { status: "mismatch", checks };
  }
  checks.push({ call: solCall, ok: true, detail: "In Pokechain's escrow, Collector Crypt collection, cert matches, Vaulted" });
  return { status: "verified", assetId, checks };
}

/** As the NFT's holder, ask CC to ship the slab to the token's current owner. */
export async function requestShipment(origin: string, assetId: string, shipTo: string) {
  const res = await fetch(`${ccUrl(origin)}/redemptions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ assetId, shipTo, requestedBy: POKECHAIN_ESCROW }),
    cache: "no-store",
  });
  const data = (await res.json()) as { redemption?: Redemption; error?: string };
  if (!res.ok || !data.redemption) throw new Error(`Collector Crypt refused the redemption: ${data.error ?? res.status}`);
  const r = data.redemption;
  const check: CheckStep = {
    call: "Collector Crypt POST /redemptions",
    ok: true,
    detail: `${r.id}: ${r.carrier} ${r.trackingNumber}, NFT frozen in escrow (not burned)`,
  };
  return { redemption: r, check };
}

/** Everything CC and Solana know about one slab, for the trace page. */
export async function custodianTrace(origin: string, assetId: string, redemptionRef?: string) {
  const [asset, sigs, redemption] = await Promise.all([
    solanaRpc<DasAsset>(origin, "getAsset", { id: assetId }),
    solanaRpc<{ total: number; _details: { signature: string; slot: number; at: string; type: string; description: string }[] }>(
      origin,
      "getSignaturesForAsset",
      { id: assetId },
    ),
    redemptionRef
      ? fetch(`${ccUrl(origin)}/redemptions/${encodeURIComponent(redemptionRef)}`, { cache: "no-store" }).then((r) =>
          r.ok ? (r.json() as Promise<Redemption>) : undefined,
        )
      : Promise.resolve(undefined),
  ]);
  const a = asset.result;
  return {
    asset: a
      ? {
          id: a.id,
          name: a.content.metadata.name,
          owner: a.ownership.owner,
          ownerIsPokechainEscrow: a.ownership.owner === POKECHAIN_ESCROW,
          frozen: a.ownership.frozen,
          burnt: a.burnt,
          vaultStatus: attr(a, "Vault status"),
        }
      : null,
    solanaTxs: sigs.result?._details ?? [],
    // the address is CC's business; the trace only needs to show where it was going, masked
    redemption: redemption ? { ...redemption, shipTo: maskAddress(redemption.shipTo) } : null,
  };
}

function maskAddress(a: string) {
  const parts = a.split(",").map((p) => p.trim());
  return parts.length > 1 ? `${parts[0]}, …, ${parts.at(-1)}` : `${a.slice(0, 8)}…`;
}
