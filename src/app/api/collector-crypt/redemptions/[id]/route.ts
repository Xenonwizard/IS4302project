/** Mock Collector Crypt redemption tracking: GET /api/collector-crypt/redemptions/CCR-00001 */
import { getRedemption } from "@/lib/collectorCrypt/store";

export async function GET(_request: Request, ctx: RouteContext<"/api/collector-crypt/redemptions/[id]">) {
  const { id } = await ctx.params;
  const r = getRedemption(id);
  if (!r) return Response.json({ error: `No redemption ${id}` }, { status: 404 });
  return Response.json(r);
}
