/**
 * Pokechain operator: moves a finder's claim through intake on LostAndFound.
 *
 *   POST /api/chain/found   { "claimId": "1", "step": "receive" | "return" | "reject", "reason"?: "…" }
 */
import { FOUND_STEPS, foundClaimStep, operatorError, type FoundStep } from "@/lib/chain/operator";

export async function POST(request: Request) {
  try {
    const { claimId, step, reason } = (await request.json()) as { claimId: string; step: FoundStep; reason?: string };
    if (!FOUND_STEPS.includes(step)) {
      return Response.json({ error: `step must be one of ${FOUND_STEPS.join(", ")}` }, { status: 400 });
    }
    return Response.json(await foundClaimStep(BigInt(claimId), step, reason));
  } catch (e) {
    return Response.json({ error: operatorError(e, "Found-slab step failed") }, { status: 400 });
  }
}
