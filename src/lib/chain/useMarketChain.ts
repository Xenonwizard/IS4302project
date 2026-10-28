"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { usePublicClient } from "wagmi";
import { contracts, fromUsdcUnits, toUsdcUnits, IS_DEPLOYED } from "./config";
import { useChainTx } from "./useChainTx";

export interface OnChainListing {
  seller: string;
  price: number;
  listedAt: number;
}

export interface OnChainSaleRecord {
  tokenId: string;
  seller: string;
  buyer: string;
  price: number;
  fee: number;
  settledAt: number;
}

export function useMarketChain() {
  const { send, address } = useChainTx();
  const client = usePublicClient();
  const queryClient = useQueryClient();

  const listCard = useCallback(
    async (tokenId: string, priceDollars: number) => {
      const units = toUsdcUnits(priceDollars);
      const receipt = await send({
        contract: "slabMarket",
        functionName: "list",
        args: [BigInt(tokenId), units],
        label: `List token #${tokenId} for $${priceDollars.toLocaleString()}`,
      });
      await queryClient.invalidateQueries({ queryKey: ["market-listing", tokenId] });
      await queryClient.invalidateQueries({ queryKey: ["owned-slabs", address] });
      await queryClient.invalidateQueries({ queryKey: ["market-active-listings"] });
      return receipt.transactionHash;
    },
    [send, address, queryClient],
  );

  const cancelListing = useCallback(
    async (tokenId: string) => {
      const receipt = await send({
        contract: "slabMarket",
        functionName: "cancelListing",
        args: [BigInt(tokenId)],
        label: `Cancel listing for token #${tokenId}`,
      });
      await queryClient.invalidateQueries({ queryKey: ["market-listing", tokenId] });
      await queryClient.invalidateQueries({ queryKey: ["owned-slabs", address] });
      await queryClient.invalidateQueries({ queryKey: ["market-active-listings"] });
      return receipt.transactionHash;
    },
    [send, address, queryClient],
  );

  const buyCard = useCallback(
    async (tokenId: string, priceDollars: number) => {
      if (!address) throw new Error("Wallet not connected");

      const receipt = await send({
        contract: "slabMarket",
        functionName: "buy",
        args: [BigInt(tokenId)],
        label: `Buy token #${tokenId} for $${priceDollars.toLocaleString()}`,
      });

      await queryClient.invalidateQueries({ queryKey: ["market-listing", tokenId] });
      await queryClient.invalidateQueries({ queryKey: ["owned-slabs", address] });
      await queryClient.invalidateQueries({ queryKey: ["market-sales", tokenId] });
      await queryClient.invalidateQueries({ queryKey: ["market-active-listings"] });
      return receipt.transactionHash;
    },
    [send, address, queryClient],
  );

  const getListing = useCallback(
    async (tokenId: string): Promise<OnChainListing | null> => {
      if (!client) return null;
      try {
        const res = await client.readContract({
          ...contracts.slabMarket,
          functionName: "getListing",
          args: [BigInt(tokenId)],
        });
        if (!res || res.seller === "0x0000000000000000000000000000000000000000") return null;
        return {
          seller: res.seller,
          price: fromUsdcUnits(res.price),
          listedAt: Number(res.listedAt) * 1000,
        };
      } catch {
        return null;
      }
    },
    [client],
  );

  const getSales = useCallback(
    async (tokenId: string): Promise<OnChainSaleRecord[]> => {
      if (!client) return [];
      try {
        const records = await client.readContract({
          ...contracts.slabMarket,
          functionName: "getSalesForToken",
          args: [BigInt(tokenId)],
        });
        return records.map((r) => ({
          tokenId: r.tokenId.toString(),
          seller: r.seller,
          buyer: r.buyer,
          price: fromUsdcUnits(r.price),
          fee: fromUsdcUnits(r.fee),
          settledAt: Number(r.settledAt) * 1000,
        }));
      } catch {
        return [];
      }
    },
    [client],
  );

  return { listCard, cancelListing, buyCard, getListing, getSales };
}

/** Protocol marketplace fee in basis points (e.g. 250 = 2.5%). */
export function useMarketFeeBps() {
  const client = usePublicClient();
  return useQuery({
    queryKey: ["slab-market-fee-bps", client?.chain?.id],
    enabled: Boolean(client && IS_DEPLOYED),
    queryFn: async (): Promise<number> => {
      try {
        const bps = await client!.readContract({
          ...contracts.slabMarket,
          functionName: "feeBps",
        });
        return Number(bps);
      } catch {
        return 0;
      }
    },
    staleTime: 30_000,
  });
}

