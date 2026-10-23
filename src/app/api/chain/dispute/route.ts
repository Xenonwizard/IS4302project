/**
 * Dispute over a forwarded parcel: Pokechain reveals the message and salt it committed to, and
 * SlabVault.verifyForwardCommitment checks them on-chain.
 *
 *   POST /api/chain/dispute   { "submissionId": "1" }
 */
import { disputeForward, operatorError } from "@/lib/chain/operator";

export async function POST(request: Request) {
  try {
    const { submissionId } = (await request.json()) as { submissionId: string };
    return Response.json(await disputeForward(BigInt(submissionId)));
  } catch (e) {
    return Response.json({ error: operatorError(e, "Dispute check failed") }, { status: 400 });
  }
}
