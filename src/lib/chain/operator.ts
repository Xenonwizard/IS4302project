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
  toHex,
  type Address,
  type Hash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { certPreview, getListing } from "../catalog";
import { requestShipment, verifyCustody, type CheckStep } from "../collectorCrypt/client";
import { intake, POKECHAIN_ESCROW } from "../collectorCrypt/store";
import { publishKeyIfNeeded, ccPublicKey } from "../collectorCrypt/keys";
import { loadEvidence } from "../evidence/store";
import { commit, randomSalt, seal } from "../sealed/envelope";
import { getForwardRecord, saveForwardRecord } from "./forwardRecords";
import { getRedemptionAddress, saveRedemptionAddress } from "./redemptionAddresses";
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
  /** e.g. "SlabVault.confirmVaulted" */
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
 * against the grader's registry and against the intake evidence whose hash is on-chain (the
 * stored manifest and photos must still hash to it, and describe the same cert). A slab that
 * fails is rejected on-chain right here.
 */
export async function receiveSubmission(submissionId: bigint) {
  const sub = await submissionAt(submissionId, 1);
  const wallet = walletClient();
  const evidence = loadEvidence(sub.evidenceHash);
  const checks: CheckStep[] = [
    {
      call: `Evidence ${sub.evidenceHash.slice(0, 10)}…`,
      ok: Boolean(evidence?.verified.all),
      detail: !evidence
        ? "No intake evidence stored for this hash"
        : evidence.verified.all
          ? `Manifest and ${evidence.manifest.photos.length} photos match the on-chain hash`
          : "Stored evidence no longer matches the on-chain hash",
    },
  ];
  const problem = !certPreview(sub.grader as Grader, sub.certNumber)
    ? `${sub.grader} has no record of cert ${sub.certNumber}`
    : !evidence?.verified.all
      ? checks[0].detail
      : evidence.manifest.certNumber !== sub.certNumber || evidence.manifest.grader !== sub.grader
        ? "Intake evidence describes a different slab"
        : null;
  if (problem) {
    const reason = problem;
    const hash = await wallet.writeContract({ ...contracts.slabVault, functionName: "rejectSubmission", args: [submissionId, reason] });
    const tx = await receiptOf("SlabVault.rejectSubmission", [submissionId.toString(), reason], hash, wallet.account.address);
    return { result: "rejected" as const, reason, checks, tx };
  }
  const hash = await wallet.writeContract({ ...contracts.slabVault, functionName: "markReceived", args: [submissionId] });
  const tx = await receiptOf("SlabVault.markReceived", [submissionId.toString()], hash, wallet.account.address);
  const received = await publicClient.readContract({ ...contracts.slabVault, functionName: "submissionOf", args: [submissionId] });
  return { result: "received" as const, tokenId: received.tokenId.toString(), checks, tx };
}

/**
 * Slab onboarding, step 3: Pokechain ships the slab on to Collector Crypt and tells CC which
 * parcel to expect, privately:
 *   a. reads CC's public key from the contract (SlabVault.encryptionKey(custodian))
 *   b. encrypts the parcel details to that key (sealed envelope) and commits to them with a
 *      fresh salt: commitment = keccak256(salt ‖ message)
 *   c. markForwarded(id, ciphertext, commitment): only ciphertext and commitment go on-chain
 * The message and salt stay in Pokechain's own records, for a dispute.
 */
