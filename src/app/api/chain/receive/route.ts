/**
 * Pokechain operator: the collector's parcel reached Pokechain's warehouse (SlabVault.markReceived),
 * or, if the cert doesn't exist, the submission is rejected on-chain (SlabVault.rejectSubmission).
 *
 *   POST /api/chain/receive   { "submissionId": "1" }
 */
import { operatorError, receiveSubmission } from "@/lib/chain/operator";

export async function POST(request: Request) {
  try {
    const { submissionId } = (await request.json()) as { submissionId: string };
    return Response.json(await receiveSubmission(BigInt(submissionId)));
  } catch (e) {
    return Response.json({ error: operatorError(e, "Receive failed") }, { status: 400 });
  }
}
