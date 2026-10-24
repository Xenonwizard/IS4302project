"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { zeroAddress } from "viem";
import { usePublicClient, useWatchContractEvent } from "wagmi";
import { contracts, fromUsdcUnits, IS_DEPLOYED, shortHash } from "@/lib/chain/config";
import { buildOnChainListing } from "@/lib/catalog";
import { useStore } from "@/lib/store";
import type { Grader, Listing } from "@/lib/types";

/**
 * Syncs all on-chain active marketplace listings from SlabMarket.
 * Runs for every user (including other accounts and unauthenticated visitors)
 * so that any card listed on-chain immediately appears across the whole platform.
 */
export function ChainMarketSync() {
  const { ready, syncMarketListings } = useStore();
  const client = usePublicClient();
  const enabled = Boolean(ready && client && IS_DEPLOYED);
  const queryClient = useQueryClient();

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["market-active-listings"] });
  };

  useWatchContractEvent({
    ...contracts.slabMarket,
    eventName: "CardListed",
    enabled,
    poll: true,
    pollingInterval: 1000,
    onLogs: refresh,
  });
  useWatchContractEvent({
    ...contracts.slabMarket,
    eventName: "ListingCancelled",
    enabled,
    poll: true,
    pollingInterval: 1000,
    onLogs: refresh,
  });
  useWatchContractEvent({
    ...contracts.slabMarket,
    eventName: "CardPurchased",
    enabled,
    poll: true,
    pollingInterval: 1000,
    onLogs: refresh,
  });

  const { data } = useQuery({
    queryKey: ["market-active-listings"],
    enabled,
    refetchInterval: 2000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      if (!client) return [];
      try {
        const [marketCode, vaultCode] = await Promise.all([
          client.getBytecode({ address: contracts.slabMarket.address }).catch(() => null),
          client.getBytecode({ address: contracts.slabVault.address }).catch(() => null),
        ]);
        if (!marketCode || marketCode === "0x" || !vaultCode || vaultCode === "0x") {
          return [];
        }

        let rawListings: readonly {
          tokenId: bigint;
          seller: `0x${string}`;
          sellerHandle: string;
          price: bigint;
          listedAt: bigint | number;
          grader: string;
          certNumber: string;
          title: string;
          image: string;
        }[] = [];

        try {
          rawListings = await client.readContract({
            ...contracts.slabMarket,
            functionName: "getActiveListings",
          });
        } catch {
          // Fallback to reading nextTokenId and getListing per token
          try {
            const nextId = await client.readContract({
              ...contracts.slabVault,
              functionName: "nextTokenId",
            });
            const maxId = Number(nextId);
            if (maxId > 1) {
              const tokenIds = Array.from({ length: maxId - 1 }, (_, i) => BigInt(i + 1));
              const listings = await Promise.all(
                tokenIds.map((id) =>
                  client
                    .readContract({
                      ...contracts.slabMarket,
                      functionName: "getListing",
                      args: [id],
                    })
                    .catch(() => null)
                )
              );
              const activeTokenIds = tokenIds.filter((_, idx) => {
                const l = listings[idx];
                return Boolean(l && l.seller && l.seller !== zeroAddress && l.price > BigInt(0));
              });
              if (activeTokenIds.length > 0) {
                const [slabs, accountsList] = await Promise.all([
                  Promise.all(
                    activeTokenIds.map((id) =>
                      client.readContract({
                        ...contracts.slabVault,
                        functionName: "slabOf",
                        args: [id],
                      })
                    )
                  ),
                  Promise.all(
                    activeTokenIds.map((id) => {
                      const l = listings[Number(id) - 1];
                      if (!l?.seller) return null;
                      return client
                        .readContract({
                          ...contracts.accounts,
                          functionName: "accountOf",
                          args: [l.seller],
                        })
                        .catch(() => null);
                    })
                  ),
                ]);
                rawListings = activeTokenIds.map((id, idx) => {
                  const l = listings[Number(id) - 1]!;
                  const s = slabs[idx];
                  const acct = accountsList[idx];
                  return {
                    tokenId: id,
                    seller: l.seller,
                    sellerHandle: acct?.handle || "",
                    price: l.price,
                    listedAt: l.listedAt,
                    grader: s.grader,
                    certNumber: s.certNumber,
                    title: s.title,
                    image: s.image,
                  };
                });
              }
            }
          } catch {
            return [];
          }
        }

        const results: { listing: Listing; price: number; seller: string }[] = [];
        for (const item of rawListings) {
          const sellerName = item.sellerHandle || shortHash(item.seller);
          const price = fromUsdcUnits(item.price);
          const nowMs = Number(item.listedAt) * 1000 || Date.now();

          const listing = buildOnChainListing({
            tokenId: item.tokenId.toString(),
            title: item.title,
            image: item.image,
            grader: item.grader as Grader,
            certNumber: item.certNumber,
            price,
            owner: sellerName,
            ownerAddress: item.seller,
            listedAt: new Date(nowMs).toISOString(),
            contract: contracts.slabVault.address,
          });

          results.push({
            listing,
            price,
            seller: sellerName,
          });
        }
        return results;
      } catch (err) {
        console.error("Failed to query active listings from SlabMarket:", err);
        return [];
      }
    },
  });

  useEffect(() => {
    if (enabled && data) {
      syncMarketListings(data);
    }
  }, [enabled, data, syncMarketListings]);

  return null;
}
