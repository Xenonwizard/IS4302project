/**
 * Mock Grade10 release: the slab leaves Grade10's vault for the collector, so its Solana
 * NFT moves out of the vault wallet. Pokechain's operator calls this when it ships a redemption.
 *
 *   POST /api/grade10/release   { "assetId": "<solana asset id>" }
 */
import { release } from "@/lib/grade10/registry";

export async function POST(request: Request) {
  const { assetId } = (await request.json()) as { assetId?: string };
  const record = assetId ? release(assetId) : undefined;
  if (!record) return Response.json({ error: `No Grade10 record for asset ${assetId}` }, { status: 404 });
  return Response.json({ released: true, record });
}
