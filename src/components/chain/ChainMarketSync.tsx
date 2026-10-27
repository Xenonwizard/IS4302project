"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { zeroAddress } from "viem";
import { usePublicClient, useWatchContractEvent } from "wagmi";
import { contracts, DEPLOY_BLOCK, fromUsdcUnits, IS_DEPLOYED, shortHash } from "@/lib/chain/config";
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
          acceptsLoan: boolean;
          loanAsk: bigint;
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
          // Fallback: PSA cert-based token ids are sparse, so discover ids from market events.
          try {
            const events = await client.getContractEvents({
              ...contracts.slabMarket,
              eventName: "CardListed",
              fromBlock: DEPLOY_BLOCK,
            });
            const tokenIds = [...new Set(events.map((event) => event.args.tokenId).filter((id): id is bigint => id !== undefined))];
            if (tokenIds.length > 0) {
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
              const active = tokenIds.flatMap((id, idx) => {
                const l = listings[idx];
                return l && l.seller && l.seller !== zeroAddress && l.price > BigInt(0) ? [{ id, listing: l }] : [];
              });
              if (active.length > 0) {
                const [slabs, accountsList] = await Promise.all([
                  Promise.all(
                    active.map(({ id }) =>
                      client.readContract({
                        ...contracts.slabVault,
                        functionName: "slabOf",
                        args: [id],
                      })
                    )
                  ),
                  Promise.all(
                    active.map(({ listing }) => {
                      return client
                        .readContract({
                          ...contracts.accounts,
                          functionName: "accountOf",
                          args: [listing.seller],
                        })
                        .catch(() => null);
                    })
                  ),
                ]);
                rawListings = active.map(({ id, listing: l }, idx) => {
                  const s = slabs[idx];
                  const acct = accountsList[idx];
                  return {
                    tokenId: id,
                    seller: l.seller,
                    sellerHandle: acct?.handle || "",
                    price: l.price,
                    listedAt: l.listedAt,
                    acceptsLoan: l.acceptsLoan,
                    loanAsk: l.loanAsk,
                    grader: s.grader,
                    certNumber: s.certNumber,
                    title: s.title,
                    image: s.image,
                  };
                });
              }
            }
          } catch (fallbackError) {
            throw fallbackError;
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
            acceptsLoan: item.acceptsLoan,
            loanAsk: fromUsdcUnits(item.loanAsk),
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
        // Keep React Query's last successful snapshot. Treating an RPC failure as an empty market
        // would incorrectly hide every active listing now that an empty successful result is
        // intentionally used to clear the final cancelled listing.
        throw err;
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
