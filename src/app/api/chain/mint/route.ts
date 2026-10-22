/**
 * Vault operator: check Grade10 custody (registry + Solana) and, once verified, mint the token
 * for a pending slab submission (SlabVault.mintSlab). The browser calls this after the
 * collector's requestSubmission transaction confirms, and again while it waits for Grade10.
 */
import { mintSubmission } from "@/lib/chain/operator";

export async function POST(request: Request) {
  try {
    const { submissionId, listingId } = (await request.json()) as { submissionId: string; listingId?: string };
    const result = await mintSubmission(new URL(request.url).origin, BigInt(submissionId), listingId);
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Mint failed" }, { status: 400 });
  }
}
