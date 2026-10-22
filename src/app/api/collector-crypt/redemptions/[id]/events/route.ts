/**
 * Mock carrier update for a Collector Crypt shipment, as Postman sends it:
 *
 *   POST /api/collector-crypt/redemptions/CCR-00001/events   { "status": "in_transit" | "delivered" | "lost", "note": "optional" }
 *
 * "delivered" and "lost" are also written onto the Solana NFT's metadata (a Solana transaction).
 */
import { addCarrierEvent, type CarrierStatus } from "@/lib/collectorCrypt/store";

const STATUSES: CarrierStatus[] = ["in_transit", "delivered", "lost"];

export async function POST(request: Request, ctx: RouteContext<"/api/collector-crypt/redemptions/[id]/events">) {
  const { id } = await ctx.params;
  const { status, note } = (await request.json()) as { status?: CarrierStatus; note?: string };
  if (!status || !STATUSES.includes(status)) {
    return Response.json({ error: `status must be one of ${STATUSES.join(", ")}` }, { status: 400 });
  }
  const r = addCarrierEvent(id, status, note);
  if (!r) return Response.json({ error: `No redemption ${id}` }, { status: 404 });
  return Response.json(r);
}
