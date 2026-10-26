/**
 * The owner's delivery address for a redemption, held off-chain by Pokechain.
 *
 * POST /api/chain/outtake/address  { "tokenId": "4", "shipTo": "Name, street, city" }
 *   the owner, right after SlabVault.requestRedemption; refused unless it matches the on-chain shippingHash
 * GET  /api/chain/outtake/address?certNumber=1234567
 *   the outtake screen, to prefill what it sends to Collector Crypt
 */
import { operatorError, saveSignedAddress, signedAddressFor, tokenForPsaCert } from "@/lib/chain/operator";

export async function POST(request: Request) {
  try {
    const { tokenId, shipTo } = (await request.json()) as { tokenId?: string; shipTo?: string };
    if (!tokenId || !/^\d+$/.test(tokenId)) return Response.json({ error: "tokenId must be a positive integer" }, { status: 400 });
    if (!shipTo?.trim()) return Response.json({ error: "shipTo is required" }, { status: 400 });
    await saveSignedAddress(BigInt(tokenId), shipTo);
    return Response.json({ saved: true });
  } catch (e) {
    return Response.json({ error: operatorError(e, "Could not save the delivery address") }, { status: 400 });
  }
}

export async function GET(request: Request) {
  try {
    const certNumber = new URL(request.url).searchParams.get("certNumber") ?? "";
    if (!/^\d{1,10}$/.test(certNumber)) return Response.json({ error: "certNumber must be a numeric PSA cert" }, { status: 400 });
    const tokenId = await tokenForPsaCert(certNumber);
    return Response.json({ tokenId: tokenId.toString(), shipTo: signedAddressFor(tokenId) ?? null });
  } catch (e) {
    return Response.json({ error: operatorError(e, "Could not read the delivery address") }, { status: 400 });
  }
}
