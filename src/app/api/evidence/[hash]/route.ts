/**
 * GET /api/evidence/0x…  the manifest behind an on-chain evidenceHash, re-verified: the manifest
 * must hash to that value and every photo must hash to what the manifest lists.
 */
import { loadEvidence } from "@/lib/evidence/store";

export async function GET(_request: Request, ctx: { params: Promise<{ hash: string }> }) {
  const { hash } = await ctx.params;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) return Response.json({ error: "Not a 32-byte hash" }, { status: 400 });
  const ev = loadEvidence(hash);
  // Seeded demo slabs were created on-chain without an intake form, so "nothing stored" is a normal
  // answer, not a failed request (a 404 would show up as an error in every browser console).
  if (!ev) return Response.json({ found: false, error: `No intake evidence stored for ${hash}` });
  return Response.json(ev);
}
