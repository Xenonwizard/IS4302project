/**
 * Which chain the app talks to, and where the three Pokechain contracts live on it.
 * Shared by the browser (wagmi) and the server (the vault operator), so both always point
 * at the same deployment.
 *
 *   NEXT_PUBLIC_CHAIN=local   Hardhat node on http://127.0.0.1:8545, chain id 31337 (default)
 *   NEXT_PUBLIC_CHAIN=amoy    Polygon Amoy testnet, chain id 80002
 */
import { defineChain, formatUnits, parseUnits, type Address, type Chain, type Hash } from "viem";
import { hardhat, polygonAmoy } from "viem/chains";
import { accountRegistryAbi, deployments, mockUSDCAbi, slabVaultAbi } from "./generated";

export const CHAIN_KEY = process.env.NEXT_PUBLIC_CHAIN === "amoy" ? "amoy" : "local";
export const IS_LOCAL = CHAIN_KEY === "local";

const rpcOverride = process.env.NEXT_PUBLIC_RPC_URL;

export const chain: Chain = defineChain({
  ...(IS_LOCAL ? hardhat : polygonAmoy),
  ...(IS_LOCAL ? { name: "Pokechain local (Hardhat)" } : {}),
  ...(rpcOverride ? { rpcUrls: { default: { http: [rpcOverride] } } } : {}),
});

type Deployment = { MockUSDC: Address; AccountRegistry: Address; SlabVault: Address; fromBlock: number };
const deployment = (deployments as Record<string, Deployment>)[String(chain.id)];

/** False until `npm run deploy:local` (or deploy:amoy) has exported addresses for this chain. */
export const IS_DEPLOYED = Boolean(deployment);

const ZERO = "0x0000000000000000000000000000000000000000" as Address;

/** The three contracts, as `{ address, abi }` pairs that viem and wagmi take directly. */
export const contracts = {
  usdc: { address: deployment?.MockUSDC ?? ZERO, abi: mockUSDCAbi },
  accounts: { address: deployment?.AccountRegistry ?? ZERO, abi: accountRegistryAbi },
  slabVault: { address: deployment?.SlabVault ?? ZERO, abi: slabVaultAbi },
} as const;

export type ContractName = keyof typeof contracts;

export const CONTRACT_LABEL: Record<ContractName, string> = {
  usdc: "MockUSDC",
  accounts: "AccountRegistry",
  slabVault: "SlabVault",
};

/** Block the contracts were deployed at: event queries start here instead of at genesis. */
export const DEPLOY_BLOCK = BigInt(deployment?.fromBlock ?? 0);

/* ---------------- USDC has 6 decimals ---------------- */

export const USDC_DECIMALS = 6;
export const toUsdcUnits = (dollars: number) => parseUnits(dollars.toFixed(USDC_DECIMALS), USDC_DECIMALS);
export const fromUsdcUnits = (units: bigint) => Number(formatUnits(units, USDC_DECIMALS));

/* ---------------- on-chain enums, in Solidity declaration order ---------------- */

export const ACCOUNT_STATUS = ["None", "Active", "Closed"] as const;
export const CUSTODY = ["None", "Vaulted", "Redemption requested", "Shipped", "Delivered", "Lost"] as const;
export const SUBMISSION_STATUS = ["None", "Pending", "Received by Pokechain", "At Collector Crypt", "Minted", "Rejected"] as const;
export type SubmissionStatusName = (typeof SUBMISSION_STATUS)[number];
/** submission stages that are still in flight (not minted or rejected) */
export const OPEN_SUBMISSION = new Set([1, 2, 3]);
export type CustodyName = (typeof CUSTODY)[number];

/* ---------------- explorer links ---------------- */

/** Polygonscan link on Amoy. A local Hardhat chain has no explorer, so there is no link. */
export function explorerTx(hash: Hash): string | null {
  return IS_LOCAL ? null : `${polygonAmoy.blockExplorers.default.url}/tx/${hash}`;
}

export function explorerAddress(address: Address): string | null {
  return IS_LOCAL ? null : `${polygonAmoy.blockExplorers.default.url}/address/${address}`;
}

export const shortHash = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;
