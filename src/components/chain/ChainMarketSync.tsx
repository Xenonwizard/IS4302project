"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { zeroAddress } from "viem";
import { usePublicClient, useWatchContractEvent } from "wagmi";
import { contracts, fromUsdcUnits, IS_DEPLOYED, shortHash } from "@/lib/chain/config";
import { makeSubmittedListing } from "@/lib/catalog";
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

  useWatchContractEvent({ ...contracts.slabMarket, eventName: "CardListed", enabled, onLogs: refresh });
  useWatchContractEvent({ ...contracts.slabMarket, eventName: "ListingCancelled", enabled, onLogs: refresh });
  useWatchContractEvent({ ...contracts.slabMarket, eventName: "CardPurchased", enabled, onLogs: refresh });

  const { data } = useQuery({
    queryKey: ["market-active-listings"],
    enabled,
    refetchInterval: 5000,
    queryFn: async () => {
      if (!client) return [];
      try {
        const nextId = await client.readContract({
          ...contracts.slabVault,
          functionName: "nextTokenId",
        });

        const maxId = Number(nextId);
        if (maxId <= 1) return [];

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

        if (activeTokenIds.length === 0) return [];

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

        const results: { listing: Listing; price: number; seller: string }[] = [];
        for (let i = 0; i < activeTokenIds.length; i++) {
          const tokenId = activeTokenIds[i];
          const l = listings[Number(tokenId) - 1]!;
          const s = slabs[i];
          const acct = accountsList[i];

          const sellerName = acct?.handle || shortHash(l.seller);
          const price = fromUsdcUnits(l.price);

          const made = makeSubmittedListing({
            grader: s.grader as Grader,
            certNumber: s.certNumber,
            owner: sellerName,
            nowMs: Number(l.listedAt) * 1000,
          });

          if (made) {
            results.push({
              listing: {
                ...made,
                price,
                owner: sellerName,
                ownerAddress: l.seller,
                tokenId: tokenId.toString(),
                contract: contracts.slabVault.address,
              },
              price,
              seller: sellerName,
            });
          }
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
