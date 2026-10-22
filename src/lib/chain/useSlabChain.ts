"use client";

/**
 * Every slab action, on SlabVault and through the operator routes around it.
 *
 *  Inbound (collector → Pokechain → Collector Crypt → token)
 *   submit()          SlabVault.requestSubmission                     collector's wallet
 *   receive()         SlabVault.markReceived                          operator (Pokechain warehouse)
 *   forward()         SlabVault.markForwarded                         operator (ships to CC)
 *   simulateVault()   Collector Crypt intake: mints CC's NFT to Pokechain's escrow (= the Postman call)
 *   verifyAndMint()   CC API + Solana getAsset, then SlabVault.mintSlab   operator
 *
 *  Trading (this round: a direct transfer; paid offers come with TradeEscrow)
 *   transfer()        SlabVault.safeTransferFrom(me, to, tokenId)     collector's wallet
 *
 *  Outbound (owner → Collector Crypt ships to them)
 *   redeem()          SlabVault.requestRedemption, then the operator asks CC to ship and
 *                     records it with SlabVault.markShipped
 *   confirmDelivery() SlabVault.confirmDelivery                       collector's wallet
 *   reportLost()      SlabVault.reportLost                            collector's wallet
 */
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { keccak256, parseEventLogs, toBytes, type Address } from "viem";
import type { CheckStep } from "../collectorCrypt/client";
import type { Grader } from "../types";
import { contracts } from "./config";
import { useChainLog } from "./log";
import type { OperatorTx } from "./operator";
import { useChainTx } from "./useChainTx";

export type MintOutcome =
  | { result: "minted"; tokenId: string; owner: string; custodianRef: string; tx: OperatorTx; checks: CheckStep[] }
  | { result: "awaiting_custodian" | "mismatch"; checks: CheckStep[] };

export function useSlabChain() {
  const { send, operator, address } = useChainTx();
  const log = useChainLog();
  const queryClient = useQueryClient();

  const submit = useCallback(
    async (grader: Grader, certNumber: string) => {
      const receipt = await send({
        contract: "slabVault",
        functionName: "requestSubmission",
        args: [grader, certNumber],
        label: "Submit slab",
      });
      const [event] = parseEventLogs({ abi: contracts.slabVault.abi, logs: receipt.logs, eventName: "SubmissionRequested" });
      // Show the new submission's tracker straight away rather than on the next poll.
      await queryClient.invalidateQueries({ queryKey: ["pending-submissions"] });
      return event.args.submissionId.toString();
    },
    [send, queryClient],
  );

  const receive = useCallback(
    (submissionId: string) =>
      operator<{ result: "received" | "rejected"; reason?: string; tx: OperatorTx }>(
        "Pokechain receives the slab",
        "/api/chain/receive",
        { submissionId },
      ),
    [operator],
  );

  const forward = useCallback(
    (submissionId: string) =>
      operator<{ carrier: string; trackingNumber: string; tx: OperatorTx }>(
        "Pokechain forwards it to Collector Crypt",
        "/api/chain/forward",
        { submissionId },
      ),
    [operator],
  );

  /** What Collector Crypt's vault does when the parcel arrives. Same request as the Postman collection. */
  const simulateVault = useCallback(
    async (grader: Grader, certNumber: string, submissionId: string) => {
      const id = log.add({
        kind: "check",
        label: "Collector Crypt vaults the slab",
        call: "Collector Crypt POST /intake",
        args: [`${grader} ${certNumber}`],
        status: "pending",
      });
      const res = await fetch("/api/collector-crypt/intake", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grader, certNumber, depositorRef: `pokechain-submission-${submissionId}` }),
      });
      const data = (await res.json()) as { error?: string; card?: { assetId: string; owner: string } };
      if (!res.ok) {
        log.update(id, { status: "failed", error: data.error });
        throw new Error(data.error ?? "Intake failed");
      }
      log.update(id, { status: "success", args: [`Solana NFT ${data.card!.assetId} minted to Pokechain's escrow`] });
      return data.card!;
    },
    [log],
  );

  const verifyAndMint = useCallback(
    (submissionId: string, listingId?: string) =>
      operator<MintOutcome>("Verify Collector Crypt custody and mint", "/api/chain/mint", { submissionId, listingId }),
    [operator],
  );

  const transfer = useCallback(
    (tokenId: string, to: Address, handle: string) =>
      send({
        contract: "slabVault",
        functionName: "safeTransferFrom",
        args: [address!, to, BigInt(tokenId)],
        label: `Transfer to @${handle}`,
      }),
    [send, address],
  );

  /** Offboarding: lock the token on-chain, then the operator has Collector Crypt ship it. */
  const redeem = useCallback(
    async (tokenId: string, shipTo: string) => {
      const shippingHash = keccak256(toBytes(shipTo.trim()));
      const receipt = await send({
        contract: "slabVault",
        functionName: "requestRedemption",
        args: [BigInt(tokenId), shippingHash],
        label: "Withdraw slab",
      });
      const shipped = await operator<{
        redemptionRef: string;
        carrier: string;
        trackingNumber: string;
        tx: OperatorTx;
        checks: CheckStep[];
      }>("Collector Crypt ships to you", "/api/chain/ship", { tokenId, shipTo: shipTo.trim() });
      return { shippingHash, requestTx: receipt.transactionHash, ...shipped };
    },
    [send, operator],
  );

  const confirmDelivery = useCallback(
    (tokenId: string) =>
      send({ contract: "slabVault", functionName: "confirmDelivery", args: [BigInt(tokenId)], label: "Confirm delivery" }),
    [send],
  );

  const reportLost = useCallback(
    (tokenId: string, details: string) =>
      send({ contract: "slabVault", functionName: "reportLost", args: [BigInt(tokenId), details], label: "Report lost in transit" }),
    [send],
  );

  return { submit, receive, forward, simulateVault, verifyAndMint, transfer, redeem, confirmDelivery, reportLost };
}
