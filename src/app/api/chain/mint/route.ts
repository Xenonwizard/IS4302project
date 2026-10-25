/**
 * Pokechain operator: once Collector Crypt has vaulted the slab, check CC's API and the Solana NFT
 * (held by Pokechain's escrow?) and confirm the Polygon token as Vaulted (SlabVault.confirmVaulted). The browser
 * polls this while a submission is at Collector Crypt.
 *
 *   POST /api/chain/mint   { "submissionId": "1" }
 */
import { mintSubmission, operatorError } from "@/lib/chain/operator";

export async function POST(request: Request) {
  try {
    const { submissionId, listingId } = (await request.json()) as { submissionId: string; listingId?: string };
    return Response.json(await mintSubmission(new URL(request.url).origin, BigInt(submissionId), listingId));
  } catch (e) {
    return Response.json({ error: operatorError(e, "Mint failed") }, { status: 400 });
  }
}
