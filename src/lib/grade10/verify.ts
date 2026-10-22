/**
 * The operator's cross-chain custody check, run before any Polygon token is minted:
 *
 *   1. Grade10 registry   GET  {GRADE10_API_URL}/certs/{grader}/{cert}
 *                         has Grade10 received the slab? which Solana asset records it?
 *   2. Solana             POST {SOLANA_RPC_URL}  getAsset(assetId)   (DAS JSON-RPC)
 *                         does the chain agree: owned by Grade10's vault wallet, frozen in
 *                         custody, not burnt, in Grade10's collection, same cert number?
 *
 * Both are real HTTP calls. They default to this app's mock routes; point the two env vars at
 * Grade10's API and a Solana RPC (e.g. https://mainnet.helius-rpc.com/?api-key=...) to go live.
 */
import "server-only";
import { GRADE10_COLLECTION, GRADE10_VAULT_WALLET } from "./registry";

export interface CheckStep {
  /** e.g. "Grade10 GET /certs/PSA/12345678" */
  call: string;
  ok: boolean;
  detail: string;
}

export type CustodyResult =
  | { status: "verified"; assetId: string; checks: CheckStep[] }
  | { status: "awaiting_intake" | "mismatch"; checks: CheckStep[] };

export async function verifyGrade10Custody(origin: string, grader: string, cert: string): Promise<CustodyResult> {
  const registryUrl = process.env.GRADE10_API_URL ?? `${origin}/api/grade10`;
  const solanaRpc = process.env.SOLANA_RPC_URL ?? `${origin}/api/mock-solana`;
  const checks: CheckStep[] = [];

  // 1. Grade10's registry
  const regCall = `Grade10 GET /certs/${grader}/${cert}`;
  const reg = await fetch(`${registryUrl}/certs/${encodeURIComponent(grader)}/${encodeURIComponent(cert)}`, { cache: "no-store" });
  if (reg.status === 404) {
    checks.push({ call: regCall, ok: false, detail: "Not received by Grade10 yet" });
    return { status: "awaiting_intake", checks };
  }
  const record = (await reg.json()) as { status: string; solana: { assetId: string } };
  checks.push({ call: regCall, ok: true, detail: `Received, Solana asset ${record.solana.assetId}` });

  // 2. Solana: the custodian's on-chain record
  const assetId = record.solana.assetId;
  const solCall = `Solana getAsset(${assetId.slice(0, 6)}…)`;
  const rpc = await fetch(solanaRpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "pokechain-custody-check", method: "getAsset", params: { id: assetId } }),
    cache: "no-store",
  });
  const { result, error } = (await rpc.json()) as {
    result?: {
      ownership: { owner: string; frozen: boolean };
      burnt: boolean;
      grouping: { group_key: string; group_value: string }[];
      content: { metadata: { attributes: { trait_type: string; value: string }[] } };
    };
    error?: { message: string };
  };
  if (!result) {
    checks.push({ call: solCall, ok: false, detail: error?.message ?? "No asset" });
    return { status: "mismatch", checks };
  }

  const certOnChain = result.content.metadata.attributes.find((a) => a.trait_type === "Cert number")?.value;
  const inCollection = result.grouping.some((g) => g.group_key === "collection" && g.group_value === GRADE10_COLLECTION);
  const problems = [
    result.ownership.owner !== GRADE10_VAULT_WALLET && "not owned by the Grade10 vault wallet",
    !result.ownership.frozen && "not frozen in custody",
    result.burnt && "burnt",
    !inCollection && "not in the Grade10 collection",
    certOnChain !== cert && `cert on Solana is ${certOnChain}`,
  ].filter(Boolean);

  if (problems.length) {
    checks.push({ call: solCall, ok: false, detail: problems.join(", ") });
    return { status: "mismatch", checks };
  }
  checks.push({ call: solCall, ok: true, detail: "Owned and frozen by the Grade10 vault wallet, cert matches" });
  return { status: "verified", assetId, checks };
}

/** Tells Grade10 the slab is shipping out, so its Solana NFT leaves the vault wallet. */
export async function releaseFromGrade10(origin: string, assetId: string): Promise<CheckStep> {
  const registryUrl = process.env.GRADE10_API_URL ?? `${origin}/api/grade10`;
  const res = await fetch(`${registryUrl}/release`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ assetId }),
    cache: "no-store",
  });
  return { call: "Grade10 POST /release", ok: res.ok, detail: res.ok ? "Solana NFT released from the vault wallet" : `HTTP ${res.status}` };
}
