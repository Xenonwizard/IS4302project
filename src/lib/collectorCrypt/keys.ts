/**
 * Collector Crypt's side of the encrypted hand-off (simulated).
 *
 * CC owns an EVM wallet (to publish things on Polygon) and an X25519 key pair (to read what is
 * sent to it). It publishes the public half on-chain with SlabVault.setEncryptionKey; the private
 * half never leaves CC's server. Pokechain then encrypts parcel details to that on-chain key, and
 * only this module can open them.
 *
 * Locally CC's wallet is Hardhat account #9 and its X25519 secret is derived from a fixed demo
 * phrase. Set CC_WALLET_PRIVATE_KEY and CC_ENCRYPTION_SECRET (32-byte hex) to use real ones.
 */
import "server-only";
import { createWalletClient, hexToBytes, http, keccak256, toBytes, zeroHash, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { DEPLOY_BLOCK, IS_LOCAL, chain, contracts } from "../chain/config";
import { publicClient } from "../chain/operator";
import { keyPairFromSecret, open } from "../sealed/envelope";

/** Hardhat's well-known test account #9. Public, holds only local test ETH. */
const HARDHAT_ACCOUNT_9 = "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6";

function walletKey(): Hex {
  const key = process.env.CC_WALLET_PRIVATE_KEY;
  if (key) return (key.startsWith("0x") ? key : `0x${key}`) as Hex;
  if (IS_LOCAL) return HARDHAT_ACCOUNT_9;
  throw new Error("CC_WALLET_PRIVATE_KEY is not set");
}

export const ccAccount = privateKeyToAccount(walletKey());

/** CC's X25519 key pair. The private key is only ever used inside this file. */
const ccKeys = keyPairFromSecret(
  process.env.CC_ENCRYPTION_SECRET
    ? hexToBytes(process.env.CC_ENCRYPTION_SECRET as Hex)
    : hexToBytes(keccak256(toBytes("pokechain-demo:collector-crypt-x25519"))),
);
export const ccPublicKey = ccKeys.publicKey;

/**
 * Makes sure CC's current public key is the one on-chain (SlabVault.setEncryptionKey, sent from
 * CC's own wallet). Returns the transaction if it had to publish.
 */
export async function publishKeyIfNeeded() {
  const onChain = await publicClient.readContract({ ...contracts.slabVault, functionName: "encryptionKey", args: [ccAccount.address] });
  if (onChain.toLowerCase() === ccPublicKey.toLowerCase()) return { published: false as const };
  const wallet = createWalletClient({ chain, transport: http(chain.rpcUrls.default.http[0]), account: ccAccount });
  const hash = await wallet.writeContract({ ...contracts.slabVault, functionName: "setEncryptionKey", args: [ccPublicKey] });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return { published: true as const, hash, blockNumber: receipt.blockNumber.toString(), gasUsed: receipt.gasUsed.toString() };
}

export interface InboxItem {
  submissionId: string;
  owner: string;
  blockNumber: string;
  txHash: string;
  from: string;
  recipientKey: string;
  commitment: string;
  ciphertext: string;
  /** what CC reads after decrypting, or why it couldn't */
  decrypted: Record<string, string> | null;
  error?: string;
}

/**
 * CC's inbox: every SubmissionForwarded event addressed to CC (the `recipient` topic is
 * indexed, so this is one filtered eth_getLogs), each decrypted with CC's private key.
 */
export async function readInbox() {
  const [logs, custodian, onChainKey] = await Promise.all([
    publicClient.getContractEvents({
      ...contracts.slabVault,
      eventName: "SubmissionForwarded",
      args: { recipient: ccAccount.address },
      fromBlock: DEPLOY_BLOCK,
    }),
    publicClient.readContract({ ...contracts.slabVault, functionName: "custodian" }),
    publicClient.readContract({ ...contracts.slabVault, functionName: "encryptionKey", args: [ccAccount.address] }),
  ]);
  const items: InboxItem[] = await Promise.all(
    [...logs].reverse().map(async (l) => {
      const tx = await publicClient.getTransaction({ hash: l.transactionHash });
      const base = {
        submissionId: l.args.submissionId!.toString(),
        owner: l.args.owner!,
        blockNumber: l.blockNumber.toString(),
        txHash: l.transactionHash,
        from: tx.from,
        recipientKey: l.args.recipientKey!,
        commitment: l.args.commitment!,
        ciphertext: l.args.ciphertext!,
      };
      try {
        return { ...base, decrypted: JSON.parse(open(ccKeys.privateKey, l.args.ciphertext!)) as Record<string, string> };
      } catch {
        return { ...base, decrypted: null, error: "Couldn't decrypt: encrypted to a different key (rotated?) or altered" };
      }
    }),
  );
  return {
    collectorCrypt: ccAccount.address,
    isCustodian: custodian.toLowerCase() === ccAccount.address.toLowerCase(),
    publishedKey: onChainKey === zeroHash ? null : onChainKey,
    keyMatches: onChainKey.toLowerCase() === ccPublicKey.toLowerCase(),
    items,
  };
}
