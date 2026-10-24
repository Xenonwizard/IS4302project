"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { zeroAddress } from "viem";
import { usePublicClient, useWatchContractEvent } from "wagmi";
import { CUSTODY, DEPLOY_BLOCK, chain, contracts, fromUsdcUnits } from "@/lib/chain/config";
import { useOnchainAccount } from "@/lib/chain/useOnchainAccount";
import { useStore, type ChainSlab } from "@/lib/store";
import type { Grader } from "@/lib/types";

/**
 * Keeps the Vault's tokenised slabs in step with the chain. It reads every ERC-721 `Transfer` into
 * this wallet (eth_getLogs, filtered on the indexed `to` topic), keeps the tokens `ownerOf` still
 * says are ours, and reads each one's `slabOf` and its SlabMarket listing. A slab another collector sent
 * you appears in your Vault; one you sent away disappears from it. No server involved: ownership is
 * whatever SlabVault says.
 *
 * Two kinds of token are left out or kept on purpose:
 *   - a token minted at submission that Collector Crypt hasn't vaulted yet (no custodianRef): it
 *     lives in the submission tracker until it is Vaulted;
 *   - a slab of yours locked in one of your open trade offers is held by TradeEscrow, but it is
 *     still yours until the other side accepts, so it stays in your Vault (marked "In offer").
 *
 * It also subscribes to SlabVault's `Transfer` events and SlabMarket's listing events for this wallet
 * (useWatchContractEvent, which polls eth_getFilterChanges), so a slab someone sends you, or a
 * listing change, shows up within seconds.
 */
export function ChainVaultSync() {
  const { user, ready, vault, syncChainSlabs } = useStore();
  const { address } = useOnchainAccount();
  const client = usePublicClient();
  const addrLower = address?.toLowerCase();
  const enabled = Boolean(ready && client && address && user?.address?.toLowerCase() === addrLower);
  const queryClient = useQueryClient();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["owned-slabs", addrLower] });
  useWatchContractEvent({ ...contracts.slabVault, eventName: "Transfer", args: { to: address }, enabled, onLogs: refresh });
  useWatchContractEvent({ ...contracts.slabVault, eventName: "Transfer", args: { from: address }, enabled, onLogs: refresh });
  useWatchContractEvent({ ...contracts.slabMarket, eventName: "CardListed", args: { seller: address }, enabled, onLogs: refresh });
  useWatchContractEvent({ ...contracts.slabMarket, eventName: "ListingCancelled", args: { seller: address }, enabled, onLogs: refresh });
  useWatchContractEvent({ ...contracts.slabMarket, eventName: "CardPurchased", enabled, onLogs: refresh });

  // Tokens the Vault already lists: keep ref updated to avoid re-triggering queryKey
  const knownIds = vault.flatMap((v) => (v.token ? [v.token.tokenId] : [])).sort().join(",");
  const knownIdsRef = useRef(knownIds);
  useEffect(() => {
    knownIdsRef.current = knownIds;
  }, [knownIds]);

  const { data } = useQuery({
    queryKey: ["owned-slabs", addrLower],
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
      }).catch(() => []);
      const firstSeen = new Map<bigint, boolean>(); // tokenId → minted to us (from the zero address)
      for (const e of incoming) {
        const id = e.args.tokenId!;
        if (!firstSeen.has(id)) firstSeen.set(id, e.args.from === zeroAddress);
      }
      const known = knownIdsRef.current ? knownIdsRef.current.split(",").map(BigInt) : [];
      const ids = [...new Set([...firstSeen.keys(), ...known])];
      const owners = await Promise.all(
        ids.map((id) => client!.readContract({ ...contracts.slabVault, functionName: "ownerOf", args: [id] }).catch(() => null)),
      );
      // Held by TradeEscrow: still ours if it's in an offer we made.
      const escrowed = await Promise.all(
        ids.map(async (id, i) => {
          if (owners[i] !== contracts.tradeEscrow.address) return false;
          const offerId = await client!.readContract({ ...contracts.tradeEscrow, functionName: "offerHolding", args: [id] });
          const offer = await client!.readContract({ ...contracts.tradeEscrow, functionName: "offerOf", args: [offerId] });
          return offer.maker === address;
        }),
      );
      const isMine = (i: number) => owners[i]?.toLowerCase() === addrLower || escrowed[i];
      const candidates = ids.filter((_, i) => isMine(i));
      const ownedByOthers = ids.filter((_, i) => owners[i] && !isMine(i)).map(String);
      const [read, marketListings] = await Promise.all([
        Promise.all(candidates.map((id) => client!.readContract({ ...contracts.slabVault, functionName: "slabOf", args: [id] }))),
        Promise.all(
          candidates.map((id) =>
            client!.readContract({ ...contracts.slabMarket, functionName: "getListing", args: [id] }).catch(() => null),
          ),
        ),
      ]);
      // Never vaulted yet: shown by the submission tracker instead.
      const keep = candidates.map((_, i) => read[i].custodianRef !== "");
      const owned = candidates.flatMap((id, i) => {
        if (!keep[i]) return [];
        const s = read[i];
        const mListing = marketListings[i];
        const isListedOnChain = Boolean(mListing && mListing.seller.toLowerCase() === addrLower && mListing.price > BigInt(0));
        return [
          {
            token: {
              chainId: chain.id,
              contract: contracts.slabVault.address,
              tokenId: id.toString(),
              owner: address!,
              mintTx: "",
              custodianRef: s.custodianRef,
              declaredValueCents: Number(s.declaredValueCents),
              evidenceHash: s.evidenceHash,
            },
            grader: s.grader as Grader,
            certNumber: s.certNumber,
            custody: CUSTODY[s.custody],
            via: firstSeen.get(id) === false ? ("Transfer" as const) : ("Submission" as const),
            carrier: s.carrier,
            trackingNumber: s.trackingNumber,
            redemptionRef: s.redemptionRef,
            isListed: isListedOnChain,
            listedPrice: isListedOnChain && mListing ? fromUsdcUnits(mListing.price) : undefined,
          },
        ];
      });
      return { owned, ownedByOthers };
    },
  });

  useEffect(() => {
    if (enabled && data) syncChainSlabs(data.owned, data.ownedByOthers);
  }, [enabled, data, syncChainSlabs]);

  return null;
}
