"use client";

/**
 * Slab onboarding and offboarding against SlabVault, plus the off-chain Grade10 calls around it.
 *
 *   submit()          SlabVault.requestSubmission          (collector's wallet)
 *   verifyAndMint()   Grade10 registry + Solana getAsset, then SlabVault.mintSlab   (operator)
 *   simulateIntake()  Grade10 intake, the same call Postman makes
 *   redeem()          SlabVault.requestRedemption          (collector's wallet)
 *                     then SlabVault.markShipped           (operator)
 *   confirmDelivery() SlabVault.confirmDelivery            (collector's wallet)
 *   reportLost()      SlabVault.reportLost                 (collector's wallet)
 */
import { useCallback } from "react";
import { keccak256, parseEventLogs, toBytes } from "viem";
import type { Grader } from "../types";
import { contracts } from "./config";
import { useChainLog } from "./log";
import { useChainTx } from "./useChainTx";
import type { CheckStep } from "../grade10/verify";
import type { OperatorTx } from "./operator";

export type MintOutcome =
  | { result: "minted"; tokenId: string; owner: string; custodianRef: string; tx: OperatorTx; checks: CheckStep[] }
  | { result: "awaiting_intake" | "mismatch"; checks: CheckStep[] }
  | { result: "rejected"; reason: string; checks: CheckStep[]; tx: OperatorTx };

export function useSlabChain() {
  const { send, operator } = useChainTx();
  const log = useChainLog();

  /** Step 1: the collector declares the slab on-chain. Returns the new submission id. */
  const submit = useCallback(
    async (grader: Grader, certNumber: string) => {
      const receipt = await send({
        contract: "slabVault",
        functionName: "requestSubmission",
        args: [grader, certNumber],
        label: "Submit slab",
      });
      const [event] = parseEventLogs({ abi: contracts.slabVault.abi, logs: receipt.logs, eventName: "SubmissionRequested" });
      return event.args.submissionId.toString();
    },
    [send],
  );

  /** Step 2: the operator checks Grade10 custody and, if it's verified, mints. */
  const verifyAndMint = useCallback(
    (submissionId: string, listingId?: string) =>
      operator<MintOutcome>("Verify Grade10 custody and mint", "/api/chain/mint", { submissionId, listingId }),
    [operator],
  );

  /** What Grade10's warehouse does when the parcel arrives. Same request as the Postman collection. */
  const simulateIntake = useCallback(
    async (grader: Grader, certNumber: string) => {
      const id = log.add({
        kind: "check",
        label: "Grade10 receives the slab",
        call: "Grade10 POST /intake",
        args: [`${grader} ${certNumber}`],
        status: "pending",
      });
      const res = await fetch("/api/grade10/intake", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grader, certNumber }),
      });
      const data = (await res.json()) as { error?: string; record?: { assetId: string } };
      if (!res.ok) {
        log.update(id, { status: "failed", error: data.error });
        throw new Error(data.error ?? "Intake failed");
      }
      log.update(id, { status: "success", args: [`Recorded on Solana as asset ${data.record!.assetId}`] });
      return data.record!;
    },
    [log],
  );

  /** Offboarding: lock the token, then the operator ships. The shipping address is only hashed on-chain. */
  const redeem = useCallback(
    async (tokenId: string, shipTo: string) => {
      const shippingHash = keccak256(toBytes(shipTo.trim()));
      const receipt = await send({
        contract: "slabVault",
        functionName: "requestRedemption",
        args: [BigInt(tokenId), shippingHash],
        label: "Withdraw slab",
      });
      const shipped = await operator<{ carrier: string; trackingNumber: string; tx: OperatorTx; checks: CheckStep[] }>(
        "Grade10 ships the slab",
        "/api/chain/ship",
        { tokenId },
      );
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

  return { submit, verifyAndMint, simulateIntake, redeem, confirmDelivery, reportLost };
}
