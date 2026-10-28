"use client";

/**
 * Lost-slab bounties and found-slab claims, on LostSlabRecovery.
 *
 *  Owner      setBounty()     LostSlabRecovery.setBounty: escrows the bounty from their Pokechain balance
 *             chooseReturn()  LostSlabRecovery.chooseReturn: vault, or delivery (keccak256 of the address)
 *  Finder     fileClaim()     LostSlabRecovery.fileClaim: evidence hash + the parcel's tracking number
 *             claimBounty()   LostSlabRecovery.claimBounty: paid once SlabVault shows the slab back
 *  Pokechain  step()          POST /api/chain/found: markReceived, completeReturn or rejectClaim
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { keccak256, parseEventLogs, toBytes, type Address } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { CUSTODY, DEPLOY_BLOCK, IS_DEPLOYED, contracts, fromUsdcUnits, toUsdcUnits, type CustodyName } from "./config";
import { certPreview } from "../catalog";
import { usd } from "../format";
import type { Grader } from "../types";
import { useChainLog } from "./log";
import type { FoundStep, OperatorTx } from "./operator";
import { useStore } from "../store";
import { useChainTx } from "./useChainTx";
import { useSlabChain } from "./useSlabChain";

export interface FoundCase {
  claimId: string;
  tokenId: string;
  title: string;
  grader: string;
  certNumber: string;
  image: string;
  finder: Address;
  owner: Address;
  evidenceHash: `0x${string}`;
  inboundCarrier: string;
  inboundTracking: string;
  /** LostSlabRecovery.Status: 1 Filed, 2 At Pokechain, 3 Return chosen, 4 Returned, 5 Paid, 6 Rejected */
  status: number;
  /** LostSlabRecovery.ReturnTo: 1 Vault, 2 Owner */
  returnTo: number;
  shippingHash: `0x${string}`;
  /** What the finder was paid, in dollars (0 until paid). */
  paid: number;
  /** Bounty escrowed for the slab right now, in dollars. */
  bounty: number;
  /** The slab's custody on SlabVault, which is what the payout checks. */
  custody: CustodyName;
  filedAt: number;
  updatedAt: number;
}

/** Still being worked on: the slab is on its way to or with Pokechain, or not yet back. */
export const isOpenCase = (c: FoundCase) => c.status >= 1 && c.status <= 4;

/** Every found-slab claim on the chain, newest first. Few enough in a demo to read them all. */
export function useFoundCases() {
  const client = usePublicClient();
  return useQuery({
    queryKey: ["found-cases"],
    enabled: Boolean(client && IS_DEPLOYED),
    queryFn: async (): Promise<FoundCase[]> => {
      const filed = await client!.getContractEvents({ ...contracts.lostSlabRecovery, eventName: "ClaimFiled", fromBlock: DEPLOY_BLOCK });
      const ids = [...new Set(filed.map((e) => e.args.claimId!))].reverse();
      return Promise.all(
        ids.map(async (id) => {
          const c = await client!.readContract({ ...contracts.lostSlabRecovery, functionName: "claimOf", args: [id] });
          const [bounty, slab] = await Promise.all([
            client!.readContract({ ...contracts.lostSlabRecovery, functionName: "bountyOf", args: [c.tokenId] }),
            // slabOf still answers after the token burns on confirmed delivery.
            client!.readContract({ ...contracts.slabVault, functionName: "slabOf", args: [c.tokenId] }),
          ]);
          // A slab lost before vaulting has no on-chain title or image yet: fall back to the cert lookup.
          const preview = certPreview(slab.grader as Grader, slab.certNumber);
          return {
            claimId: id.toString(),
            tokenId: c.tokenId.toString(),
            title: slab.title || preview?.title || `${slab.grader} ${slab.certNumber}`,
            grader: slab.grader,
            certNumber: slab.certNumber,
            image: slab.image || preview?.image || "",
            finder: c.finder,
            owner: c.owner,
            evidenceHash: c.evidenceHash,
            inboundCarrier: c.inboundCarrier,
            inboundTracking: c.inboundTracking,
            status: c.status,
            returnTo: c.returnTo,
            shippingHash: c.shippingHash,
            paid: fromUsdcUnits(c.paid),
            bounty: fromUsdcUnits(bounty),
            custody: CUSTODY[slab.custody],
            filedAt: Number(c.filedAt),
            updatedAt: Number(c.updatedAt),
          };
        }),
      );
    },
  });
}

