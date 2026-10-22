/** GET /api/trace/1: a slab's full journey across Polygon, Solana and Collector Crypt. */
import { operatorError } from "@/lib/chain/operator";
import { traceSlab } from "@/lib/chain/trace";

export async function GET(request: Request, ctx: RouteContext<"/api/trace/[tokenId]">) {
  const { tokenId } = await ctx.params;
  try {
    return Response.json(await traceSlab(new URL(request.url).origin, BigInt(tokenId)));
  } catch (e) {
    return Response.json({ error: operatorError(e, "Trace failed") }, { status: 404 });
  }
}
