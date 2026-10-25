/**
 * The final operator step. It records the slab in Collector Crypt, verifies its custody record,
 * then changes the already-minted Pokechain NFT to Vaulted.
 *
 * POST /api/chain/vault { "submissionId": "4324324" }
 */
import { operatorError, vaultSubmission } from "@/lib/chain/operator";

export async function POST(request: Request) {
  try {
    const { submissionId, listingId } = (await request.json()) as { submissionId: string; listingId?: string };
    return Response.json(await vaultSubmission(new URL(request.url).origin, BigInt(submissionId), listingId));
  } catch (e) {
    return Response.json({ error: operatorError(e, "Vaulting failed") }, { status: 400 });
  }
}
