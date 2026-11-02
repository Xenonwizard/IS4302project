import { createPublicClient, createWalletClient, http, parseEventLogs, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hardhat } from "viem/chains";
import type { APIRequestContext, Page } from "@playwright/test";
import { accountRegistryAbi, deployments, lostSlabRecoveryAbi, mockUSDCAbi, slabMarketAbi, slabVaultAbi, tradeEscrowAbi } from "../../src/lib/chain/generated";
import { expect } from "./fixtures";

const local = deployments["31337"];

/** Back to "contracts just deployed", without the seeded demo data (the Reset button re-seeds it). */
export async function resetDemo(request: APIRequestContext) {
  const res = await request.post("/api/dev/reset?clean=1");
  expect(res.ok(), await res.text()).toBeTruthy();
}

/** Back to the seeded demo: test1 / test2 (wallets #1 / #2), ash, misty, brock, their slabs and listings. */
export async function resetSeeded(request: APIRequestContext) {
  const res = await request.post("/api/dev/reset");
  expect(res.ok(), await res.text()).toBeTruthy();
}

export const TEST1: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
export const TEST2: Address = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

/** Opens @ash (test collector #1) and @misty (#2) with vaulted slabs and $1,000 each, on-chain. */
export async function loadDemoTraders(request: APIRequestContext) {
  const res = await request.post("/api/dev/demo-traders");
  expect(res.ok(), await res.text()).toBeTruthy();
}

/** Logs in with a test wallet that already has an on-chain account (no handle to type). */
export async function logIn(page: Page, wallet: 1 | 2, handle: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "Log in" }).first().click();
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await page.getByText(`test${wallet} wallet`, { exact: true }).click();
  await expect(page.locator("header")).toContainText(handle);
}

export const ASH: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
export const MISTY: Address = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

/** Who owns a token right now, straight from SlabVault. */
export async function ownerOf(tokenId: number) {
  const pub = createPublicClient({ chain: hardhat, transport: http() });
  return pub.readContract({ address: local.SlabVault, abi: slabVaultAbi, functionName: "ownerOf", args: [BigInt(tokenId)] });
}

/** Hardhat's published test key for account #2 (@misty). It only exists on the local test chain. */
const MISTY_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";

/** @misty lists one of her slabs for sale on the marketplace (SlabMarket.list), at a dollar price. */
export async function listAsMisty(tokenId: number, dollars: number) {
  const pub = createPublicClient({ chain: hardhat, transport: http() });
  const wallet = createWalletClient({ chain: hardhat, transport: http(), account: privateKeyToAccount(MISTY_KEY) });
  await pub.waitForTransactionReceipt({
    hash: await wallet.writeContract({ address: local.SlabMarket, abi: slabMarketAbi, functionName: "list", args: [BigInt(tokenId), BigInt(dollars * 1_000_000)] }),
  });
}

/** Whether SlabVault says a slab is currently listed for sale. */
export async function isListed(tokenId: number) {
  const pub = createPublicClient({ chain: hardhat, transport: http() });
  return pub.readContract({ address: local.SlabVault, abi: slabVaultAbi, functionName: "isListed", args: [BigInt(tokenId)] });
}

/** Custody balance in AccountRegistry, in dollars. */
export async function custodyDollars(who: Address) {
  const pub = createPublicClient({ chain: hardhat, transport: http() });
  const units = await pub.readContract({ address: local.AccountRegistry, abi: accountRegistryAbi, functionName: "balanceOf", args: [who] });
  return Number(units) / 1e6;
}

/** Signs up in the UI with one of the built-in Hardhat test wallets. */
export async function openAccount(page: Page, handle: string, wallet: 1 | 2 = 1) {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign up" }).click();
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await page.getByText(`test${wallet} wallet`, { exact: true }).click();
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
      args: ["PSA", cert, evidenceHash, "Drop-off", ""],
    }),
  });
  const [ev] = parseEventLogs({ abi: slabVaultAbi, logs: receipt.logs, eventName: "SubmissionRequested" });
  const submissionId = ev.args.submissionId.toString();
  expect((await (await request.post("/api/chain/receive", { data: { submissionId } })).json()).result).toBe("received");
  const forwarded = await (await request.post("/api/chain/forward", { data: { submissionId } })).json();
  expect(forwarded.trackingNumber, JSON.stringify(forwarded)).toBeTruthy();
  return { submissionId, trackingNumber: forwarded.trackingNumber as string };
}

