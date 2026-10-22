/**
 * GET /api/evidence/0x…  the manifest behind an on-chain evidenceHash, re-verified: the manifest
 * must hash to that value and every photo must hash to what the manifest lists.
 */
import { loadEvidence } from "@/lib/evidence/store";

export async function GET(_request: Request, ctx: RouteContext<"/api/evidence/[hash]">) {
  const { hash } = await ctx.params;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) return Response.json({ error: "Not a 32-byte hash" }, { status: 400 });
  const ev = loadEvidence(hash);
  if (!ev) return Response.json({ error: `No evidence stored for ${hash}` }, { status: 404 });
  return Response.json(ev);
}
