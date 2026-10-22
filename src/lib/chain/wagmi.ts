"use client";

/**
 * wagmi + RainbowKit setup: which wallets the Connect modal offers and how the app reaches the chain.
 *
 *   MetaMask / browser wallet   the real thing. RainbowKit asks MetaMask to add the
 *                               Pokechain chain the first time.
 *   Hardhat test collectors     local chain only. Hardhat's node keeps its 20 test accounts
 *                               unlocked, so these "wallets" just forward transactions to it
 *                               unsigned and the node signs them. Handy for demoing two users
 *                               without setting up MetaMask twice.
 */
import { connectorsForWallets, type Wallet } from "@rainbow-me/rainbowkit";
import { injectedWallet, metaMaskWallet } from "@rainbow-me/rainbowkit/wallets";
import type { Address } from "viem";
import { createConfig, createConnector, http, mock } from "wagmi";
import { BRAND } from "../brand";
import { IS_LOCAL, chain } from "./config";

/** Hardhat test accounts #1 and #2. #0 is the deployer and vault operator. */
const TEST_COLLECTORS: { index: number; address: Address; hue: number }[] = [
  { index: 1, address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", hue: 200 },
  { index: 2, address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", hue: 320 },
];

function testCollectorWallet({ index, address, hue }: (typeof TEST_COLLECTORS)[number]) {
  const id = `hardhat-${index}`;
  const flag = `pokechain.${id}.connected`;
  const remembered = () => {
    try {
      return window.localStorage.getItem(flag) === "1";
    } catch {
      return false;
    }
  };
  const remember = (on: boolean) => {
    try {
      if (on) window.localStorage.setItem(flag, "1");
      else window.localStorage.removeItem(flag);
    } catch {
      /* storage blocked: the wallet just won't survive a reload */
    }
  };
  const icon = `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" rx="6" fill="hsl(${hue} 70% 45%)"/><text x="14" y="19" text-anchor="middle" font-family="sans-serif" font-size="13" font-weight="700" fill="white">#${index}</text></svg>`,
  )}`;

  return (): Wallet => ({
    id,
    name: `Hardhat test collector #${index}`,
    iconUrl: icon,
    iconBackground: "#000",
    installed: true,
    createConnector: (walletDetails) =>
      createConnector((config) => {
        const base = mock({ accounts: [address], features: { reconnect: true } })(config);
        return {
          ...base,
          ...walletDetails,
          id,
          name: `Hardhat test collector #${index}`,
          connect: (async (params) => {
            const result = await base.connect(params);
            remember(true);
            return result;
          }) as typeof base.connect,
          async disconnect() {
            remember(false);
            await base.disconnect();
          },
          async getAccounts() {
            return [address];
          },
          async isAuthorized() {
            return remembered();
          },
        };
      }),
  });
}

const connectors = connectorsForWallets(
  [
    { groupName: "Your wallet", wallets: [metaMaskWallet, injectedWallet] },
    ...(IS_LOCAL ? [{ groupName: "Local test wallets", wallets: TEST_COLLECTORS.map(testCollectorWallet) }] : []),
  ],
  {
    appName: BRAND.name,
    // Only needed for WalletConnect (phone wallets). MetaMask in the browser works without one.
    projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "pokechain-local-demo",
  },
);

export const wagmiConfig = createConfig({
  chains: [chain],
  connectors,
  transports: { [chain.id]: http() },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
