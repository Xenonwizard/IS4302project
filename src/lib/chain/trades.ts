"use client";

/**
 * On-chain trades between two collectors (TradeEscrow). Everything here is read from, or sent to,
 * the chain, so both collectors see the same offers from their own browsers.
 *
 *   useTradeSlabs(owner)        an account's Vaulted slabs: Transfer events to it, then ownerOf + slabOf
 *   useTradeOffers(me, other)   offers between two accounts: TradeEscrow.offerIdsOf + offerOf
 *   useEscrowedByMe()           my slabs locked in my open offers (tokenId → offerId), for the Vault
 *   useCollectors()             every active account (AccountOpened events + isActive), to trade with
 *   useTradeActions()           createOffer / accept / decline / withdraw / counter, from the user's wallet
 *   useHandleAddress(handle)    the wallet behind a handle (AccountRegistry.handleOwner), to trade with from a chat
 *   useTradedSlabs()            every slab that changed hands in an accepted trade (OfferAccepted events), for "Sold"
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { keccak256, parseEventLogs, toBytes, zeroAddress, type Address, type TransactionReceipt } from "viem";
import { usePublicClient, useWatchContractEvent } from "wagmi";
import { CUSTODY, DEPLOY_BLOCK, IS_DEPLOYED, OFFER_STATUS, contracts, fromUsdcUnits, toUsdcUnits, type OfferStatusName } from "./config";
import { useChainTx } from "./useChainTx";

export interface TradeSlab {
  tokenId: string;
  title: string;
  image: string;
  grader: string;
  certNumber: string;
  /** listed for sale on SlabMarket (an offer cancels the listing before the slab can move) */
  listed?: boolean;
  /** its asking price on SlabMarket, in dollars, while listed */
  listedPrice?: number;
}

export interface TradeOffer {
  id: string;
  maker: Address;
  taker: Address;
  makerSlabs: string[];
  makerCash: number;
  takerSlabs: string[];
  takerCash: number;
  status: OfferStatusName;
  counterOf: string;
  room: string;
  createdAt: number;
  closedAt: number;
}

/** One room per pair of collectors, whoever opens it: the two addresses, sorted. */
export const roomIdFor = (a: Address, b: Address) => [a.toLowerCase(), b.toLowerCase()].sort().join("-");

