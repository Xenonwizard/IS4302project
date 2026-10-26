"use client";

/**
 * The one path every blockchain write in the app goes through.
 *
 *  send()      a transaction signed by the user's wallet:
 *              1. simulateContract   dry-run against the current chain state (eth_call), so a
 *                                    revert is caught with its custom error before the
 *                                    wallet pops up and before any gas is spent
 *              2. writeContract      the wallet signs and broadcasts (eth_sendTransaction)
 *              3. waitForReceipt     wait until it's mined; the receipt holds block, gas, logs
 *  sign()      an off-chain EIP-712 signature (no gas, nothing broadcast)
 *  operator()  asks a server API route to send a transaction with the vault operator key
 *              (after it has checked Collector Crypt's API and Solana record where relevant)
 *
 * Each step is recorded in the Chain log.
 */
import { useCallback } from "react";
import {
  BaseError,
  ContractFunctionRevertedError,
  UserRejectedRequestError,
  decodeErrorResult,
  type ContractFunctionArgs,
  type ContractFunctionName,
  type TransactionReceipt,
} from "viem";
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { CONTRACT_LABEL, chain, contracts, type ContractName } from "./config";
import { useChainLog } from "./log";
import type { CheckStep } from "../collectorCrypt/client";
import type { OperatorTx } from "./operator";

type AbiOf<C extends ContractName> = (typeof contracts)[C]["abi"];
type WriteName<C extends ContractName> = ContractFunctionName<AbiOf<C>, "nonpayable">;

export interface TxRequest<C extends ContractName, F extends WriteName<C>> {
  contract: C;
  functionName: F;
  args: ContractFunctionArgs<AbiOf<C>, "nonpayable", F>;
  /** what the user is doing, shown in the log, e.g. "Open account" */
  label: string;
}

/** Friendly text for the contracts' custom errors. */
const ERROR_TEXT: Record<string, string> = {
  InvalidHandle: "Handles are 3 to 20 characters of a-z, 0-9 or _.",
  HandleTaken: "That handle is already taken on-chain.",
  AlreadyActive: "This wallet already has an active account.",
  NotActive: "This wallet has no active Pokechain account.",
  InsufficientBalance: "Not enough PokeCredits in your Pokechain account.",
  SlabsStillVaulted: "Withdraw or transfer every vaulted slab before closing the account.",
  AccountNotActive: "That wallet has no active Pokechain account.",
  CertAlreadyTokenised: "That cert is already tokenised.",
  NotSlabOwner: "Only the slab's owner can do that.",
  WrongCustody: "The slab isn't in the right custody state for that.",
  SlabLocked: "The slab is locked because it has left the vault.",
  SelfTransfer: "You can't transfer a slab to yourself.",
  FaucetLimit: "The faucet mints at most 100,000 PokeCredits at a time.",
  ERC20InsufficientBalance: "Your wallet doesn't hold enough PokeCredits.",
  SlabIsListed: "That slab is listed for sale on the marketplace, so it can't move until the listing is cancelled.",
  NotListed: "This slab is not listed on the marketplace.",
  AlreadyListed: "This slab is already listed for sale.",
  SelfPurchase: "You cannot purchase your own listed slab.",
  TokenRestricted: "This slab has an active restriction and cannot be listed.",
  NotVaulted: "Only slabs with confirmed vault custody can be traded.",
  NotSeller: "Only the seller can cancel this listing.",
  InvalidPrice: "Listing price must be greater than zero.",
  InvalidLoanAsk: "The minimum loan must be above zero and below the sale price.",
  ERC20InsufficientAllowance: "The PokeCredits allowance is too low.",
  OffersStillOpen: "Withdraw your open trade offers before closing the account.",
  SelfTrade: "You can't trade with yourself.",
  EmptySide: "Each side of a trade needs at least one slab or some cash.",
  TooManySlabs: "At most 10 slabs on each side of a trade.",
  DuplicateSlab: "The same slab is in the offer twice.",
  NotYourSlab: "One of those slabs isn't owned by that collector any more (it may be in another offer).",
  SlabNotVaulted: "One of those slabs isn't in the vault (pending, withdrawn or lost), so it can't be traded.",
  NotEnoughCash: "Not enough PokeCredits in the Pokechain account for that offer.",
  OfferNotOpen: "That offer is no longer open.",
  NotTaker: "Only the collector the offer was made to can do that.",
  NotMaker: "Only the collector who made the offer can withdraw it.",
  LoanNotAccepted: "This seller is not accepting loans on the slab.",
  PrincipalBelowAsk: "The loan amount is below the seller's minimum.",
  PrincipalMustBeBelowPrice: "The loan amount must be below the listed sale price.",
  InvalidDuration: "Choose a repayment period from 1 to 365 days.",
  SelfLoan: "You cannot make a loan offer on your own slab.",
  LoanNotActive: "This loan is no longer active.",
  NotBorrower: "Only the borrower can do that.",
  NotLender: "Only the lender can do that.",
  DeadlinePassed: "The repayment deadline has passed.",
  DeadlineNotPassed: "The lender can claim the collateral only after the deadline.",
  TokenAlreadyCollateral: "This slab already secures an active loan.",
  LoansStillOpen: "Settle or withdraw every loan before closing the account.",
};

