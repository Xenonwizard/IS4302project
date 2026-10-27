"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { WagmiProvider } from "wagmi";
import { ChainBlockSync } from "@/components/chain/ChainBlockSync";
import { ChainLogProvider } from "@/lib/chain/log";
import { wagmiConfig } from "@/lib/chain/wagmi";

/**
 * wagmi (wallet state + typed contract hooks) on top of TanStack Query (caching of chain
 * reads), with RainbowKit drawing the Connect wallet modal.
 */
export function Web3Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={darkTheme({ accentColor: "#2f5bf9", borderRadius: "medium" })} modalSize="compact">
          <ChainBlockSync />
          <ChainLogProvider>{children}</ChainLogProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
