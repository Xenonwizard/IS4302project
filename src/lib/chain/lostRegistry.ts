"use client";

/**
 * The public Lost registry, read from the chain so every collector sees the same list:
 *
 *   SlabVault.SlabReportedLost   every report ever filed (tokenId, owner, details)
 *   SlabVault.slabOf             still Lost? (a cancelled, found or written-off report isn't)
 *   SlabVault.custodyBeforeLossOf  Vaulted = missing from the vault, otherwise lost in the post
 *   LostSlabRecovery.bountyOf        the bounty escrowed for it right now
 *   AccountRegistry.accountOf    the owner's handle
 *
 * Nothing about a public report is kept in browser storage.
 */
import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { usePublicClient } from "wagmi";
import { buildOnChainListing, certPreview } from "../catalog";
import type { Grader, Listing } from "../types";
import { CUSTODY, DEPLOY_BLOCK, IS_DEPLOYED, contracts, fromUsdcUnits, shortHash } from "./config";

export interface ChainLostSlab {
  listing: Listing;
  owner: Address;
  details: string;
  reportedAt: string;
  source: "vault" | "transit";
  /** Escrowed on LostSlabRecovery, in dollars. */
  bounty: number;
}

export function useChainLostSlabs() {
  const client = usePublicClient();
  return useQuery({
    queryKey: ["lost-registry"],
    enabled: Boolean(client && IS_DEPLOYED),
    placeholderData: (prev) => prev,
    queryFn: async (): Promise<ChainLostSlab[]> => {
      const reports = await client!.getContractEvents({ ...contracts.slabVault, eventName: "SlabReportedLost", fromBlock: DEPLOY_BLOCK });
      // The same slab can be lost, found and lost again: its latest report is the open one.
      const latest = new Map<bigint, (typeof reports)[number]>();
      for (const e of reports) latest.set(e.args.tokenId!, e);
      const ids = [...latest.keys()];
      const slabs = await Promise.all(ids.map((id) => client!.readContract({ ...contracts.slabVault, functionName: "slabOf", args: [id] })));
      const open = ids.filter((_, i) => CUSTODY[slabs[i].custody] === "Lost");
      return Promise.all(
        open.map(async (id) => {
          const slab = slabs[ids.indexOf(id)];
          const event = latest.get(id)!;
          const [owner, before, bounty] = await Promise.all([
            client!.readContract({ ...contracts.slabVault, functionName: "ownerOf", args: [id] }),
            client!.readContract({ ...contracts.slabVault, functionName: "custodyBeforeLossOf", args: [id] }),
            client!.readContract({ ...contracts.lostSlabRecovery, functionName: "bountyOf", args: [id] }),
          ]);
          const account = await client!.readContract({ ...contracts.accounts, functionName: "accountOf", args: [owner] });
          // A slab lost before Collector Crypt vaulted it has no title or image on-chain yet.
          const preview = certPreview(slab.grader as Grader, slab.certNumber);
          const listing = buildOnChainListing({
            tokenId: id.toString(),
            title: slab.title || preview?.title || `${slab.grader} ${slab.certNumber}`,
            image: slab.image || preview?.image || "",
            grader: slab.grader as Grader,
            certNumber: slab.certNumber,
            owner: account.handle || shortHash(owner),
            ownerAddress: owner,
            contract: contracts.slabVault.address,
          });
          return {
            listing,
            owner,
            details: event.args.details || "Reported lost",
            reportedAt: new Date(Number(slab.custodyUpdatedAt) * 1000).toISOString(),
            source: CUSTODY[before] === "Vaulted" ? ("vault" as const) : ("transit" as const),
            bounty: fromUsdcUnits(bounty),
          };
        }),
      );
    },
  });
}
