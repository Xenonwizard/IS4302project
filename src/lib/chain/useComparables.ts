"use client";

import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { type Hash } from "viem";
import { cardFromTokenURI, type CardIdentity } from "../comparables";
import { chain, contracts, DEPLOY_BLOCK, fromUsdcUnits, IS_DEPLOYED } from "./config";

export interface ComparableSlab extends CardIdentity {
  tokenId: string;
  certNumber: string;
}

export interface ComparableListing {
  slab: ComparableSlab;
  seller: string;
  sellerHandle: string;
  price: number;
  at: number;
}

export interface ComparableTransaction {
  id: string;
  kind: "sale" | "trade";
  hash: Hash;
  at: number;
  from: string;
  to: string;
  give: { slabs: ComparableSlab[]; cash: number };
  get: { slabs: ComparableSlab[]; cash: number };
}

/** Public reads: actual current asks and successful settlements, with their original terms. */
export function useComparables() {
  const client = usePublicClient();
  return useQuery({
    queryKey: ["pokechain-comparables", chain.id, contracts.slabVault.address, contracts.slabMarket.address, contracts.tradeEscrow.address],
    enabled: Boolean(client && IS_DEPLOYED),
    refetchInterval: 10_000,
    queryFn: async () => {
      const blockNumber = await client!.getBlockNumber({ cacheTime: 0 });
      const tradeCode = await client!.getBytecode({ address: contracts.tradeEscrow.address, blockNumber });
      const [active, sales, trades] = await Promise.all([
        client!.readContract({ ...contracts.slabMarket, functionName: "getActiveListings", blockNumber }),
        client!.getContractEvents({ ...contracts.slabMarket, eventName: "CardPurchased", fromBlock: DEPLOY_BLOCK, toBlock: blockNumber, strict: true }),
        tradeCode && tradeCode !== "0x"
          ? client!.getContractEvents({ ...contracts.tradeEscrow, eventName: "OfferAccepted", fromBlock: DEPLOY_BLOCK, toBlock: blockNumber, strict: true })
          : Promise.resolve([]),
      ]);
      const offers = await Promise.all(trades.map((e) => client!.readContract({ ...contracts.tradeEscrow, functionName: "offerOf", args: [e.args.offerId], blockNumber })));
      const ids = [...new Set([
        ...sales.map((e) => e.args.tokenId),
        ...offers.flatMap((o) => [...o.makerSlabs, ...o.takerSlabs]),
      ])];
      const metadata = await Promise.all(ids.map(async (id) => cardFromTokenURI(await client!.readContract({ ...contracts.slabVault, functionName: "tokenURI", args: [id], blockNumber }))));
      const slabs = new Map(ids.map((id, i) => [id.toString(), { tokenId: id.toString(), ...metadata[i] }]));
      const listings: ComparableListing[] = active.map((l) => ({
        slab: { tokenId: l.tokenId.toString(), title: l.title, image: l.image, grader: l.grader, certNumber: l.certNumber },
        seller: l.seller, sellerHandle: l.sellerHandle, price: fromUsdcUnits(l.price), at: Number(l.listedAt) * 1000,
      }));
      const transactions: ComparableTransaction[] = [
        ...sales.map((e): ComparableTransaction => ({
          id: `${e.transactionHash}:${e.logIndex}`, kind: "sale", hash: e.transactionHash,
          at: Number(e.args.settledAt) * 1000, from: e.args.seller, to: e.args.buyer,
          give: { slabs: [slabs.get(e.args.tokenId.toString())!], cash: 0 },
          get: { slabs: [], cash: fromUsdcUnits(e.args.price) },
        })),
        ...trades.map((e, i): ComparableTransaction => ({
          id: `${e.transactionHash}:${e.logIndex}`, kind: "trade", hash: e.transactionHash,
          at: Number(offers[i].closedAt) * 1000, from: offers[i].maker, to: offers[i].taker,
          give: { slabs: offers[i].makerSlabs.map((id) => slabs.get(id.toString())!), cash: fromUsdcUnits(offers[i].makerCash) },
          get: { slabs: offers[i].takerSlabs.map((id) => slabs.get(id.toString())!), cash: fromUsdcUnits(offers[i].takerCash) },
        })),
      ];
      return {
        listings: listings.sort((a, b) => b.at - a.at),
        transactions: transactions.sort((a, b) => b.at - a.at),
      };
    },
  });
}
