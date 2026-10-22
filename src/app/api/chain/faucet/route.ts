/** Local chain only: send a fresh wallet 10 test ETH so it can pay gas. */
import { isAddress } from "viem";
import { sendGas } from "@/lib/chain/operator";

export async function POST(request: Request) {
  try {
    const { address } = (await request.json()) as { address: string };
    if (!isAddress(address)) return Response.json({ error: "Not an address" }, { status: 400 });
    return Response.json(await sendGas(address));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Faucet failed" }, { status: 400 });
  }
}
