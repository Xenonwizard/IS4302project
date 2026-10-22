/**
 * Pokechain operator: ship the slab on to Collector Crypt (SlabVault.markForwarded, with tracking).
 *
 *   POST /api/chain/forward   { "submissionId": "1" }
 */
import { forwardSubmission, operatorError } from "@/lib/chain/operator";

export async function POST(request: Request) {
  try {
    const { submissionId } = (await request.json()) as { submissionId: string };
    return Response.json(await forwardSubmission(BigInt(submissionId)));
  } catch (e) {
    return Response.json({ error: operatorError(e, "Forward failed") }, { status: 400 });
  }
}
