"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { zeroAddress } from "viem";
import { usePublicClient, useWatchContractEvent } from "wagmi";
import { CUSTODY, DEPLOY_BLOCK, chain, contracts, fromUsdcUnits } from "@/lib/chain/config";
import { useOnchainAccount } from "@/lib/chain/useOnchainAccount";
import { useStore, type ChainSlab } from "@/lib/store";
import type { Grader } from "@/lib/types";

/**
 * Keeps the Vault's tokenised slabs in step with the chain. It reads every ERC-721 `Transfer` into
 * this wallet (eth_getLogs, filtered on the indexed `to` topic), keeps the tokens `ownerOf` still
 * says are ours, reads each one's `slabOf`, and queries SlabMarket for active listings.
 */
export function ChainVaultSync() {
  const { user, ready, vault, syncChainSlabs } = useStore();
  const { address } = useOnchainAccount();
  const client = usePublicClient();
  const enabled = Boolean(ready && client && address && user?.address === address);
  const queryClient = useQueryClient();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["owned-slabs", address] });
  useWatchContractEvent({ ...contracts.slabVault, eventName: "Transfer", args: { to: address }, enabled, onLogs: refresh });
  useWatchContractEvent({ ...contracts.slabVault, eventName: "Transfer", args: { from: address }, enabled, onLogs: refresh });
  useWatchContractEvent({ ...contracts.slabMarket, eventName: "CardListed", args: { seller: address }, enabled, onLogs: refresh });
  useWatchContractEvent({ ...contracts.slabMarket, eventName: "ListingCancelled", args: { seller: address }, enabled, onLogs: refresh });
  useWatchContractEvent({ ...contracts.slabMarket, eventName: "CardPurchased", enabled, onLogs: refresh });
  // Tokens the Vault already lists: each gets an explicit ownerOf check.
  const knownIds = vault.flatMap((v) => (v.token ? [v.token.tokenId] : [])).sort().join(",");

  const { data } = useQuery({
    queryKey: ["owned-slabs", address, knownIds],
    enabled,
    refetchInterval: 5000,
    queryFn: async (): Promise<{ owned: ChainSlab[]; ownedByOthers: string[] }> => {
      const vaultCode = await client!.getBytecode({ address: contracts.slabVault.address }).catch(() => null);
      if (!vaultCode || vaultCode === "0x") return { owned: [], ownedByOthers: [] };

      const incoming = await client!.getContractEvents({
        ...contracts.slabVault,
        eventName: "Transfer",
        args: { to: address },
        fromBlock: DEPLOY_BLOCK,
      });
      const firstSeen = new Map<bigint, boolean>(); // tokenId → minted to us (from the zero address)
      for (const e of incoming) {
        const id = e.args.tokenId!;
        if (!firstSeen.has(id)) firstSeen.set(id, e.args.from === zeroAddress);
      }
      const known = knownIds ? knownIds.split(",").map(BigInt) : [];
      const ids = [...new Set([...firstSeen.keys(), ...known])];
      const owners = await Promise.all(ids.map((id) => client!.readContract({ ...contracts.slabVault, functionName: "ownerOf", args: [id] })));
      const mine = ids.filter((_, i) => owners[i] === address);
      const ownedByOthers = ids.filter((_, i) => owners[i] !== address).map(String);
      const [slabs, marketListings] = await Promise.all([
        Promise.all(mine.map((id) => client!.readContract({ ...contracts.slabVault, functionName: "slabOf", args: [id] }))),
        Promise.all(
          mine.map((id) =>
            client!.readContract({ ...contracts.slabMarket, functionName: "getListing", args: [id] }).catch(() => null)
          )
        ),
      ]);
      const owned = mine.map((id, i) => {
        const mListing = marketListings[i];
        const isListedOnChain = Boolean(
          mListing &&
          address &&
          mListing.seller.toLowerCase() === address.toLowerCase() &&
          mListing.price > BigInt(0)
        );
        const listedPrice = isListedOnChain && mListing ? fromUsdcUnits(mListing.price) : undefined;
        return {
          token: {
            chainId: chain.id,
            contract: contracts.slabVault.address,
            tokenId: id.toString(),
            owner: address!,
            mintTx: "",
            custodianRef: slabs[i].custodianRef,
          },
          grader: slabs[i].grader as Grader,
          certNumber: slabs[i].certNumber,
          custody: CUSTODY[slabs[i].custody],
          via: firstSeen.get(id) === false ? ("Transfer" as const) : ("Submission" as const),
          carrier: slabs[i].carrier,
          trackingNumber: slabs[i].trackingNumber,
          redemptionRef: slabs[i].redemptionRef,
          isListed: isListedOnChain,
          listedPrice,
        };
      });
      return { owned, ownedByOthers };
    },
  });

  useEffect(() => {
    if (enabled && data) syncChainSlabs(data.owned, data.ownedByOthers);
  }, [enabled, data, syncChainSlabs]);

  return null;
}
