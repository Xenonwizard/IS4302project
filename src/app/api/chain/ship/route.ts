/**
 * Pokechain operator: after the owner's requestRedemption, ask Collector Crypt (as holder of its
 * NFT) to ship to the owner, then record CC's redemption id and tracking (SlabVault.markShipped).
 * The address is checked against the shippingHash the owner put on-chain.
 *
 *   POST /api/chain/ship   { "tokenId": "1", "shipTo": "Name, street, city" }
 */
import { operatorError, shipSlab } from "@/lib/chain/operator";

export async function POST(request: Request) {
  try {
    const { tokenId, shipTo } = (await request.json()) as { tokenId: string; shipTo: string };
    if (!shipTo?.trim()) return Response.json({ error: "shipTo is required" }, { status: 400 });
    return Response.json(await shipSlab(new URL(request.url).origin, BigInt(tokenId), shipTo));
  } catch (e) {
    return Response.json({ error: operatorError(e, "Shipping failed") }, { status: 400 });
  }
}
