/**
 * Simulated Collector Crypt: its inbox of incoming parcels. Reads every SubmissionForwarded event
 * addressed to CC from the chain and decrypts each with CC's private key.
 *
 *   GET /api/collector-crypt/inbox
 */
import { readInbox } from "@/lib/collectorCrypt/keys";
import { operatorError } from "@/lib/chain/operator";

export async function GET() {
  try {
    return Response.json(await readInbox());
  } catch (e) {
    return Response.json({ error: operatorError(e, "Inbox failed") }, { status: 500 });
  }
}
