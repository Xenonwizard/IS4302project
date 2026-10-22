/**
 * Mock Solana RPC with the Digital Asset Standard (DAS) read API, serving Collector Crypt's
 * slab NFTs. Same JSON-RPC 2.0 request and response shape as Helius' endpoint, so pointing
 * SOLANA_RPC_URL at a real provider needs no code change.
 *
 *   POST /api/mock-solana   { "jsonrpc": "2.0", "id": 1, "method": "getAsset", "params": { "id": "<assetId>" } }
 *
 * Methods: getAsset, getSignaturesForAsset, getAssetsByOwner, getSlot, getHealth.
 */
import { allCards, byAssetId, dasAsset, dasSignatures } from "@/lib/collectorCrypt/store";

interface RpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

const ok = (id: RpcRequest["id"], result: unknown) => Response.json({ jsonrpc: "2.0", id, result });
const error = (id: RpcRequest["id"] | null, code: number, message: string) =>
  Response.json({ jsonrpc: "2.0", id, error: { code, message } });

export async function POST(request: Request) {
  let req: RpcRequest;
  try {
    req = await request.json();
  } catch {
    return error(null, -32700, "Parse error");
  }

  switch (req.method) {
    case "getHealth":
      return ok(req.id, "ok");
    case "getSlot":
      return ok(req.id, 350_000_000 + Math.floor((Date.now() / 400) % 10_000_000));
    case "getAsset":
    case "getSignaturesForAsset": {
      const id = String(req.params?.id ?? "");
      const card = byAssetId(id);
      if (!card) return error(req.id, -32000, `Asset ${id} not found`);
      return ok(req.id, req.method === "getAsset" ? dasAsset(card) : dasSignatures(card));
    }
    case "getAssetsByOwner": {
      const owner = String(req.params?.ownerAddress ?? "");
      const items = allCards().filter((c) => c.owner === owner).map(dasAsset);
      return ok(req.id, { total: items.length, limit: 1000, page: 1, items });
    }
    default:
      return error(req.id, -32601, `Method ${req.method} not supported by the mock`);
  }
}
