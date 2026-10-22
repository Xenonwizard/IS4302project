/**
 * Mock Collector Crypt card lookup: GET /api/collector-crypt/cards/PSA/12345678
 * 404 until CC has vaulted the slab; then its status and Solana NFT.
 */
import { SOLANA_CLUSTER, lookup } from "@/lib/collectorCrypt/store";

export async function GET(_request: Request, ctx: RouteContext<"/api/collector-crypt/cards/[grader]/[cert]">) {
  const { grader, cert } = await ctx.params;
  const card = lookup(grader, cert);
  if (!card) {
    return Response.json(
      { found: false, grader: grader.toUpperCase(), certNumber: cert, message: "Collector Crypt has not vaulted this slab." },
      { status: 404 },
    );
  }
  return Response.json({
    found: true,
    grader: card.grader,
    certNumber: card.certNumber,
    title: card.title,
    grade: card.grade,
    vaultStatus: card.vaultStatus,
    vaultedAt: card.vaultedAt,
    depositorRef: card.depositorRef,
    redemptionId: card.redemptionId,
    solana: { cluster: SOLANA_CLUSTER, assetId: card.assetId, owner: card.owner, frozen: card.frozen },
  });
}
