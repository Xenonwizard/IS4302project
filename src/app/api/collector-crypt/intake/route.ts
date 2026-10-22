/**
 * Mock Collector Crypt intake: the slab Pokechain forwarded has arrived and is vaulted.
 * CC mints the slab's Solana NFT straight to Pokechain's escrow wallet.
 *
 *   POST /api/collector-crypt/intake   { "grader": "PSA", "certNumber": "12345678", "depositorRef": "pokechain-submission-1" }
 *
 * Fire it from Postman (docs/postman/) or the Simulate button on a submission. GET lists every vaulted slab.
 */
import { allCards, intake, isGrader, POKECHAIN_ESCROW } from "@/lib/collectorCrypt/store";

export async function POST(request: Request) {
  let body: { grader?: string; certNumber?: string; depositorRef?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send JSON: { grader, certNumber }" }, { status: 400 });
  }
  const grader = body.grader?.toUpperCase() ?? "";
  const cert = body.certNumber?.trim() ?? "";
  if (!isGrader(grader) || !/^\d{6,10}$/.test(cert)) {
    return Response.json({ error: "grader must be PSA, CGC, BGS or SGC and certNumber 6 to 10 digits" }, { status: 400 });
  }
  const result = intake({ grader, certNumber: cert, owner: POKECHAIN_ESCROW, depositorRef: body.depositorRef });
  if ("error" in result) return Response.json({ error: result.error }, { status: 404 });
  return Response.json({ vaulted: true, alreadyVaulted: !result.created, card: result.card }, { status: result.created ? 201 : 200 });
}

export async function GET() {
  return Response.json({ cards: allCards() });
}
