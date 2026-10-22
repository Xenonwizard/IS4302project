/**
 * The vault operator: the one key allowed to mint slab tokens and mark them shipped
 * (OPERATOR_ROLE in SlabVault). It lives only on the server, in API routes, because the
 * operator stands for the physical vault: it attests "this slab is on our shelf and its cert
 * checks out" and "we handed it to the carrier". A collector's own wallet can never do that.
 *
 * In production this key would be a Safe multisig or a KMS-held key. Locally it defaults to
 * Hardhat's account #0, the deployer, which Ignition also made the operator.
 */
import "server-only";
import { createPublicClient, createWalletClient, http, parseEther, parseEventLogs, type Address, type Hash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { certPreview, getListing } from "../catalog";
import { releaseFromGrade10, verifyGrade10Custody, type CheckStep } from "../grade10/verify";
import type { Grader } from "../types";
import { CUSTODY, IS_LOCAL, chain, contracts } from "./config";

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

/**
 * Slab onboarding, step 2. Reads the collector's pending submission from Polygon, then:
 *   a. rejects it on-chain if the grader has no such cert (a fake can never reach Grade10)
 *   b. checks Grade10's registry and Grade10's Solana record that the slab is in custody;
 *      if Grade10 hasn't received it yet the submission simply stays Pending
 *   c. mints the Polygon token, storing the Solana asset id as its custodian reference
 * `listingId` is passed when tokenising a slab already in the user's vault, to keep its title and image.
 */
export async function mintSubmission(origin: string, submissionId: bigint, listingId?: string) {
  const sub = await publicClient.readContract({ ...contracts.slabVault, functionName: "submissionOf", args: [submissionId] });
  if (sub.status !== 1) throw new Error(`Submission ${submissionId} is not pending`);

  const wallet = walletClient();
  const known = listingId ? getListing(listingId) : undefined;
  const fromVault = known && known.grader === sub.grader && known.certNumber === sub.certNumber ? known : undefined;
  const card = fromVault ?? certPreview(sub.grader as Grader, sub.certNumber);

  if (!card) {
    const reason = `${sub.grader} has no record of cert ${sub.certNumber}`;
    const hash = await wallet.writeContract({ ...contracts.slabVault, functionName: "rejectSubmission", args: [submissionId, reason] });
    const tx = await receiptOf("SlabVault.rejectSubmission", [submissionId.toString(), reason], hash, wallet.account.address);
    return { result: "rejected" as const, reason, checks: [] as CheckStep[], tx };
  }

  const custody = await verifyGrade10Custody(origin, sub.grader, sub.certNumber);
  if (custody.status !== "verified") {
    return { result: custody.status, checks: custody.checks };
  }

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

const CARRIERS = ["DHL Express", "FedEx", "UPS"];

/**
 * Slab offboarding, step 4: Grade10 releases the slab (its Solana NFT leaves the vault wallet),
 * hands it to a carrier, and the operator records the tracking number on Polygon.
 */
export async function shipSlab(origin: string, tokenId: bigint) {
  const slab = await publicClient.readContract({ ...contracts.slabVault, functionName: "slabOf", args: [tokenId] });
  if (CUSTODY[slab.custody] !== "Redemption requested") {
    throw new Error(`Slab #${tokenId} is ${CUSTODY[slab.custody]}, not awaiting shipment`);
  }
  const carrier = CARRIERS[Number(tokenId % BigInt(CARRIERS.length))];
  const trackingNumber = `PC${tokenId.toString().padStart(4, "0")}${Date.now().toString().slice(-8)}`;
  const wallet = walletClient();
  const hash = await wallet.writeContract({
    ...contracts.slabVault,
    functionName: "markShipped",
    args: [tokenId, carrier, trackingNumber],
  });
  const tx = await receiptOf("SlabVault.markShipped", [tokenId.toString(), carrier, trackingNumber], hash, wallet.account.address);
  const checks = slab.custodianRef ? [await releaseFromGrade10(origin, slab.custodianRef)] : [];
  return { carrier, trackingNumber, checks, tx };
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
