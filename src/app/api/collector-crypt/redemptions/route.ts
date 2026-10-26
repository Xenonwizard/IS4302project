/**
 * Mock Collector Crypt redemption: the NFT's holder asks CC to ship the slab to an address.
 * Pokechain's operator calls this (as holder, via its escrow wallet) when a token owner withdraws.
 *
 *   POST /api/collector-crypt/redemptions   { "assetId": "...", "shipTo": "Name, street, city", "requestedBy": "<holder wallet>" }
 *
 * CC takes the slab out of its vault and burns its NFT; the burn stays in the asset's Solana history.
 */
import { requestRedemption } from "@/lib/collectorCrypt/store";

export async function POST(request: Request) {
  const body = (await request.json()) as { assetId?: string; shipTo?: string; requestedBy?: string };
  if (!body.assetId || !body.shipTo?.trim() || !body.requestedBy) {
    return Response.json({ error: "Send { assetId, shipTo, requestedBy }" }, { status: 400 });
  }
  const result = requestRedemption({ assetId: body.assetId, shipTo: body.shipTo.trim(), requestedBy: body.requestedBy });
  if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ redemption: result.redemption }, { status: 201 });
}