/** Hardhat's published test key for account #1 (test1 / @ash). Local test chain only. */
const TEST1_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

/** Test wallet #1 moves dollars from its wallet into its Pokechain balance (approve + deposit). */
export async function depositAsTest1(dollars: number) {
  await depositAs(TEST1_KEY, dollars);
}

/** test2 (wallet #2, the same Hardhat account as @misty) tops up their Pokechain balance. */
export async function depositAsTest2(dollars: number) {
  await depositAs(MISTY_KEY, dollars);
}

/**
 * Test wallet #1 offers a trade straight on TradeEscrow, tagged with a chat room, without the app
 * posting it to that chat: as if the chat message was lost after the transaction went through.
 */
export async function offerAsTest1(to: Address, giveSlabs: number[], askSlabs: number[], room: string) {
  const pub = createPublicClient({ chain: hardhat, transport: http() });
  const wallet = createWalletClient({ chain: hardhat, transport: http(), account: privateKeyToAccount(TEST1_KEY) });
  await pub.waitForTransactionReceipt({
    hash: await wallet.writeContract({
      address: local.TradeEscrow,
      abi: tradeEscrowAbi,
      functionName: "createOffer",
      args: [to, giveSlabs.map(BigInt), BigInt(0), askSlabs.map(BigInt), BigInt(0), room],
    }),
  });
}

async function depositAs(key: `0x${string}`, dollars: number) {
  const pub = createPublicClient({ chain: hardhat, transport: http() });
  const wallet = createWalletClient({ chain: hardhat, transport: http(), account: privateKeyToAccount(key) });
  const units = BigInt(dollars * 1_000_000);
  await pub.waitForTransactionReceipt({
    hash: await wallet.writeContract({ address: local.MockUSDC, abi: mockUSDCAbi, functionName: "approve", args: [local.AccountRegistry, units] }),
  });
  await pub.waitForTransactionReceipt({
    hash: await wallet.writeContract({ address: local.AccountRegistry, abi: accountRegistryAbi, functionName: "deposit", args: [units] }),
  });
}

/** The bounty LostSlabRecovery holds in escrow for a slab, in dollars. */
export async function escrowedBounty(tokenId: number) {
  const pub = createPublicClient({ chain: hardhat, transport: http() });
  const units = await pub.readContract({ address: local.LostSlabRecovery, abi: lostSlabRecoveryAbi, functionName: "bountyOf", args: [BigInt(tokenId)] });
  return Number(units) / 1e6;
}

/** A slab's SlabVault custody (1 Vaulted, 5 Lost, …). Still answers after the token burns. */
export async function custodyOf(tokenId: number) {
  const pub = createPublicClient({ chain: hardhat, transport: http() });
  return pub.readContract({ address: local.SlabVault, abi: slabVaultAbi, functionName: "custodyOf", args: [BigInt(tokenId)] });
}

/**
 * A test wallet reports one of its vaulted slabs missing from Collector Crypt's vault, optionally
 * escrowing a bounty (SlabVault.reportLost, then LostSlabRecovery.setBounty). Withdrawn slabs can't
 * be reported lost any more (their NFT burns at the request), so lost-and-found flows start here.
 */
export async function reportLostInVaultAs(wallet: 1 | 2, tokenId: number, details: string, bountyDollars = 0) {
  const pub = createPublicClient({ chain: hardhat, transport: http() });
  const client = createWalletClient({ chain: hardhat, transport: http(), account: privateKeyToAccount(wallet === 1 ? TEST1_KEY : MISTY_KEY) });
  await pub.waitForTransactionReceipt({
    hash: await client.writeContract({ address: local.SlabVault, abi: slabVaultAbi, functionName: "reportLost", args: [BigInt(tokenId), details] }),
  });
  if (bountyDollars > 0) {
    await pub.waitForTransactionReceipt({
      hash: await client.writeContract({ address: local.LostSlabRecovery, abi: lostSlabRecoveryAbi, functionName: "setBounty", args: [BigInt(tokenId), BigInt(bountyDollars * 1_000_000)] }),
    });
  }
}