export async function forwardSubmission(submissionId: bigint) {
  const sub = await submissionAt(submissionId, 2);
  const checks: CheckStep[] = [];

  // Simulated: Collector Crypt publishes its key the first time it's needed.
  const published = await publishKeyIfNeeded();
  if (published.published) {
    checks.push({
      call: "Collector Crypt → SlabVault.setEncryptionKey",
      ok: true,
      detail: `CC published its X25519 public key ${ccPublicKey.slice(0, 10)}… on-chain (tx ${published.hash.slice(0, 10)}…)`,
    });
  }

  const custodian = await publicClient.readContract({ ...contracts.slabVault, functionName: "custodian" });
  const recipientKey = await publicClient.readContract({ ...contracts.slabVault, functionName: "encryptionKey", args: [custodian] });
  if (/^0x0+$/.test(recipientKey)) throw new Error("Collector Crypt hasn't published an encryption key");

  const carrier = "SingPost Registered";
  const trackingNumber = `RR${Date.now().toString().slice(-9)}SG`;
  const message = JSON.stringify({
    submissionId: submissionId.toString(),
    grader: sub.grader,
    certNumber: sub.certNumber,
    carrier,
    trackingNumber,
    sentAt: new Date().toISOString(),
  });
  const salt = randomSalt();
  const commitment = commit(message, salt);
  const ciphertext = seal(recipientKey, message);
  saveForwardRecord(submissionId.toString(), { message, salt, commitment });
  checks.push({
    call: "Pokechain encrypts the parcel details",
    ok: true,
    detail: `Encrypted to Collector Crypt's on-chain key ${recipientKey.slice(0, 10)}…: ${(ciphertext.length - 2) / 2} bytes of ciphertext, commitment ${commitment.slice(0, 10)}…`,
  });

  const wallet = walletClient();
  const hash = await wallet.writeContract({
    ...contracts.slabVault,
    functionName: "markForwarded",
    args: [submissionId, ciphertext, commitment],
  });
  const tx = await receiptOf(
    "SlabVault.markForwarded",
    [submissionId.toString(), `${ciphertext.slice(0, 18)}… (${(ciphertext.length - 2) / 2} bytes, encrypted)`, commitment],
    hash,
    wallet.account.address,
  );
  return { carrier, trackingNumber, commitment, checks, tx };
}

/**
 * A dispute over what was forwarded: Pokechain reveals the message and salt from its records,
 * and the contract itself (SlabVault.verifyForwardCommitment) says whether they match the
 * commitment made at the time.
 */
export async function disputeForward(submissionId: bigint) {
  const record = getForwardRecord(submissionId.toString());
  if (!record) throw new Error(`Pokechain has no forwarding record for submission ${submissionId}`);
  const verified = await publicClient.readContract({
    ...contracts.slabVault,
    functionName: "verifyForwardCommitment",
    args: [submissionId, toHex(record.message), record.salt],
  });
  return { ...record, details: JSON.parse(record.message) as Record<string, string>, verified };
}

/**
 * Slab onboarding, step 4. Once Collector Crypt has vaulted the slab, checks CC's API and the
 * Solana NFT (DAS getAsset: held by Pokechain's escrow, CC collection, same cert, Vaulted), then
 * confirms the Polygon token (minted when Pokechain received it) as Vaulted with CC's asset id, which
 * unlocks it for trading. If CC hasn't vaulted it yet, nothing happens.
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
    functionName: "confirmVaulted",
    args: [submissionId, card.title, card.image, custody.assetId],
  });
  const tx = await receiptOf(
    "SlabVault.confirmVaulted",
    [submissionId.toString(), card.title, card.image, custody.assetId],
    hash,
    wallet.account.address,
  );
  const receipt = await publicClient.getTransactionReceipt({ hash });
  const [minted] = parseEventLogs({ abi: contracts.slabVault.abi, logs: receipt.logs, eventName: "SlabVaulted" });
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
 * The single operations-page action for the final hand-off: Collector Crypt records and vaults
 * the physical slab, then Pokechain verifies that record and unlocks the already-minted NFT.
 */
export async function vaultSubmission(origin: string, submissionId: bigint, listingId?: string) {
  const sub = await submissionAt(submissionId, 3);
  const result = intake({
    grader: sub.grader as Grader,
    certNumber: sub.certNumber,
    owner: POKECHAIN_ESCROW,
    depositorRef: `pokechain-submission-${submissionId}`,
  });
  if ("error" in result) throw new Error(result.error);
  return mintSubmission(origin, submissionId, listingId);
}

/**
 * Slab offboarding, step 6. The token's owner has called requestRedemption with
 * keccak256(shipTo). The server checks the address it was given hashes to that value (so the
 * slab can only go where the owner signed for), then, as holder of CC's NFT, asks Collector Crypt
 * to ship there, and records CC's redemption id, carrier and tracking number on Polygon.
 */
/**
 * The owner hands Pokechain the plaintext delivery address after signing requestRedemption. It is
 * kept only if it hashes to the shippingHash on-chain, so nobody else can plant a different one.
 */
export async function saveSignedAddress(tokenId: bigint, shipTo: string) {
  const slab = await publicClient.readContract({ ...contracts.slabVault, functionName: "slabOf", args: [tokenId] });
  if (CUSTODY[slab.custody] !== "Redemption requested") {
    throw new Error(`Slab #${tokenId} is ${CUSTODY[slab.custody]}, not awaiting shipment`);
  }
  if (keccak256(toBytes(shipTo.trim())) !== slab.shippingHash) {
    throw new Error("That address doesn't match the shippingHash the owner signed on-chain");
  }
  saveRedemptionAddress(tokenId.toString(), shipTo.trim());
}