function errorNameFromAnyAbi(raw: `0x${string}` | undefined): string | undefined {
  if (!raw) return undefined;
  for (const c of Object.values(contracts)) {
    try {
      return decodeErrorResult({ abi: c.abi, data: raw }).errorName;
    } catch {
      /* not this contract's error */
    }
  }
  return undefined;
}

export function describeError(e: unknown): string {
  if (e instanceof BaseError) {
    if (e.walk((x) => x instanceof UserRejectedRequestError)) return "You rejected the request in your wallet.";
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      // A contract that calls another (TradeEscrow → SlabVault) bubbles up an error the called ABI doesn't
      // list, so look its selector up in every contract's ABI.
      const name = revert.data?.errorName ?? errorNameFromAnyAbi(revert.raw);
      if (name) return ERROR_TEXT[name] ?? `Reverted with ${name}`;
      return revert.reason ?? revert.shortMessage;
    }
    return e.shortMessage;
  }
  return e instanceof Error ? e.message : String(e);
}

const show = (v: unknown): string =>
  typeof v === "bigint" ? v.toString() : typeof v === "string" ? v : JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x));

export function useChainTx() {
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const log = useChainLog();

  const ensureChain = useCallback(async () => {
    if (chainId !== chain.id) await switchChainAsync({ chainId: chain.id });
  }, [chainId, switchChainAsync]);

  const send = useCallback(
    async <C extends ContractName, F extends WriteName<C>>(req: TxRequest<C, F>): Promise<TransactionReceipt> => {
      if (!address || !publicClient) throw new Error("Connect a wallet first.");
      const call = `${CONTRACT_LABEL[req.contract]}.${String(req.functionName)}`;
      const args = (req.args as readonly unknown[]).map(show);
      const id = log.add({ kind: "tx", label: req.label, call, args, from: address, status: "pending" });
      try {
        await ensureChain();
        // viem infers the exact argument types from the ABI generic above; the spread loses them.
        const params = { ...contracts[req.contract], functionName: req.functionName, args: req.args, account: address } as never;
        await publicClient.simulateContract(params);
        const hash = await writeContractAsync(params);
        log.update(id, { hash });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        log.update(id, {
          status: receipt.status === "success" ? "success" : "failed",
          blockNumber: receipt.blockNumber.toString(),
          gasUsed: receipt.gasUsed.toString(),
        });
        if (receipt.status !== "success") throw new Error(`${call} reverted`);
        return receipt;
      } catch (e) {
        const error = describeError(e);
        log.update(id, { status: "failed", error });
        throw new Error(error);
      }
    },
    [address, publicClient, ensureChain, writeContractAsync, log],
  );

  /** Records an off-chain signature (e.g. an EIP-2612 permit) produced by `produce`. */
  const sign = useCallback(
    async <T>(label: string, call: string, args: string[], produce: () => Promise<T>): Promise<T> => {
      const id = log.add({ kind: "signature", label, call, args, from: address, status: "pending" });
      try {
        await ensureChain();
        const result = await produce();
        log.update(id, { status: "success" });
        return result;
      } catch (e) {
        const error = describeError(e);
        log.update(id, { status: "failed", error });
        throw new Error(error);
      }
    },
    [address, ensureChain, log],
  );

  /** Calls one of the /api/chain operator routes and logs the server's transaction. */
  const operator = useCallback(
    async <T extends { tx?: OperatorTx; checks?: CheckStep[] }>(label: string, path: string, body: unknown): Promise<T> => {
      const id = log.add({ kind: "operator", label, call: `POST ${path}`, args: [show(body)], status: "pending" });
      const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json()) as T & { error?: string };
      if (!res.ok || data.error) {
        log.update(id, { status: "failed", error: data.error ?? `HTTP ${res.status}` });
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      // The operator's off-chain calls (Collector Crypt API, Solana getAsset) get their own lines.
      for (const c of data.checks ?? []) {
        log.add({ kind: "check", label, call: c.call, args: [c.detail], status: c.ok ? "success" : "failed" });
      }
      const tx = data.tx;
      log.update(id, {
        status: "success",
        ...(tx ? { call: tx.call, args: tx.args, hash: tx.hash, from: tx.from, blockNumber: tx.blockNumber, gasUsed: tx.gasUsed } : {}),
      });
      return data;
    },
    [log],
  );

  return { send, sign, operator, address, ensureChain };
}
