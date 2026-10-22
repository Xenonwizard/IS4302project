/**
 * Mock Solana RPC with the Digital Asset Standard (DAS) read API, enough for the operator's
 * custody check. Same JSON-RPC 2.0 request and response shape as Helius' mainnet endpoint,
 * so pointing SOLANA_RPC_URL at a real provider needs no code change.
 *
 *   POST /api/mock-solana   { "jsonrpc": "2.0", "id": 1, "method": "getAsset", "params": { "id": "<assetId>" } }
 */
import { allIntakes, byAssetId, dasAsset, GRADE10_VAULT_WALLET } from "@/lib/grade10/registry";

interface RpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

const error = (id: RpcRequest["id"] | null, code: number, message: string) =>
  Response.json({ jsonrpc: "2.0", id, error: { code, message } });

export async function POST(request: Request) {
  let req: RpcRequest;
  try {
    req = await request.json();
  } catch {
    return error(null, -32700, "Parse error");
  }
  const slot = 350_000_000 + Math.floor((Date.now() / 400) % 10_000_000);

  switch (req.method) {
    case "getHealth":
      return Response.json({ jsonrpc: "2.0", id: req.id, result: "ok" });
    case "getSlot":
      return Response.json({ jsonrpc: "2.0", id: req.id, result: slot });
    case "getAsset": {
      const id = String(req.params?.id ?? "");
      const record = byAssetId(id);
      if (!record) return error(req.id, -32000, `Asset ${id} not found`);
      return Response.json({ jsonrpc: "2.0", id: req.id, result: dasAsset(record) });
    }
    case "getAssetsByOwner": {
      const owner = String(req.params?.ownerAddress ?? "");
      const items = owner === GRADE10_VAULT_WALLET ? allIntakes().filter((r) => r.status === "in_vault").map(dasAsset) : [];
      return Response.json({ jsonrpc: "2.0", id: req.id, result: { total: items.length, limit: 1000, page: 1, items } });
    }
    default:
      return error(req.id, -32601, `Method ${req.method} not supported by the mock`);
  }
}
