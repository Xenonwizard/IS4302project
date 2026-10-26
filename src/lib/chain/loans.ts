"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { parseEventLogs, zeroAddress, type Address, type TransactionReceipt } from "viem";
import { usePublicClient, useWatchContractEvent } from "wagmi";
import { contracts, fromUsdcUnits, LOAN_STATUS, toUsdcUnits, type LoanStatusName } from "./config";
import { useChainTx } from "./useChainTx";

export interface LoanOffer {
  id: string;
  lender: Address;
  borrower: Address;
  tokenId: string;
  principal: number;
  interest: number;
  duration: number;
  deadline: number;
  status: LoanStatusName;
  room: string;
  createdAt: number;
  acceptedAt: number;
  closedAt: number;
}

export function newLoanOfferId(receipt: TransactionReceipt): string | undefined {
  const logs = parseEventLogs({ abi: contracts.loanEscrow.abi, logs: receipt.logs, eventName: "LoanOffered" });
  return logs.at(-1)?.args.offerId?.toString();
}

export function useLoanRefresh() {
  const queryClient = useQueryClient();
  return useCallback(() => {
    for (const key of ["loan-offers", "loan-listing", "market-listing", "token-market-listing", "market-active-listings", "owned-slabs"]) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
    void queryClient.invalidateQueries({ queryKey: ["readContract"] });
    void queryClient.invalidateQueries({ queryKey: ["readContracts"] });
  }, [queryClient]);
}

export function useLoanEvents(enabled: boolean) {
  const refresh = useLoanRefresh();
  const watch = { ...contracts.loanEscrow, enabled, onLogs: refresh, poll: true, pollingInterval: 1000 } as const;
  useWatchContractEvent({ ...watch, eventName: "LoanOffered" });
  useWatchContractEvent({ ...watch, eventName: "LoanAccepted" });
  useWatchContractEvent({ ...watch, eventName: "LoanRepaid" });
  useWatchContractEvent({ ...watch, eventName: "LoanDefaulted" });
  useWatchContractEvent({ ...watch, eventName: "LoanDeclined" });
  useWatchContractEvent({ ...watch, eventName: "LoanWithdrawn" });
}

export function useLoanListing(tokenId?: string) {
  const client = usePublicClient();
  return useQuery({
    queryKey: ["loan-listing", tokenId],
    enabled: Boolean(client && tokenId),
    refetchInterval: 5000,
    queryFn: async () => {
      const listing = await client!.readContract({
        ...contracts.slabMarket,
        functionName: "getListing",
        args: [BigInt(tokenId!)],
      });
      if (listing.seller === zeroAddress) return null;
      return {
        seller: listing.seller,
        price: fromUsdcUnits(listing.price),
        acceptsLoan: listing.acceptsLoan,
        loanAsk: fromUsdcUnits(listing.loanAsk),
      };
    },
  });
}

export function useLoanOffers(me?: Address, other?: Address, tokenId?: string) {
  const client = usePublicClient();
  return useQuery({
    queryKey: ["loan-offers", me, other, tokenId],
    enabled: Boolean(client && me),
    refetchInterval: 5000,
    queryFn: async (): Promise<LoanOffer[]> => {
      const ids = await client!.readContract({ ...contracts.loanEscrow, functionName: "offerIdsOf", args: [me!] });
      const unique = [...new Set(ids)];
      const raw = await Promise.all(unique.map((id) => client!.readContract({ ...contracts.loanEscrow, functionName: "offerOf", args: [id] })));
      const otherLower = other?.toLowerCase();
      return raw
        .map((offer, index): LoanOffer => ({
          id: unique[index].toString(),
          lender: offer.lender,
          borrower: offer.borrower,
          tokenId: offer.tokenId.toString(),
          principal: fromUsdcUnits(offer.principal),
          interest: fromUsdcUnits(offer.interest),
          duration: Number(offer.duration),
          deadline: Number(offer.deadline),
          status: LOAN_STATUS[offer.status],
          room: offer.room,
          createdAt: Number(offer.createdAt),
          acceptedAt: Number(offer.acceptedAt),
          closedAt: Number(offer.closedAt),
        }))
        .filter((offer) => !tokenId || offer.tokenId === tokenId)
        .filter((offer) => !otherLower || offer.lender.toLowerCase() === otherLower || offer.borrower.toLowerCase() === otherLower)
        .sort((a, b) => b.createdAt - a.createdAt);
    },
  });
}

export function useLoanActions() {
  const { send } = useChainTx();
  const refresh = useLoanRefresh();

  const finish = async (promise: ReturnType<typeof send>) => {
    const receipt = await promise;
    refresh();
    return receipt;
  };

  return {
    create: (tokenId: string, principal: number, interest: number, days: number, room: string) =>
      finish(send({
        contract: "loanEscrow",
        functionName: "createOffer",
        args: [BigInt(tokenId), toUsdcUnits(principal), toUsdcUnits(interest), BigInt(Math.round(days * 86400)), room],
        label: `Offer a $${principal.toLocaleString()} loan on token #${tokenId}`,
      })),
    accept: (id: string) => finish(send({ contract: "loanEscrow", functionName: "accept", args: [BigInt(id)], label: `Accept loan offer #${id}` })),
    decline: (id: string) => finish(send({ contract: "loanEscrow", functionName: "decline", args: [BigInt(id)], label: `Decline loan offer #${id}` })),
    withdraw: (id: string) => finish(send({ contract: "loanEscrow", functionName: "withdraw", args: [BigInt(id)], label: `Withdraw loan offer #${id}` })),
    repay: (id: string) => finish(send({ contract: "loanEscrow", functionName: "repay", args: [BigInt(id)], label: `Repay loan #${id}` })),
    claimDefault: (id: string) => finish(send({ contract: "loanEscrow", functionName: "claimDefault", args: [BigInt(id)], label: `Claim collateral for loan #${id}` })),
  };
}
