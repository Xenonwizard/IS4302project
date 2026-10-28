"use client";

/**
 * Every slab action, on SlabVault and through the operator routes around it.
 *
 *  Inbound (collector → Pokechain → Collector Crypt → token)
 *   uploadEvidence()  POST /api/evidence: stores the photos, returns the manifest's keccak256
 *   submit()          SlabVault.requestSubmission(…, evidenceHash, …)  collector's wallet
 *   receive()         SlabVault.markReceived                          operator (Pokechain warehouse)
 *   forward()         SlabVault.markForwarded                         operator (ships to CC)
 *   simulateVault()   Collector Crypt intake: mints CC's NFT to Pokechain's escrow (= the Postman call)
 *   verifyAndMint()   CC API + Solana getAsset, then SlabVault.confirmVaulted   operator
 *                     (the NFT itself was minted, locked, by requestSubmission)
 *
 *  Trading (multi-slab + cash offers are in useTradeEscrow)
 *   transfer()        SlabVault.safeTransferFrom(me, to, tokenId)     collector's wallet
 *
 *  Outbound (owner → Collector Crypt ships to them)
 *   redeem()          SlabVault.requestRedemption (owner's wallet; burns the title NFT). Outtake service
 *                     (/outtake) then notifies CC to ship to the redeemer and records
 *                     it with SlabVault.markShipped
 *   confirmDelivery() SlabVault.confirmDelivery                       collector's wallet
 *   reportLost()      SlabVault.reportLost (inbound post, or missing from the vault)  collector's wallet
 *   writeOffLost()    SlabVault.writeOffLost: refunds the bounty, burns the token    collector's wallet
 *   resolveLost()     SlabVault.resolveLostReport                     operator (simulated carrier finds it)
 */
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { keccak256, parseEventLogs, toBytes, type Address } from "viem";
import type { CheckStep } from "../collectorCrypt/client";
import type { Grader } from "../types";
import { usePublicClient } from "wagmi";
import { contracts, CUSTODY } from "./config";
import { useChainLog } from "./log";
import type { LostOutcome, OperatorTx } from "./operator";
import { useChainTx } from "./useChainTx";

export type MintOutcome =
  | { result: "minted"; tokenId: string; owner: string; custodianRef: string; tx: OperatorTx; checks: CheckStep[] }
  | { result: "awaiting_custodian" | "mismatch"; checks: CheckStep[] };

export function useSlabChain() {
  const { send, operator, address } = useChainTx();
  const client = usePublicClient();
  const log = useChainLog();
  const queryClient = useQueryClient();

  /** Off-chain: store the intake photos and declarations; returns the hash that goes on-chain. */
  const uploadEvidence = useCallback(
    async (form: FormData) => {
      const id = log.add({ kind: "check", label: "Upload intake evidence", call: "Pokechain POST /api/evidence", args: [], status: "pending" });
      const res = await fetch("/api/evidence", { method: "POST", body: form });
      const data = (await res.json()) as { evidenceHash?: `0x${string}`; manifest?: { photos: unknown[] }; error?: string };
      if (!res.ok || !data.evidenceHash) {
        log.update(id, { status: "failed", error: data.error });
        throw new Error(data.error ?? "Upload failed");
      }
      log.update(id, { status: "success", args: [`${data.manifest!.photos.length} photos hashed · evidenceHash ${data.evidenceHash}`] });
      return data.evidenceHash;
    },
    [log],
  );

  const submit = useCallback(
    async (input: {
      grader: Grader;
      certNumber: string;
      evidenceHash: `0x${string}`;
      inboundCarrier: string;
      inboundTracking: string;
    }) => {
      const receipt = await send({
        contract: "slabVault",
        functionName: "requestSubmission",
        args: [
          input.grader,
          input.certNumber,
          input.evidenceHash,
          input.inboundCarrier,
          input.inboundTracking,
        ],
        label: "Submit slab",
      });
      const [event] = parseEventLogs({ abi: contracts.slabVault.abi, logs: receipt.logs, eventName: "SubmissionRequested" });
      // Show the new request in Submissions before navigating back to the list.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["submissions"] }),
        queryClient.invalidateQueries({ queryKey: ["pending-submissions"] }),
      ]);
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
      let requestTx = "";

      // Check current on-chain custody state
      if (client) {
        const slab = await client.readContract({
          ...contracts.slabVault,
          functionName: "slabOf",
          args: [BigInt(tokenId)],
        });

        if (CUSTODY[slab.custody] === "Vaulted") {
          const receipt = await send({
            contract: "slabVault",
            functionName: "requestRedemption",
            args: [BigInt(tokenId), shippingHash],
            label: "Withdraw slab (burns its NFT)",
          });
          requestTx = receipt.transactionHash;
        }
      } else {
        const receipt = await send({
          contract: "slabVault",
          functionName: "requestRedemption",
          args: [BigInt(tokenId), shippingHash],
          label: "Withdraw slab",
        });
        requestTx = receipt.transactionHash;
      }

      // Hand Pokechain the plaintext address (the chain only has its hash) so the outtake step can pass it to CC.
      const saved = await fetch("/api/chain/outtake/address", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tokenId, shipTo: shipTo.trim() }),
      });
      if (!saved.ok) throw new Error(((await saved.json()) as { error?: string }).error ?? "Pokechain did not accept the delivery address");

      // The owner's part ends here. Pokechain's outtake service (/outtake, or POST /api/chain/outtake)
      // then notifies Collector Crypt to ship and records it with SlabVault.markShipped.
      return { shippingHash, requestTx };
    },
    [client, send],
  );

  const confirmDelivery = useCallback(
    (tokenId: string) =>
      send({ contract: "slabVault", functionName: "confirmDelivery", args: [BigInt(tokenId)], label: "Confirm delivery" }),
    [send],
  );

  const reportLost = useCallback(
    (tokenId: string, details: string) =>
      send({ contract: "slabVault", functionName: "reportLost", args: [BigInt(tokenId), details], label: "Report slab lost" }),
    [send],
  );

  const writeOffLost = useCallback(
    (tokenId: string) =>
      send({ contract: "slabVault", functionName: "writeOffLost", args: [BigInt(tokenId)], label: "Write off lost slab" }),
    [send],
  );

  const cancelLost = useCallback(
    (tokenId: string) =>
      send({ contract: "slabVault", functionName: "cancelLostReport", args: [BigInt(tokenId)], label: "Cancel lost report" }),
    [send],
  );

  const resolveLost = useCallback(
    (tokenId: string, outcome: LostOutcome) =>
      operator<{ custody: string; tx: OperatorTx }>("Carrier found the parcel", "/api/chain/resolve-lost", { tokenId, outcome }),
    [operator],
  );

  return { uploadEvidence, submit, receive, forward, simulateVault, verifyAndMint, transfer, redeem, confirmDelivery, reportLost, cancelLost, writeOffLost, resolveLost };
}
