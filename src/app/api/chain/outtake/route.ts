/**
 * Pokechain outtake: a token owner has requested redemption, so Pokechain (the holder of
 * Collector Crypt's escrowed NFT) notifies Collector Crypt to release and ship the physical slab.
 *
 * POST /api/chain/outtake  { "certNumber": "1234567" }
 * `shipTo` is optional: it defaults to the address the owner gave Pokechain when withdrawing.
 *
 * `tokenId` remains accepted for the normal wallet withdrawal flow, which has already resolved
 * the cert to its token before this server-to-server hand-off.
 */
import { operatorError, shipSlab, tokenForPsaCert } from "@/lib/chain/operator";

export async function POST(request: Request) {
  try {
    const { tokenId, certNumber, shipTo } = (await request.json()) as { tokenId?: string; certNumber?: string; shipTo?: string };
    if (!tokenId && !certNumber) return Response.json({ error: "Send tokenId or PSA certNumber" }, { status: 400 });
    if (tokenId && !/^\d+$/.test(tokenId)) return Response.json({ error: "tokenId must be a positive integer" }, { status: 400 });
    if (certNumber && !/^\d{1,10}$/.test(certNumber)) return Response.json({ error: "certNumber must be a numeric PSA cert" }, { status: 400 });
    const resolvedTokenId = tokenId ? BigInt(tokenId) : await tokenForPsaCert(certNumber!);
    return Response.json({ tokenId: resolvedTokenId.toString(), ...(await shipSlab(new URL(request.url).origin, resolvedTokenId, shipTo?.trim() || undefined)) });
  } catch (e) {
    return Response.json({ error: operatorError(e, "Outtake notification failed") }, { status: 400 });
  }
}
