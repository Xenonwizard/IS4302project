/**
 * Pokechain operator: closes a lost-parcel report (SlabVault.resolveLostReport).
 *
 *   POST /api/chain/resolve-lost   { "tokenId": "1", "outcome": "at-pokechain" | "delivered" | "vaulted" }
 */
import { LOST_OUTCOMES, operatorError, resolveLost, type LostOutcome } from "@/lib/chain/operator";

export async function POST(request: Request) {
  try {
    const { tokenId, outcome } = (await request.json()) as { tokenId: string; outcome: LostOutcome };
    if (!(outcome in LOST_OUTCOMES)) {
      return Response.json({ error: `outcome must be one of ${Object.keys(LOST_OUTCOMES).join(", ")}` }, { status: 400 });
    }
    return Response.json(await resolveLost(BigInt(tokenId), outcome));
  } catch (e) {
    return Response.json({ error: operatorError(e, "Resolve failed") }, { status: 400 });
  }
}