/** Protocol fee on cash trade legs in basis points (e.g. 250 = 2.5%). */
export function useTradeFeeBps() {
  const client = usePublicClient();
  return useQuery({
    queryKey: ["trade-fee-bps", client?.chain?.id],
    enabled: Boolean(client && IS_DEPLOYED),
    queryFn: async (): Promise<number> => {
      try {
        const bps = await client!.readContract({
          ...contracts.tradeEscrow,
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

/** Re-reads every trade-related query (offers, slabs, vault, balances). */
export function useTradeRefresh() {
  const queryClient = useQueryClient();
  return useCallback(() => {
    for (const key of ["trade-offers", "trade-slabs", "escrowed-by-me", "owned-slabs"]) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
    // wagmi's useReadContract(s) caches: custody balances
    void queryClient.invalidateQueries({ queryKey: ["readContract"] });
    void queryClient.invalidateQueries({ queryKey: ["readContracts"] });
  }, [queryClient]);
}

/** Refreshes when anything happens in TradeEscrow, so both sides see an offer within seconds. */
export function useTradeEvents(enabled: boolean) {
  const refresh = useTradeRefresh();
  const watch = { ...contracts.tradeEscrow, enabled, onLogs: refresh };
  useWatchContractEvent({ ...watch, eventName: "OfferCreated" });
  useWatchContractEvent({ ...watch, eventName: "OfferAccepted" });
  useWatchContractEvent({ ...watch, eventName: "OfferDeclined" });
  useWatchContractEvent({ ...watch, eventName: "OfferWithdrawn" });
}

export function useTradeSlabs(owner: Address | undefined) {
  const client = usePublicClient();
  return useQuery({
    queryKey: ["trade-slabs", owner],
    enabled: Boolean(client && owner),
    refetchInterval: 10_000,
    queryFn: async (): Promise<TradeSlab[]> => {
      const incoming = await client!.getContractEvents({
        ...contracts.slabVault,
        eventName: "Transfer",
        args: { to: owner },
        fromBlock: DEPLOY_BLOCK,
      });
      const ids = [...new Set(incoming.map((e) => e.args.tokenId!))];
      // ownerOf reverts for a token burned after confirmed delivery; one of those must not empty the list.
      const owners = await Promise.all(ids.map((id) => client!.readContract({ ...contracts.slabVault, functionName: "ownerOf", args: [id] }).catch(() => null)));
      const held = ids.filter((_, i) => owners[i] === owner);
      const [slabs, listed, listings] = await Promise.all([
        Promise.all(held.map((id) => client!.readContract({ ...contracts.slabVault, functionName: "slabOf", args: [id] }))),
        Promise.all(held.map((id) => client!.readContract({ ...contracts.slabVault, functionName: "isListed", args: [id] }).catch(() => false))),
        Promise.all(held.map((id) => client!.readContract({ ...contracts.slabMarket, functionName: "getListing", args: [id] }).catch(() => null))),
      ]);
      return held
        .map((id, i) => ({ id, s: slabs[i], listed: listed[i], listing: listings[i] }))
        .filter(({ s }) => CUSTODY[s.custody] === "Vaulted")
        .map(({ id, s, listed, listing }) => ({
          tokenId: id.toString(),
          title: s.title,
          image: s.image,
          grader: s.grader,
          certNumber: s.certNumber,
          listed,
          listedPrice: listed && listing && listing.price > BigInt(0) ? fromUsdcUnits(listing.price) : undefined,
        }));
    },
  });
}

/** Any token's details, for offers that name slabs no longer held by either side (settled or escrowed). */
export function useSlabDetails(tokenIds: string[]) {
  const client = usePublicClient();
  const key = [...new Set(tokenIds)].sort().join(",");
  return useQuery({
    queryKey: ["slab-details", key],
    enabled: Boolean(client && key),
    staleTime: 60_000,
    queryFn: async (): Promise<Record<string, TradeSlab>> => {
      const ids = key.split(",");
      const slabs = await Promise.all(ids.map((id) => client!.readContract({ ...contracts.slabVault, functionName: "slabOf", args: [BigInt(id)] })));
      return Object.fromEntries(
        ids.map((id, i) => [
          id,
          {
            tokenId: id,
            title: slabs[i].title,
            image: slabs[i].image,
            grader: slabs[i].grader,
            certNumber: slabs[i].certNumber,
          },
        ]),
      );
    },
  });
}

async function readOffers(client: NonNullable<ReturnType<typeof usePublicClient>>, me: Address) {
  const ids = await client.readContract({ ...contracts.tradeEscrow, functionName: "offerIdsOf", args: [me] });
  const unique = [...new Set(ids)];
  const offers = await Promise.all(unique.map((id) => client.readContract({ ...contracts.tradeEscrow, functionName: "offerOf", args: [id] })));
  return offers.map(
    (o, i): TradeOffer => ({
      id: unique[i].toString(),
      maker: o.maker,
      taker: o.taker,
      makerSlabs: o.makerSlabs.map(String),
      makerCash: fromUsdcUnits(o.makerCash),
      takerSlabs: o.takerSlabs.map(String),
      takerCash: fromUsdcUnits(o.takerCash),
      status: OFFER_STATUS[o.status],
      counterOf: o.counterOf.toString(),
      room: o.room,
      createdAt: Number(o.createdAt),
      closedAt: Number(o.closedAt),
    }),
  );
}

/** Every offer I made or received, newest first; with `other`, only those with that collector. */
export function useTradeOffers(me: Address | undefined, other?: Address) {
  const client = usePublicClient();
  return useQuery({
    queryKey: ["trade-offers", me, other],
    enabled: Boolean(client && me),
    refetchInterval: 8000,
    queryFn: async () => {
      const all = await readOffers(client!, me!);
      const lower = other?.toLowerCase();
      return all
        .filter((o) => !lower || o.maker.toLowerCase() === lower || o.taker.toLowerCase() === lower)
        .sort((a, b) => Number(b.id) - Number(a.id));
    },
  });
}

/** My slabs that TradeEscrow holds for my open offers: tokenId → the offer and who it went to. */
export function useEscrowedByMe(me: Address | undefined) {
  const client = usePublicClient();
  return useQuery({
    queryKey: ["escrowed-by-me", me],
    enabled: Boolean(client && me),
    refetchInterval: 8000,
    queryFn: async () => {
      const offers = await readOffers(client!, me!);
      const held: Record<string, { offerId: string; taker: Address; room: string }> = {};
      for (const o of offers) {
        if (o.status === "Open" && o.maker === me) for (const t of o.makerSlabs) held[t] = { offerId: o.id, taker: o.taker, room: o.room };
      }
      return held;
    },
  });
}

/** Every active Pokechain account except `me`, with its handle. */
export function useCollectors(me: Address | undefined) {
  const client = usePublicClient();
  return useQuery({
    queryKey: ["collectors", me],
    enabled: Boolean(client),
    refetchInterval: 15_000,
    queryFn: async () => {
      const opened = await client!.getContractEvents({ ...contracts.accounts, eventName: "AccountOpened", fromBlock: DEPLOY_BLOCK });
      const addrs = [...new Set(opened.map((e) => e.args.account!))].filter((a) => a !== me);
      const records = await Promise.all(addrs.map((a) => client!.readContract({ ...contracts.accounts, functionName: "accountOf", args: [a] })));
      return addrs
        .map((address, i) => ({ address, handle: records[i].handle, active: records[i].status === 1 }))
        .filter((c) => c.active);
    },
  });
}

/** The wallet behind a handle, from AccountRegistry. Undefined until read, or if no one has it. */
export function useHandleAddress(handle: string | undefined) {
  const client = usePublicClient();
  const clean = handle?.trim().toLowerCase().replace(/^@/, "");
  return useQuery({
    queryKey: ["handle-address", clean],
    enabled: Boolean(client && clean),
    staleTime: 60_000,
    queryFn: async (): Promise<Address | null> => {
      const owner = await client!.readContract({ ...contracts.accounts, functionName: "handleOwner", args: [keccak256(toBytes(clean!))] });
      return owner === zeroAddress ? null : owner;
    },
  });
}

export interface TradedSlab {
  offerId: string;
  fromHandle: string;
  toHandle: string;
  /** unix seconds the trade settled */
  at: number;
}

/**
 * The latest accepted trade each slab went through, read from TradeEscrow's OfferAccepted events: the
 * maker's slabs went to the taker and the taker's to the maker. Used to mark a slab as sold.
 */
export function useTradedSlabs() {
  const client = usePublicClient();
  useTradeEvents(true);
  return useQuery({
    queryKey: ["trade-offers", "traded-slabs"],
    enabled: Boolean(client),
    refetchInterval: 10_000,
    queryFn: async (): Promise<Record<string, TradedSlab>> => {
      const logs = await client!.getContractEvents({ ...contracts.tradeEscrow, eventName: "OfferAccepted", fromBlock: DEPLOY_BLOCK });
      const offers = await Promise.all(logs.map((l) => client!.readContract({ ...contracts.tradeEscrow, functionName: "offerOf", args: [l.args.offerId!] })));
      const addrs = [...new Set(offers.flatMap((o) => [o.maker, o.taker]))];
      const records = await Promise.all(addrs.map((a) => client!.readContract({ ...contracts.accounts, functionName: "accountOf", args: [a] })));
      const handle = new Map(addrs.map((a, i) => [a, records[i].handle]));
      const out: Record<string, TradedSlab> = {};
      // Events come oldest first, so a later trade of the same slab overwrites an earlier one.
      logs.forEach((l, i) => {
        const o = offers[i];
        const base = { offerId: l.args.offerId!.toString(), at: Number(o.closedAt) };
        for (const t of o.makerSlabs) out[t.toString()] = { ...base, fromHandle: handle.get(o.maker) ?? "", toHandle: handle.get(o.taker) ?? "" };
        for (const t of o.takerSlabs) out[t.toString()] = { ...base, fromHandle: handle.get(o.taker) ?? "", toHandle: handle.get(o.maker) ?? "" };
      });
      return out;
    },
  });
}

/** The id of the offer a createOffer / counter transaction made, read from its events. */
export function newOfferId(receipt: TransactionReceipt): string | undefined {
  const logs = parseEventLogs({ abi: contracts.tradeEscrow.abi, logs: receipt.logs, eventName: "OfferCreated" });
  // A counter emits OfferCreated for the new offer too, so the last one is the offer just made.
  return logs.at(-1)?.args.offerId?.toString();
}

export interface OfferTerms {
  /** what the sender gives */
  mySlabs: string[];
  myCash: number;
  /** what the sender asks for */
  theirSlabs: string[];
  theirCash: number;
}

const ids = (xs: string[]) => xs.map((x) => BigInt(x));

export function useTradeActions() {
  const { send } = useChainTx();
  const refresh = useTradeRefresh();
  const after = useCallback(
    async <T,>(p: Promise<T>) => {
      const r = await p;
      refresh();
      return r;
    },
    [refresh],
  );

  const create = useCallback(
    (to: Address, handle: string, t: OfferTerms, room: string) =>
      after(
        send({
          contract: "tradeEscrow",
          functionName: "createOffer",
          args: [to, ids(t.mySlabs), toUsdcUnits(t.myCash), ids(t.theirSlabs), toUsdcUnits(t.theirCash), room],
          label: `Offer a trade to @${handle}`,
        }),
      ),
    [send, after],
  );
  const counter = useCallback(
    (offerId: string, t: OfferTerms) =>
      after(
        send({
          contract: "tradeEscrow",
          functionName: "counter",
          args: [BigInt(offerId), ids(t.mySlabs), toUsdcUnits(t.myCash), ids(t.theirSlabs), toUsdcUnits(t.theirCash)],
          label: `Counter offer #${offerId}`,
        }),
      ),
    [send, after],
  );
  const accept = useCallback(
    (offerId: string) => after(send({ contract: "tradeEscrow", functionName: "accept", args: [BigInt(offerId)], label: `Accept trade #${offerId}` })),
    [send, after],
  );
  const decline = useCallback(
    (offerId: string) => after(send({ contract: "tradeEscrow", functionName: "decline", args: [BigInt(offerId)], label: `Decline trade #${offerId}` })),
    [send, after],
  );
  const withdraw = useCallback(
    (offerId: string) => after(send({ contract: "tradeEscrow", functionName: "withdraw", args: [BigInt(offerId)], label: `Withdraw trade #${offerId}` })),
    [send, after],
  );
  return { create, counter, accept, decline, withdraw };
}
