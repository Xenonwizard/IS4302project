"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePublicClient, useWatchContractEvent } from "wagmi";
import type { Grader } from "../types";
import { DEPLOY_BLOCK, contracts } from "./config";
import { useOnchainAccount } from "./useOnchainAccount";

export interface SubmissionRequest {
  submissionId: string;
  owner: string;
  grader: Grader;
  certNumber: string;
  /** SubmissionStatus: 1 Pending, 2 ReceivedByPokechain, 3 AtCustodian, 4 Vaulted, 5 Rejected. */
  status: number;
  tokenId: string;
  requestedAt: number;
  updatedAt: number;
  evidenceHash: `0x${string}`;
  inboundCarrier: string;
  inboundTracking: string;
  forwardCommitment: `0x${string}`;
  rejectReason?: string;
}

/** Every submission ever requested by the connected wallet, with the chain as source of truth. */
export function useSubmissions() {
  const { address } = useOnchainAccount();
  const client = usePublicClient();
  const queryClient = useQueryClient();
  const enabled = Boolean(address && client);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["submissions", address] });
  const watch = {
    ...contracts.slabVault,
    enabled,
    poll: true as const,
    pollingInterval: 1_000,
    onLogs: refresh,
  };
  useWatchContractEvent({ ...watch, eventName: "SubmissionRequested", args: { owner: address } });
  useWatchContractEvent({ ...watch, eventName: "SubmissionReceived", args: { owner: address } });
  useWatchContractEvent({ ...watch, eventName: "SubmissionForwarded", args: { owner: address } });
  useWatchContractEvent({ ...watch, eventName: "SubmissionRejected", args: { owner: address } });
  useWatchContractEvent({ ...watch, eventName: "SlabVaulted", args: { owner: address } });

  return useQuery({
    queryKey: ["submissions", address],
    enabled,
    refetchInterval: 3_000,
    refetchIntervalInBackground: true,
    queryFn: async (): Promise<SubmissionRequest[]> => {
      const [requested, rejected] = await Promise.all([
        client!.getContractEvents({
          ...contracts.slabVault,
          eventName: "SubmissionRequested",
          fromBlock: DEPLOY_BLOCK,
        }),
        client!.getContractEvents({
          ...contracts.slabVault,
          eventName: "SubmissionRejected",
          fromBlock: DEPLOY_BLOCK,
        }),
      ]);
      const owner = address!.toLowerCase();
      const requestedForOwner = requested.filter((event) => event.args.owner?.toLowerCase() === owner);
      const rejectedForOwner = rejected.filter((event) => event.args.owner?.toLowerCase() === owner);
      // Only requests the collector actually made (SubmissionRequested). Demo-seeded slabs are put straight
      // into the vault by the operator (seedSlab): they belong in the Vault, not in Submissions.
      const ids = [...new Set(requestedForOwner.map((event) => event.args.submissionId!))];
      const submissions = await Promise.all(
        ids.map((id) =>
          client!.readContract({ ...contracts.slabVault, functionName: "submissionOf", args: [id] }),
        ),
      );
      const reasons = new Map(
        rejectedForOwner.map((event) => [event.args.submissionId!.toString(), event.args.reason ?? ""]),
      );

      return ids
        .map((id, index) => ({ id, submission: submissions[index] }))
        .sort((a, b) => Number(b.submission.requestedAt) - Number(a.submission.requestedAt))
        .map(({ id, submission }) => ({
          submissionId: id.toString(),
          owner: submission.owner,
          grader: submission.grader as Grader,
          certNumber: submission.certNumber,
          status: submission.status,
          tokenId: submission.tokenId.toString(),
          requestedAt: Number(submission.requestedAt),
          updatedAt: Number(submission.updatedAt),
          evidenceHash: submission.evidenceHash,
          inboundCarrier: submission.inboundCarrier,
          inboundTracking: submission.inboundTracking,
          forwardCommitment: submission.forwardCommitment,
          rejectReason: reasons.get(id.toString()),
        }));
    },
  });
}
