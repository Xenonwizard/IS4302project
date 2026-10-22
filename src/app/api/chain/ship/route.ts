/**
 * Vault operator: hand a redeemed slab to the carrier (SlabVault.markShipped).
 * The browser calls this after the owner's requestRedemption transaction confirms.
 */
import { shipSlab } from "@/lib/chain/operator";

export async function POST(request: Request) {
  try {
    const { tokenId } = (await request.json()) as { tokenId: string };
    return Response.json(await shipSlab(new URL(request.url).origin, BigInt(tokenId)));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Shipping failed" }, { status: 400 });
  }
}
