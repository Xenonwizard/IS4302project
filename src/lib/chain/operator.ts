/**
 * The Pokechain operator: the one key allowed to record the slab's physical journey and mint
 * tokens (OPERATOR_ROLE in SlabVault). It lives only on the server, in API routes, because it
 * stands for Pokechain's warehouse and its Collector Crypt account: "we received the parcel",
 * "we forwarded it to CC", "CC's NFT is in our escrow", "CC shipped it to the owner".
 * A collector's own wallet can never say those things.
 *
 * In production this key would be a Safe multisig or a KMS-held key. Locally it defaults to
 * Hardhat's account #0, the deployer, which Ignition also made the operator.
 */
import "server-only";
import {
  BaseError,
  HttpRequestError,
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  parseEther,
  parseEventLogs,
  toBytes,
  type Address,
  type Hash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { certPreview, getListing } from "../catalog";
import { requestShipment, verifyCustody } from "../collectorCrypt/client";
import type { Grader } from "../types";
import { CUSTODY, IS_LOCAL, SUBMISSION_STATUS, chain, contracts } from "./config";

/** Hardhat's well-known test account #0. Public, holds only local test ETH. */
const HARDHAT_ACCOUNT_0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

function operatorKey(): `0x${string}` {
  const key = process.env.OPERATOR_PRIVATE_KEY;
  if (key) return (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`;
  if (IS_LOCAL) return HARDHAT_ACCOUNT_0;
  throw new Error("OPERATOR_PRIVATE_KEY is not set");
}

const rpc = process.env.OPERATOR_RPC_URL ?? chain.rpcUrls.default.http[0];
export const publicClient = createPublicClient({ chain, transport: http(rpc) });

function walletClient() {
  return createWalletClient({ chain, transport: http(rpc), account: privateKeyToAccount(operatorKey()) });
}

/** Error text for the API routes. An unreachable RPC gets a fix instead of viem's raw request dump. */
export function operatorError(e: unknown, fallback: string): string {
  if (e instanceof BaseError && e.walk((x) => x instanceof HttpRequestError)) {
    return IS_LOCAL
      ? `Can't reach the local chain at ${rpc}. Start it with npm run chain.`
      : `Can't reach the chain RPC at ${rpc}.`;
  }
  if (e instanceof BaseError) return e.shortMessage;
  return e instanceof Error ? e.message : fallback;
}

export interface OperatorTx {
  /** e.g. "SlabVault.mintSlab" */
  call: string;
  args: string[];
  hash: Hash;
  blockNumber: string;
  gasUsed: string;
  from: Address;
}

async function receiptOf(call: string, args: string[], hash: Hash, from: Address): Promise<OperatorTx> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${call} reverted`);
  return { call, args, hash, blockNumber: receipt.blockNumber.toString(), gasUsed: receipt.gasUsed.toString(), from };
}

/** Reads a submission and checks it is at the expected stage. */
async function submissionAt(submissionId: bigint, expected: number) {
  const sub = await publicClient.readContract({ ...contracts.slabVault, functionName: "submissionOf", args: [submissionId] });
  if (sub.status !== expected) {
    throw new Error(`Submission ${submissionId} is ${SUBMISSION_STATUS[sub.status]}, not ${SUBMISSION_STATUS[expected]}`);
  }
  return sub;
}

/**
 * Slab onboarding, step 2: the parcel has reached Pokechain's warehouse. Staff check the slab
 * against the grader's registry; a cert that doesn't exist is rejected on-chain right here.
 */
export async function receiveSubmission(submissionId: bigint) {
  const sub = await submissionAt(submissionId, 1);
  const wallet = walletClient();
  if (!certPreview(sub.grader as Grader, sub.certNumber)) {
    const reason = `${sub.grader} has no record of cert ${sub.certNumber}`;
    const hash = await wallet.writeContract({ ...contracts.slabVault, functionName: "rejectSubmission", args: [submissionId, reason] });
    const tx = await receiptOf("SlabVault.rejectSubmission", [submissionId.toString(), reason], hash, wallet.account.address);
    return { result: "rejected" as const, reason, tx };
  }
  const hash = await wallet.writeContract({ ...contracts.slabVault, functionName: "markReceived", args: [submissionId] });
  const tx = await receiptOf("SlabVault.markReceived", [submissionId.toString()], hash, wallet.account.address);
  return { result: "received" as const, tx };
}

/** Slab onboarding, step 3: Pokechain ships the slab on to Collector Crypt and records the tracking number. */
export async function forwardSubmission(submissionId: bigint) {
  await submissionAt(submissionId, 2);
  const carrier = "SingPost Registered";
  const trackingNumber = `RR${Date.now().toString().slice(-9)}SG`;
  const wallet = walletClient();
  const hash = await wallet.writeContract({
    ...contracts.slabVault,
    functionName: "markForwarded",
    args: [submissionId, carrier, trackingNumber],
  });
  const tx = await receiptOf("SlabVault.markForwarded", [submissionId.toString(), carrier, trackingNumber], hash, wallet.account.address);
  return { carrier, trackingNumber, tx };
}

/**
 * Slab onboarding, step 4. Once Collector Crypt has vaulted the slab, checks CC's API and the
 * Solana NFT (DAS getAsset: held by Pokechain's escrow, CC collection, same cert, Vaulted), then
 * mints the Polygon token with CC's asset id. If CC hasn't vaulted it yet, nothing happens.
 * `listingId` is passed when tokenising a slab already in the user's vault, to keep its title and image.
 */
export async function mintSubmission(origin: string, submissionId: bigint, listingId?: string) {
  const sub = await submissionAt(submissionId, 3);
  const known = listingId ? getListing(listingId) : undefined;
  const fromVault = known && known.grader === sub.grader && known.certNumber === sub.certNumber ? known : undefined;
  const card = fromVault ?? certPreview(sub.grader as Grader, sub.certNumber);
  if (!card) throw new Error(`${sub.grader} has no record of cert ${sub.certNumber}`);

  const custody = await verifyCustody(origin, sub.grader, sub.certNumber);
  if (custody.status !== "verified") return { result: custody.status, checks: custody.checks };

  const wallet = walletClient();
  const hash = await wallet.writeContract({
    ...contracts.slabVault,
    functionName: "mintSlab",
    args: [submissionId, card.title, card.image, custody.assetId],
  });
  const tx = await receiptOf(
    "SlabVault.mintSlab",
    [submissionId.toString(), card.title, card.image, custody.assetId],
    hash,
    wallet.account.address,
  );
  const receipt = await publicClient.getTransactionReceipt({ hash });
  const [minted] = parseEventLogs({ abi: contracts.slabVault.abi, logs: receipt.logs, eventName: "SlabMinted" });
  return {
    result: "minted" as const,
    tokenId: minted.args.tokenId.toString(),
    owner: minted.args.owner,
    custodianRef: custody.assetId,
    checks: custody.checks,
    tx,
  };
}

/**
 * Slab offboarding, step 6. The token's owner has called requestRedemption with
 * keccak256(shipTo). The server checks the address it was given hashes to that value (so the
 * slab can only go where the owner signed for), then, as holder of CC's NFT, asks Collector Crypt
 * to ship there, and records CC's redemption id, carrier and tracking number on Polygon.
 */
export async function shipSlab(origin: string, tokenId: bigint, shipTo: string) {
  const slab = await publicClient.readContract({ ...contracts.slabVault, functionName: "slabOf", args: [tokenId] });
  if (CUSTODY[slab.custody] !== "Redemption requested") {
    throw new Error(`Slab #${tokenId} is ${CUSTODY[slab.custody]}, not awaiting shipment`);
  }
  if (keccak256(toBytes(shipTo.trim())) !== slab.shippingHash) {
    throw new Error("That address doesn't match the shippingHash the owner signed on-chain");
  }
  const { redemption: r, check } = await requestShipment(origin, slab.custodianRef, shipTo.trim());
  const wallet = walletClient();
  const hash = await wallet.writeContract({
    ...contracts.slabVault,
    functionName: "markShipped",
    args: [tokenId, r.id, r.carrier, r.trackingNumber],
  });
  const tx = await receiptOf(
    "SlabVault.markShipped",
    [tokenId.toString(), r.id, r.carrier, r.trackingNumber],
    hash,
    wallet.account.address,
  );
  return { redemptionRef: r.id, carrier: r.carrier, trackingNumber: r.trackingNumber, checks: [check], tx };
}

/**
 * Local chain only: tops a new wallet up with 10 test ETH for gas, since a MetaMask account
 * starts empty and the Hardhat chain has no public faucet. On Amoy, use the Polygon faucet.
 */
export async function sendGas(to: Address) {
  if (!IS_LOCAL) throw new Error("The gas faucet only runs on the local chain");
  const balance = await publicClient.getBalance({ address: to });
  if (balance >= parseEther("1")) return { skipped: true as const, balance: balance.toString() };
  const wallet = walletClient();
  const hash = await wallet.sendTransaction({ to, value: parseEther("10") });
  const tx = await receiptOf("eth_sendTransaction (10 ETH gas)", [to], hash, wallet.account.address);
  return { skipped: false as const, tx };
}
