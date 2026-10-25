/**
 * One slab's complete journey, assembled from three independent sources:
 *
 *   Polygon      eth_getLogs on SlabVault: the inbound trail (submission → received → forwarded),
 *                the mint, every ERC-721 Transfer (each change of owner), and the outbound trail
 *                (redemption → shipped → delivered / lost)
 *   Solana       getAsset + getSignaturesForAsset on Collector Crypt's NFT for the slab
 *   CC           the redemption's carrier tracking
 *
 * If the parcel never arrives, this is the evidence: who owned it, where it was sent (by hash),
 * CC's redemption id and carrier tracking, and the state of CC's NFT, all cross-referenced.
 */
import "server-only";
import { zeroAddress } from "viem";
import { custodianTrace } from "../collectorCrypt/client";
import { CUSTODY, DEPLOY_BLOCK, SUBMISSION_STATUS, contracts } from "./config";
import { publicClient } from "./operator";

export interface TraceEvent {
  source: "Polygon";
  event: string;
  detail: string;
  block: string;
  at: string;
  tx: string;
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export async function traceSlab(origin: string, tokenId: bigint) {
  const sv = contracts.slabVault;
  const slab = await publicClient.readContract({ ...sv, functionName: "slabOf", args: [tokenId] });
  const owner = await publicClient.readContract({ ...sv, functionName: "ownerOf", args: [tokenId] });
  const from = { fromBlock: DEPLOY_BLOCK };
  const byToken = { args: { tokenId }, ...from };

  // The token was minted at submission, so its submission id is its token id.
  const [vaulted] = await publicClient.getContractEvents({ ...sv, eventName: "SlabVaulted", ...byToken });
  const submissionId = tokenId;
  const bySub = { args: { submissionId }, ...from };

  const [transfers, redeem, shipped, delivered, lost, resolved, requested, received, forwarded] = await Promise.all([
    publicClient.getContractEvents({ ...sv, eventName: "Transfer", ...byToken }),
    publicClient.getContractEvents({ ...sv, eventName: "RedemptionRequested", ...byToken }),
    publicClient.getContractEvents({ ...sv, eventName: "SlabShipped", ...byToken }),
    publicClient.getContractEvents({ ...sv, eventName: "SlabDelivered", ...byToken }),
    publicClient.getContractEvents({ ...sv, eventName: "SlabReportedLost", ...byToken }),
    publicClient.getContractEvents({ ...sv, eventName: "LostReportResolved", ...byToken }),
    publicClient.getContractEvents({ ...sv, eventName: "SubmissionRequested", ...bySub }),
    publicClient.getContractEvents({ ...sv, eventName: "SubmissionReceived", ...bySub }),
    publicClient.getContractEvents({ ...sv, eventName: "SubmissionForwarded", ...bySub }),
  ]);

  const rows: { event: string; detail: string; block: bigint; tx: string; logIndex: number }[] = [];
  const push = (event: string, detail: string, log: { blockNumber: bigint; transactionHash: string; logIndex: number }) =>
    rows.push({ event, detail, block: log.blockNumber, tx: log.transactionHash, logIndex: log.logIndex });

  for (const l of requested) {
    const parcel = l.args.inboundTracking ? `, parcel ${l.args.inboundTracking}` : "";
    push("SubmissionRequested", `NFT #${l.args.submissionId} minted to ${short(l.args.owner!)}, pending and locked: ${l.args.grader} ${l.args.certNumber}${parcel}; evidence ${short(l.args.evidenceHash!)}`, l);
  }
  for (const l of received) push("SubmissionReceived", `Pokechain's warehouse received submission #${l.args.submissionId}`, l);
  for (const l of forwarded) {
    const bytes = (l.args.ciphertext!.length - 2) / 2;
    push("SubmissionForwarded", `Forwarded to Collector Crypt; parcel details encrypted to its key (${bytes} bytes of ciphertext, commitment ${short(l.args.commitment!)})`, l);
  }
  if (vaulted) push("SlabVaulted", `Collector Crypt vaulted it (CC NFT ${vaulted.args.custodianRef}); token #${tokenId} can now be traded`, vaulted);
  for (const l of transfers) {
    if (l.args.from === zeroAddress) continue; // the mint, already listed
    push("Transfer", `Owner ${short(l.args.from!)} → ${short(l.args.to!)}`, l);
  }
  for (const l of redeem) push("RedemptionRequested", `${short(l.args.owner!)} asked for the slab; shippingHash ${short(l.args.shippingHash!)}; token locked`, l);
  for (const l of shipped) push("SlabShipped", `Collector Crypt ${l.args.redemptionRef}: ${l.args.carrier} ${l.args.trackingNumber}`, l);
  for (const l of delivered) push("SlabDelivered", `${short(l.args.owner!)} confirmed delivery`, l);
  for (const l of lost) push("SlabReportedLost", `${short(l.args.owner!)}: "${l.args.details}" (tracking ${l.args.trackingNumber})`, l);
  for (const l of resolved) push("LostReportResolved", `Outcome: ${CUSTODY[Number(l.args.outcome)]}`, l);
  rows.sort((a, b) => Number(a.block - b.block) || a.logIndex - b.logIndex);

  // Block timestamps, fetched once per block.
  const blocks = [...new Set(rows.map((r) => r.block))];
  const times = new Map(
    await Promise.all(
      blocks.map(async (b) => [b, new Date(Number((await publicClient.getBlock({ blockNumber: b })).timestamp) * 1000).toISOString()] as const),
    ),
  );
  const polygon: TraceEvent[] = rows.map((r) => ({
    source: "Polygon",
    event: r.event,
    detail: r.detail,
    block: r.block.toString(),
    at: times.get(r.block)!,
    tx: r.tx,
  }));

  const submission = await publicClient.readContract({ ...sv, functionName: "submissionOf", args: [submissionId] });

  return {
    tokenId: tokenId.toString(),
    title: slab.title,
    image: slab.image,
    grader: slab.grader,
    certNumber: slab.certNumber,
    owner,
    custody: CUSTODY[slab.custody],
    custodianRef: slab.custodianRef,
    redemptionRef: slab.redemptionRef,
    carrier: slab.carrier,
    trackingNumber: slab.trackingNumber,
    shippingHash: slab.shippingHash,
    submission: submission.owner !== zeroAddress
      ? {
          id: submissionId.toString(),
          status: SUBMISSION_STATUS[submission.status],
          forwardCommitment: submission.forwardCommitment,
          inboundCarrier: submission.inboundCarrier,
          inboundTracking: submission.inboundTracking,
        }
      : null,
    evidenceHash: slab.evidenceHash,
    polygon,
    custodian: await custodianTrace(origin, slab.custodianRef, slab.redemptionRef || undefined),
  };
}

export type SlabTrace = Awaited<ReturnType<typeof traceSlab>>;
