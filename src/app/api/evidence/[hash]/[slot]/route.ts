/** GET /api/evidence/0x…/front  one intake photo. */
import { readPhoto } from "@/lib/evidence/store";

export async function GET(_request: Request, ctx: RouteContext<"/api/evidence/[hash]/[slot]">) {
  const { hash, slot } = await ctx.params;
  const photo = /^0x[0-9a-fA-F]{64}$/.test(hash) ? readPhoto(hash, slot) : null;
  if (!photo) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(photo.data), { headers: { "content-type": photo.type, "cache-control": "private, max-age=3600" } });
}
