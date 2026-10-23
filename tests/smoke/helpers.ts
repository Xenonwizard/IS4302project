import { createPublicClient, createWalletClient, http, parseEventLogs, type Address } from "viem";
import { hardhat } from "viem/chains";
import type { APIRequestContext, Page } from "@playwright/test";
import { accountRegistryAbi, deployments, slabVaultAbi } from "../../src/lib/chain/generated";
import { expect } from "./fixtures";

const local = deployments["31337"];

/** Back to "contracts just deployed", the same call the Reset chain + demo data button makes. */
export async function resetDemo(request: APIRequestContext) {
  const res = await request.post("/api/dev/reset");
  expect(res.ok(), await res.text()).toBeTruthy();
}

/** Signs up in the UI with one of the built-in Hardhat test wallets. */
export async function openAccount(page: Page, handle: string, wallet: 1 | 2 = 1) {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign up" }).click();
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await page.getByText(`Hardhat test collector #${wallet}`).click();
  await page.getByPlaceholder("vaultedcharizard").fill(handle);
  await page.getByRole("button", { name: "Open account" }).click();
  await expect(page.locator("header")).toContainText(handle);
}

/**
 * A slab that has reached step 3 (forwarded to Collector Crypt), set up straight against the
 * chain and the API with Hardhat account #3, so a test can look at what Collector Crypt sees.
 */
export async function forwardedSubmission(request: APIRequestContext, cert: string) {
  const who: Address = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
  const pub = createPublicClient({ chain: hardhat, transport: http() });
  const wallet = createWalletClient({ chain: hardhat, transport: http(), account: who });
  await pub.waitForTransactionReceipt({
    hash: await wallet.writeContract({ address: local.AccountRegistry, abi: accountRegistryAbi, functionName: "register", args: ["smoke_three"] }),
  });
  const evidence = await request.post("/api/evidence", {
    multipart: {
      meta: JSON.stringify({
        grader: "PSA",
        certNumber: cert,
        declaredValueCents: 50_000,
        condition: { caseCracked: false, caseScratched: false, labelDamaged: false, notes: "" },
        shipping: { method: "dropoff", carrier: "", tracking: "" },
        declarations: { owner: true, authentic: true, terms: true },
        submittedBy: who,
        source: "already-vaulted",
      }),
    },
  });
  const { evidenceHash } = await evidence.json();
  const receipt = await pub.waitForTransactionReceipt({
    hash: await wallet.writeContract({
      address: local.SlabVault,
      abi: slabVaultAbi,
      functionName: "requestSubmission",
      args: ["PSA", cert, BigInt(50_000), evidenceHash, "Drop-off", ""],
    }),
  });
  const [ev] = parseEventLogs({ abi: slabVaultAbi, logs: receipt.logs, eventName: "SubmissionRequested" });
  const submissionId = ev.args.submissionId.toString();
  expect((await (await request.post("/api/chain/receive", { data: { submissionId } })).json()).result).toBe("received");
  const forwarded = await (await request.post("/api/chain/forward", { data: { submissionId } })).json();
  expect(forwarded.trackingNumber, JSON.stringify(forwarded)).toBeTruthy();
  return { submissionId, trackingNumber: forwarded.trackingNumber as string };
}
