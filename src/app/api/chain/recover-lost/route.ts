/** Operator simulation: verify a recovered slab and ship it to the latest token owner. */
import { operatorError, shipRecoveredSlab } from "@/lib/chain/operator";

export async function POST(request: Request) {
  try {
    const { tokenId, carrier, trackingNumber } = (await request.json()) as {
      tokenId: string;
      carrier: string;
      trackingNumber: string;
    };
    return Response.json(await shipRecoveredSlab(BigInt(tokenId), carrier, trackingNumber));
  } catch (error) {
    return Response.json({ error: operatorError(error, "Recovered slab could not be shipped") }, { status: 400 });
  }
}
