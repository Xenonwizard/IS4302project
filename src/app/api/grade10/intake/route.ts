/**
 * Mock Grade10 intake: the call Grade10's warehouse would make when a slab arrives.
 *
 *   POST /api/grade10/intake   { "grader": "PSA", "certNumber": "12345678" }
 *
 * Checks the slab in and "mints" its Solana vault NFT. Fire it from Postman (see
 * docs/postman/) or the Simulate button on a pending submission. GET lists every intake.
 */
import { allIntakes, intake, isGrader } from "@/lib/grade10/registry";

export async function POST(request: Request) {
  let body: { grader?: string; certNumber?: string };
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
  const result = intake(grader, cert);
  if ("error" in result) return Response.json({ error: result.error }, { status: 404 });
  return Response.json({ received: true, alreadyReceived: !result.created, record: result.record }, { status: result.created ? 201 : 200 });
}

export async function GET() {
  return Response.json({ intakes: allIntakes() });
}
