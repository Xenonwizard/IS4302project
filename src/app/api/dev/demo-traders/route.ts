/**
 * Local chain only: two ready-to-trade collectors, so a multi-slab trade can be shown straight away.
 *
 *   POST /api/dev/demo-traders
 *
 *   @ash    Hardhat test collector #1   3 Pikachus + 1 Charizard, $1,000 USDC in custody
 *   @misty  Hardhat test collector #2   2 Articunos + 1 Charizard-GX, $1,000 USDC in custody
 *
 * Every slab goes through the real on-chain onboarding: requestSubmission (the NFT is minted,
 * pending), markReceived, markForwarded (encrypted to Collector Crypt), Collector Crypt's mock
 * intake, then the Solana check and confirmVaulted. Running it twice only fills in what's missing.
 */
import { createWalletClient, http, type Address } from "viem";
import { IS_LOCAL, chain, contracts, toUsdcUnits } from "@/lib/chain/config";
import { forwardSubmission, mintSubmission, operatorError, publicClient, receiveSubmission } from "@/lib/chain/operator";
import { intake, POKECHAIN_ESCROW } from "@/lib/collectorCrypt/store";
import { storeEvidence } from "@/lib/evidence/store";

const TRADERS: { handle: string; address: Address; certs: string[] }[] = [
  // PSA certs whose registry entries are those cards (see lookupCert in src/lib/catalog.ts)
  { handle: "ash", address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", certs: ["70000013", "70000035", "70000041", "70000038"] },
  { handle: "misty", address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", certs: ["70000136", "70000256", "70000022"] },
];
const STARTING_USD = 1_000;
const DECLARED_CENTS = 50_000;

export async function POST(request: Request) {
  if (!IS_LOCAL) return Response.json({ error: "Demo traders only exist on the local chain" }, { status: 400 });
  const origin = new URL(request.url).origin;
  const done: string[] = [];
  try {
    for (const t of TRADERS) {
      // Hardhat's node keeps its test accounts unlocked, so it signs for them.
      const wallet = createWalletClient({ chain, transport: http(), account: t.address });
      const send = async (c: "accounts" | "usdc" | "slabVault", functionName: string, args: unknown[]) => {
        const hash = await wallet.writeContract({ ...contracts[c], functionName, args } as never);
        return publicClient.waitForTransactionReceipt({ hash });
      };

      const active = await publicClient.readContract({ ...contracts.accounts, functionName: "isActive", args: [t.address] });
      if (!active) {
        await send("accounts", "register", [t.handle]);
        const amount = toUsdcUnits(STARTING_USD);
        await send("usdc", "faucet", [amount]);
        await send("usdc", "approve", [contracts.accounts.address, amount]);
        await send("accounts", "deposit", [amount]);
        done.push(`@${t.handle} opened with $${STARTING_USD}`);
      }

      for (const cert of t.certs) {
        const key = await publicClient.readContract({ ...contracts.slabVault, functionName: "certKey", args: ["PSA", cert] });
        if ((await publicClient.readContract({ ...contracts.slabVault, functionName: "tokenOfCert", args: [key] })) !== BigInt(0)) continue;
        const evidence = storeEvidence(
          {
            grader: "PSA",
            certNumber: cert,
            declaredValueCents: DECLARED_CENTS,
            condition: { caseCracked: false, caseScratched: false, labelDamaged: false, notes: "Demo slab" },
            shipping: { method: "dropoff", carrier: "", tracking: "" },
            declarations: { owner: true, authentic: true, terms: true },
            submittedBy: t.address,
            source: "already-vaulted",
          },
          [],
        );
        if ("error" in evidence) throw new Error(evidence.error);
        const receipt = await send("slabVault", "requestSubmission", ["PSA", cert, BigInt(DECLARED_CENTS), evidence.evidenceHash, "Drop-off", ""]);
        if (receipt.status !== "success") throw new Error(`requestSubmission for ${cert} reverted`);
        const id = await publicClient.readContract({ ...contracts.slabVault, functionName: "tokenOfCert", args: [key] });
        await receiveSubmission(id);
        await forwardSubmission(id);
        intake({ grader: "PSA", certNumber: cert, owner: POKECHAIN_ESCROW, depositorRef: `pokechain-submission-${id}` });
        const minted = await mintSubmission(origin, id);
        if (minted.result !== "minted") throw new Error(`Collector Crypt check for ${cert}: ${minted.result}`);
        done.push(`@${t.handle} token #${id} (PSA ${cert}) vaulted`);
      }
    }
    return Response.json({ ok: true, done, traders: TRADERS.map(({ handle, address }) => ({ handle, address })) });
  } catch (e) {
    return Response.json({ error: operatorError(e, "Seeding failed"), done }, { status: 400 });
  }
}
