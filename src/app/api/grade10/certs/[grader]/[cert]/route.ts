/**
 * Mock Grade10 registry: GET /api/grade10/certs/PSA/12345678
 * Has Grade10 received this slab, and what is its Solana asset id? 404 until the intake call.
 */
import { GRADE10_VAULT_WALLET, SOLANA_CLUSTER, lookup } from "@/lib/grade10/registry";

export async function GET(_request: Request, ctx: RouteContext<"/api/grade10/certs/[grader]/[cert]">) {
  const { grader, cert } = await ctx.params;
  const record = lookup(grader, cert);
  if (!record) {
    return Response.json(
      { found: false, grader: grader.toUpperCase(), certNumber: cert, message: "Grade10 has not received this slab yet." },
      { status: 404 },
    );
  }
  return Response.json({
    found: true,
    grader: record.grader,
    certNumber: record.certNumber,
    title: record.title,
    grade: record.grade,
    status: record.status,
    receivedAt: record.receivedAt,
    solana: {
      cluster: SOLANA_CLUSTER,
      assetId: record.assetId,
      custodianWallet: GRADE10_VAULT_WALLET,
      mintSignature: record.signature,
      slot: record.slot,
    },
  });
}