/** The delivery address the owner gave Pokechain for this redemption, if any. */
export function signedAddressFor(tokenId: bigint) {
  return getRedemptionAddress(tokenId.toString());
}

/** shipTo defaults to the address the owner gave Pokechain when withdrawing. */
export async function shipSlab(origin: string, tokenId: bigint, shipTo = getRedemptionAddress(tokenId.toString()) ?? "") {
  if (!shipTo.trim()) throw new Error("No delivery address: the owner hasn't given Pokechain one, so send shipTo");
  const slab = await publicClient.readContract({ ...contracts.slabVault, functionName: "slabOf", args: [tokenId] });
  if (CUSTODY[slab.custody] !== "Redemption requested") {
    throw new Error(`Slab #${tokenId} is ${CUSTODY[slab.custody]}, not awaiting shipment`);
  }
  const latestOwner = await publicClient.readContract({ ...contracts.slabVault, functionName: "ownerOf", args: [tokenId] });
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
  return { owner: latestOwner, redemptionRef: r.id, carrier: r.carrier, trackingNumber: r.trackingNumber, checks: [check], tx };
}

/** Resolve the numeric PSA cert number used as a submission id to its minted SlabVault token. */
export async function tokenForPsaCert(certNumber: string): Promise<bigint> {
  const submission = await publicClient.readContract({
    ...contracts.slabVault,
    functionName: "submissionOf",
    args: [BigInt(certNumber)],
  });
  if (submission.certNumber !== certNumber || submission.tokenId === BigInt(0)) {
    throw new Error(`PSA cert ${certNumber} does not have a minted SlabVault token`);
  }
  return submission.tokenId;
}

/** What the operator found after a lost report, and the custody it records. */
export const LOST_OUTCOMES = { "at-pokechain": 7, vaulted: 1 } as const;
export type LostOutcome = keyof typeof LOST_OUTCOMES;

/**
 * Closes a lost report (SlabVault.resolveLostReport). "at-pokechain": an inbound parcel turned up
 * at the warehouse and onboarding carries on; "vaulted": it went back into Collector Crypt's vault.
 * A return to the owner must use shipRecoveredSlab followed by the owner's confirmDelivery.
 */
export async function resolveLost(tokenId: bigint, outcome: LostOutcome) {
  const slab = await publicClient.readContract({ ...contracts.slabVault, functionName: "slabOf", args: [tokenId] });
  if (CUSTODY[slab.custody] !== "Lost") throw new Error(`Slab #${tokenId} is ${CUSTODY[slab.custody]}, not reported lost`);
  const inbound = slab.custodianRef === "";
  if (inbound !== (outcome === "at-pokechain")) {
    throw new Error(inbound ? "This parcel was on its way in: it can only turn up at Pokechain" : "This slab had already been vaulted");
  }
  const wallet = walletClient();
  const hash = await wallet.writeContract({
    ...contracts.slabVault,
    functionName: "resolveLostReport",
    args: [tokenId, LOST_OUTCOMES[outcome]],
  });
  const tx = await receiptOf("SlabVault.resolveLostReport", [tokenId.toString(), CUSTODY[LOST_OUTCOMES[outcome]]], hash, wallet.account.address);
  return { custody: CUSTODY[LOST_OUTCOMES[outcome]], tx };
}

/** Pokechain/CC verified a found slab and put it on the return leg to its latest owner. */
export async function shipRecoveredSlab(tokenId: bigint, carrier: string, trackingNumber: string) {
  const slab = await publicClient.readContract({ ...contracts.slabVault, functionName: "slabOf", args: [tokenId] });
  if (CUSTODY[slab.custody] !== "Lost") throw new Error(`Slab #${tokenId} is ${CUSTODY[slab.custody]}, not reported lost`);
  if (!carrier.trim() || !trackingNumber.trim()) throw new Error("Carrier and tracking number are required");
  const wallet = walletClient();
  const hash = await wallet.writeContract({
    ...contracts.slabVault,
    functionName: "markRecoveredShipped",
    args: [tokenId, carrier.trim(), trackingNumber.trim()],
  });
  const tx = await receiptOf(
    "SlabVault.markRecoveredShipped",
    [tokenId.toString(), carrier.trim(), trackingNumber.trim()],
    hash,
    wallet.account.address,
  );
  return { custody: "Shipped", carrier: carrier.trim(), trackingNumber: trackingNumber.trim(), tx };
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