const STEP_LABEL: Record<FoundStep, string> = {
  receive: "Pokechain receives the found slab",
  return: "Pokechain returns the found slab",
  reject: "Pokechain rejects the claim",
};

export function useLostSlabRecovery() {
  const { send, operator } = useChainTx();
  const client = usePublicClient();
  const log = useChainLog();
  const queryClient = useQueryClient();
  const refresh = useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["found-cases"] }),
        queryClient.invalidateQueries({ queryKey: ["lost-registry"] }),
        queryClient.invalidateQueries({ queryKey: ["owned-slabs"] }),
      ]),
    [queryClient],
  );

  /** Sets the escrowed bounty to `dollars` (0 refunds it). */
  const setBounty = useCallback(
    async (tokenId: string, dollars: number) => {
      await send({
        contract: "lostSlabRecovery",
        functionName: "setBounty",
        args: [BigInt(tokenId), toUsdcUnits(dollars)],
        label: dollars > 0 ? "Escrow lost-slab bounty" : "Refund lost-slab bounty",
      });
      await refresh();
    },
    [send, refresh],
  );

  const fileClaim = useCallback(
    async (input: { tokenId: string; details: string; evidence: string; files: string[]; carrier: string; tracking: string }) => {
      // The evidence stays off-chain; its keccak256 goes on-chain so it can't be changed later.
      const manifest = JSON.stringify({
        tokenId: input.tokenId,
        foundAt: input.details.trim(),
        condition: input.evidence.trim(),
        photos: input.files,
      });
      const evidenceHash = keccak256(toBytes(manifest));
      log.add({ kind: "check", label: "Hash found-slab evidence", call: "keccak256(evidence manifest)", args: [evidenceHash], status: "success" });
      const receipt = await send({
        contract: "lostSlabRecovery",
        functionName: "fileClaim",
        args: [BigInt(input.tokenId), evidenceHash, input.carrier.trim(), input.tracking.trim()],
        label: "File found-slab claim",
      });
      const [event] = parseEventLogs({ abi: contracts.lostSlabRecovery.abi, logs: receipt.logs, eventName: "ClaimFiled" });
      await refresh();
      return event.args.claimId.toString();
    },
    [send, log, refresh],
  );

  const chooseReturn = useCallback(
    async (claimId: string, toVault: boolean, shipTo = "") => {
      const shippingHash = toVault ? (`0x${"0".repeat(64)}` as const) : keccak256(toBytes(shipTo.trim()));
      await send({
        contract: "lostSlabRecovery",
        functionName: "chooseReturn",
        args: [BigInt(claimId), toVault, shippingHash],
        label: toVault ? "Return found slab to vault" : "Deliver found slab to me",
      });
      await refresh();
    },
    [send, refresh],
  );

  const claimBounty = useCallback(
    async (claimId: string) => {
      await send({ contract: "lostSlabRecovery", functionName: "claimBounty", args: [BigInt(claimId)], label: "Claim recovery bounty" });
      await refresh();
    },
    [send, refresh],
  );

  const step = useCallback(
    async (claimId: string, which: FoundStep) => {
      const result = await operator<{ tx: OperatorTx }>(STEP_LABEL[which], "/api/chain/found", { claimId, step: which });
      await refresh();
      return result;
    },
    [operator, refresh],
  );

  const { data: claimBondUnits } = useQuery({
    queryKey: ["lost-slab-recovery-claim-bond", client?.chain?.id],
    enabled: Boolean(client && IS_DEPLOYED),
    queryFn: async () => {
      try {
        const bond = await client!.readContract({
          ...contracts.lostSlabRecovery,
          functionName: "claimBond",
        });
        return fromUsdcUnits(bond as bigint);
      } catch {
        return 0;
      }
    },
  });
  const claimBond = claimBondUnits ?? 0;

  return { setBounty, fileClaim, chooseReturn, claimBounty, step, claimBond };
}

/**
 * Every lost-report action. With a chain the report and its bounty live only on SlabVault and
 * LostSlabRecovery, and the Lost page reads them back from there (useChainLostSlabs); this browser
 * only takes the slab off sale. Without a chain (or a slab with no token) it is the local demo.
 */
export function useLostReport() {
  const { setBounty } = useLostSlabRecovery();
  const { reportLost, cancelLost, writeOffLost } = useSlabChain();
  const { reportVaultLost, delistLostSlab, cancelVaultLost, setVaultBounty, cancelVaultBounty, withdrawLostForInsurance } = useStore();
  const queryClient = useQueryClient();
  const client = usePublicClient();
  const { address } = useAccount();
  // Checked before anything is sent, so a report is never filed with a bounty that then can't be escrowed.
  const ensureFunds = useCallback(
    async (tokenId: string, dollars: number) => {
      if (!client || !address) return;
      const [balance, current] = await Promise.all([
        client.readContract({ ...contracts.accounts, functionName: "balanceOf", args: [address] }),
        client.readContract({ ...contracts.lostSlabRecovery, functionName: "bountyOf", args: [BigInt(tokenId)] }),
      ]);
      const extra = toUsdcUnits(dollars) - current;
      if (extra > balance) {
        throw new Error(
          `This bounty needs ${usd(fromUsdcUnits(extra), { cents: true })} more, but your Pokechain balance is ${usd(fromUsdcUnits(balance), { cents: true })}. Deposit PokeCredits in Wallet first.`,
        );
      }
    },
    [client, address],
  );
  const refresh = useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["lost-registry"] }),
        queryClient.invalidateQueries({ queryKey: ["owned-slabs"] }),
      ]),
    [queryClient],
  );
  const onChain = (tokenId?: string): tokenId is string => IS_DEPLOYED && Boolean(tokenId);

  /** Sets the bounty to `dollars` (0 refunds it): escrowed on LostSlabRecovery, so the Lost page never advertises money the contract doesn't hold. */
  const setLostBounty = useCallback(
    async (listingId: string, dollars: number, tokenId?: string) => {
      if (onChain(tokenId)) {
        await ensureFunds(tokenId, dollars);
        return setBounty(tokenId, dollars);
      }
      if (dollars > 0) setVaultBounty(listingId, dollars);
      else cancelVaultBounty(listingId);
    },
    [ensureFunds, setBounty, setVaultBounty, cancelVaultBounty],
  );

  const report = useCallback(
    async (listingId: string, tokenId: string | undefined, details: string, opts: { inTransit?: boolean; bounty?: number } = {}) => {
      const bounty = opts.bounty && Number.isFinite(opts.bounty) && opts.bounty > 0 ? opts.bounty : 0;
      if (onChain(tokenId)) {
        if (bounty) await ensureFunds(tokenId, bounty);
        await reportLost(tokenId, details);
        delistLostSlab(listingId);
        if (bounty) await setBounty(tokenId, bounty);
        await refresh();
        return;
      }
      reportVaultLost(listingId, details, opts.inTransit);
      if (bounty) setVaultBounty(listingId, bounty);
    },
    [ensureFunds, reportLost, delistLostSlab, setBounty, refresh, reportVaultLost, setVaultBounty],
  );

  /** Withdraws a mistaken report: custody goes back to where it was and any bounty is refunded. */
  const cancel = useCallback(
    async (listingId: string, tokenId?: string) => {
      if (onChain(tokenId)) {
        await cancelLost(tokenId);
        await refresh();
        return;
      }
      cancelVaultLost(listingId);
    },
    [cancelLost, refresh, cancelVaultLost],
  );

  /**
   * Gives up on the slab for an off-chain insurance claim: the bounty is refunded and the token
   * burned, so it can never be vaulted or traded. A slab whose loss was only reported privately
   * (a vaulting delay) is reported lost on-chain first, since writeOffLost only takes Lost slabs.
   */
  const writeOff = useCallback(
    async (listingId: string, tokenId?: string, details?: string) => {
      if (onChain(tokenId) && client) {
        const id = BigInt(tokenId);
        const custody = CUSTODY[await client.readContract({ ...contracts.slabVault, functionName: "custodyOf", args: [id] })];
        // None: not on this chain. Delivered / Written off: already burned.
        if (custody !== "None" && custody !== "Delivered" && custody !== "Written off") {
          const claimId = await client.readContract({ ...contracts.lostSlabRecovery, functionName: "activeClaimOf", args: [id] });
          if (claimId !== BigInt(0)) {
            throw new Error(`A finder has filed claim #${claimId} for this slab. Wait for Pokechain to check it before claiming insurance.`);
          }
          if (custody !== "Lost") await reportLost(tokenId, details || "Lost before vaulting: owner claimed insurance");
          await writeOffLost(tokenId);
          // Save the outcome as soon as the burn lands: a reload during the refresh below would
          // otherwise lose it, and Status Center would show the slab as still in recovery.
          withdrawLostForInsurance(listingId);
          await refresh();
          return;
        }
      }
      withdrawLostForInsurance(listingId);
    },
    [client, reportLost, writeOffLost, refresh, withdrawLostForInsurance],
  );

  return { report, cancel, writeOff, setBounty: setLostBounty };
}
