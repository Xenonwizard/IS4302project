/**
 * One slab's complete journey, assembled from three independent sources:
 *
 *   Polygon      eth_getLogs on SlabVault: the inbound trail (submission → received → forwarded),
 *                the mint, every ERC-721 Transfer (each change of owner), and the outbound trail
 *                (redemption → shipped → delivered / lost / written off); plus every other contract
 *                that touches the token: SlabMarket listings and sales, TradeEscrow swaps, and
 *                LostSlabRecovery bounties and finder claims
 *   Solana       getAsset + getSignaturesForAsset on Collector Crypt's NFT for the slab
 *   CC           the redemption's carrier tracking
 *
 * If the parcel never arrives, this is the evidence: who owned it, where it was sent (by hash),
 * CC's redemption id and carrier tracking, and the state of CC's NFT, all cross-referenced.
 */
import "server-only";
import { zeroAddress } from "viem";
import { custodianTrace } from "../collectorCrypt/client";
import { CONTRACT_LABEL, CUSTODY, DEPLOY_BLOCK, SUBMISSION_STATUS, contracts, fromUsdcUnits, type ContractName } from "./config";
import { publicClient } from "./operator";

export interface TraceEvent {
  source: "Polygon";
  /** the contract that emitted it, e.g. "SlabVault" */
  contract: string;
  event: string;
  detail: string;
  block: string;
  at: string;
  tx: string;
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const usdc = (units: bigint) => `${fromUsdcUnits(units).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`;
const RETURN_TO = ["unset", "the vault", "the owner"];

/** Our own contracts, by address: a Transfer into TradeEscrow reads as such, not as a bare address. */
const CONTRACT_BY_ADDRESS = new Map(
  (Object.keys(contracts) as ContractName[]).map((name) => [contracts[name].address.toLowerCase(), CONTRACT_LABEL[name]]),
);
const who = (a: string) => CONTRACT_BY_ADDRESS.get(a.toLowerCase()) ?? short(a);

export async function traceSlab(origin: string, tokenId: bigint) {
  const sv = contracts.slabVault;
  const slab = await publicClient.readContract({ ...sv, functionName: "slabOf", args: [tokenId] });
  // ownerOf stops existing once the owner asks to ship the slab out (the token burns then). The
  // custody record and redemption events remain queryable after the burn.
  let owner = await publicClient.readContract({ ...sv, functionName: "ownerOf", args: [tokenId] }).catch(() => zeroAddress);
  const from = { fromBlock: DEPLOY_BLOCK };
  const byToken = { args: { tokenId }, ...from };

  // A token is minted only at receipt; this immutable link recovers its cert-number request id.
  const [vaulted] = await publicClient.getContractEvents({ ...sv, eventName: "SlabVaulted", ...byToken });
  const submissionId = await publicClient.readContract({ ...sv, functionName: "submissionOfToken", args: [tokenId] });
  const bySub = { args: { submissionId }, ...from };

  const lsr = contracts.lostSlabRecovery;
  const market = contracts.slabMarket;
  const trades = contracts.tradeEscrow;

  const [transfers, redeem, shipped, delivered, lost, cancelled, resolved, recovered, writtenOff, requested, received, forwarded] = await Promise.all([
    publicClient.getContractEvents({ ...sv, eventName: "Transfer", ...byToken }),
    publicClient.getContractEvents({ ...sv, eventName: "RedemptionRequested", ...byToken }),
    publicClient.getContractEvents({ ...sv, eventName: "SlabShipped", ...byToken }),
    publicClient.getContractEvents({ ...sv, eventName: "SlabDelivered", ...byToken }),
    publicClient.getContractEvents({ ...sv, eventName: "SlabReportedLost", ...byToken }),
    publicClient.getContractEvents({ ...sv, eventName: "LostReportCancelled", ...byToken }),
    publicClient.getContractEvents({ ...sv, eventName: "LostReportResolved", ...byToken }),
    publicClient.getContractEvents({ ...sv, eventName: "LostSlabRecovered", ...byToken }),
    publicClient.getContractEvents({ ...sv, eventName: "LostSlabWrittenOff", ...byToken }),
    publicClient.getContractEvents({ ...sv, eventName: "SubmissionRequested", ...bySub }),
    publicClient.getContractEvents({ ...sv, eventName: "SubmissionReceived", ...bySub }),
    publicClient.getContractEvents({ ...sv, eventName: "SubmissionForwarded", ...bySub }),
  ]);
  // The other contracts that move or lock this token. tokenId isn't indexed on
  // TradeEscrow.OfferCreated, so those are filtered here, then their follow-ups fetched by offer id.
  const [listed, delisted, purchased, bountySet, bountyRefunded, claimFiled, claimReceived, returnChosen, returnCompleted, bountyPaid, claimRejected, tradeOffers] = await Promise.all([
    publicClient.getContractEvents({ ...market, eventName: "CardListed", ...byToken }),
    publicClient.getContractEvents({ ...market, eventName: "ListingCancelled", ...byToken }),
    publicClient.getContractEvents({ ...market, eventName: "CardPurchased", ...byToken }),
    publicClient.getContractEvents({ ...lsr, eventName: "BountySet", ...byToken }),
    publicClient.getContractEvents({ ...lsr, eventName: "BountyRefunded", ...byToken }),
    publicClient.getContractEvents({ ...lsr, eventName: "ClaimFiled", ...byToken }),
    publicClient.getContractEvents({ ...lsr, eventName: "ClaimReceived", ...byToken }),
    publicClient.getContractEvents({ ...lsr, eventName: "ReturnChosen", ...byToken }),
    publicClient.getContractEvents({ ...lsr, eventName: "ReturnCompleted", ...byToken }),
    publicClient.getContractEvents({ ...lsr, eventName: "BountyPaid", ...byToken }),
    publicClient.getContractEvents({ ...lsr, eventName: "ClaimRejected", ...byToken }),
    publicClient.getContractEvents({ ...trades, eventName: "OfferCreated", ...from }).then((logs) =>
      logs.filter((l) => l.args.makerSlabs?.includes(tokenId) || l.args.takerSlabs?.includes(tokenId)),
    ),
  ]);
  const tradeIds = tradeOffers.map((l) => l.args.offerId!);
  const claimIds = claimFiled.map((l) => l.args.claimId!);
  const none = Promise.resolve([]);
  const [tradeAccepted, tradeDeclined, tradeWithdrawn, bondRefunded, bondSlashed] = await Promise.all([
    tradeIds.length ? publicClient.getContractEvents({ ...trades, eventName: "OfferAccepted", args: { offerId: tradeIds }, ...from }) : none,
    tradeIds.length ? publicClient.getContractEvents({ ...trades, eventName: "OfferDeclined", args: { offerId: tradeIds }, ...from }) : none,
    tradeIds.length ? publicClient.getContractEvents({ ...trades, eventName: "OfferWithdrawn", args: { offerId: tradeIds }, ...from }) : none,
    claimIds.length ? publicClient.getContractEvents({ ...lsr, eventName: "ClaimBondRefunded", args: { claimId: claimIds }, ...from }) : none,
    claimIds.length ? publicClient.getContractEvents({ ...lsr, eventName: "ClaimBondSlashed", args: { claimId: claimIds }, ...from }) : none,
  ]);

  if (owner === zeroAddress && delivered.length) owner = delivered.at(-1)!.args.owner!;
  if (owner === zeroAddress && redeem.length) owner = redeem.at(-1)!.args.owner!;

  type Log = { blockNumber: bigint; transactionHash: string; logIndex: number };
  const rows: { contract: string; event: string; detail: string; block: bigint; tx: string; logIndex: number }[] = [];
  const pushFrom = (contract: string) => (event: string, detail: string, log: Log) =>
    rows.push({ contract, event, detail, block: log.blockNumber, tx: log.transactionHash, logIndex: log.logIndex });
  const push = pushFrom("SlabVault");
  const pushMarket = pushFrom("SlabMarket");
  const pushTrade = pushFrom("TradeEscrow");
  const pushLsr = pushFrom("LostSlabRecovery");

  for (const l of requested) {
    const parcel = l.args.inboundTracking ? `, parcel ${l.args.inboundTracking}` : "";
    push("SubmissionRequested", `Request #${l.args.submissionId}: ${l.args.grader} ${l.args.certNumber}${parcel}; evidence ${short(l.args.evidenceHash!)}`, l);
  }
  for (const l of received) push("SubmissionReceived", `Pokechain received submission #${l.args.submissionId} and minted token #${l.args.tokenId}`, l);
  for (const l of forwarded) {
    const bytes = (l.args.ciphertext!.length - 2) / 2;
    push("SubmissionForwarded", `Forwarded to Collector Crypt; parcel details encrypted to its key (${bytes} bytes of ciphertext, commitment ${short(l.args.commitment!)})`, l);
  }
  if (vaulted) push("SlabVaulted", `Collector Crypt vaulted it (CC NFT ${vaulted.args.custodianRef}); token #${tokenId} can now be traded`, vaulted);
  for (const l of transfers) {
    if (l.args.from === zeroAddress) continue; // the mint, already listed
    push("Transfer", `${l.args.to === zeroAddress ? "Burned by" : "Owner"} ${who(l.args.from!)}${l.args.to === zeroAddress ? "" : ` → ${who(l.args.to!)}`}`, l);
  }
  for (const l of redeem) push("RedemptionRequested", `${short(l.args.owner!)} asked for the slab; shippingHash ${short(l.args.shippingHash!)}; title NFT locked`, l);
  for (const l of shipped) push("SlabShipped", `Collector Crypt ${l.args.redemptionRef}: ${l.args.carrier} ${l.args.trackingNumber}${l.args.redemptionRef === "RECOVERY" ? "" : "; title NFT burned"}`, l);
  for (const l of delivered) push("SlabDelivered", `${short(l.args.owner!)} confirmed delivery`, l);
  for (const l of lost) push("SlabReportedLost", `${short(l.args.owner!)}: "${l.args.details}" (tracking ${l.args.trackingNumber})`, l);
  for (const l of cancelled) push("LostReportCancelled", `${short(l.args.owner!)} cancelled the report; restored ${CUSTODY[Number(l.args.restoredCustody)]}`, l);
  for (const l of resolved) push("LostReportResolved", `Outcome: ${CUSTODY[Number(l.args.outcome)]}`, l);
  for (const l of recovered) push("LostSlabRecovered", `Pokechain/CC verified it and returned it via ${l.args.carrier} ${l.args.trackingNumber}`, l);
  for (const l of writtenOff) push("LostSlabWrittenOff", `${short(l.args.owner!)} claimed insurance; title NFT burned`, l);

  for (const l of listed) pushMarket("CardListed", `${short(l.args.seller!)} listed it for ${usdc(l.args.price!)}`, l);
  for (const l of delisted) pushMarket("ListingCancelled", `${short(l.args.seller!)} delisted it`, l);
  for (const l of purchased) pushMarket("CardPurchased", `${short(l.args.buyer!)} bought it from ${short(l.args.seller!)} for ${usdc(l.args.price!)} (fee ${usdc(l.args.fee!)})`, l);

  for (const l of tradeOffers) {
    const offered = l.args.makerSlabs?.includes(tokenId);
    const counter = l.args.counterOf ? ` (counter to #${l.args.counterOf})` : "";
    pushTrade("OfferCreated", `Trade offer #${l.args.offerId}${counter}: ${short(l.args.maker!)} → ${short(l.args.taker!)}; ${offered ? "this slab is offered and held in escrow" : "this slab is asked for"}`, l);
  }
  for (const l of tradeAccepted) pushTrade("OfferAccepted", `Trade #${l.args.offerId} accepted by ${short(l.args.taker!)}; slabs swapped`, l);
  for (const l of tradeDeclined) pushTrade("OfferDeclined", `Trade #${l.args.offerId} declined; escrow returned`, l);
  for (const l of tradeWithdrawn) pushTrade("OfferWithdrawn", `Trade #${l.args.offerId} withdrawn; escrow returned`, l);


  for (const l of bountySet) pushLsr("BountySet", l.args.amount ? `${short(l.args.owner!)} set a ${usdc(l.args.amount)} finder bounty` : `${short(l.args.owner!)} removed the bounty`, l);
  for (const l of claimFiled) {
    const parcel = l.args.inboundTracking ? ` (parcel ${l.args.inboundCarrier} ${l.args.inboundTracking})` : "";
    pushLsr("ClaimFiled", `Claim #${l.args.claimId}: ${short(l.args.finder!)} says they found it${parcel}; evidence ${short(l.args.evidenceHash!)}`, l);
  }
  for (const l of claimReceived) pushLsr("ClaimReceived", `Claim #${l.args.claimId}: Pokechain received and verified the slab`, l);
  for (const l of returnChosen) pushLsr("ReturnChosen", `Claim #${l.args.claimId}: owner chose to return it to ${RETURN_TO[Number(l.args.returnTo)]}${l.args.returnTo === 2 ? `; shippingHash ${short(l.args.shippingHash!)}` : ""}`, l);
  for (const l of returnCompleted) pushLsr("ReturnCompleted", `Claim #${l.args.claimId}: returned to ${RETURN_TO[Number(l.args.returnTo)]}`, l);
  for (const l of bountyPaid) pushLsr("BountyPaid", `Claim #${l.args.claimId}: ${usdc(l.args.amount!)} bounty paid to finder ${short(l.args.finder!)}`, l);
  for (const l of claimRejected) pushLsr("ClaimRejected", `Claim #${l.args.claimId} rejected: "${l.args.reason}"`, l);
  for (const l of bondRefunded) pushLsr("ClaimBondRefunded", `Claim #${l.args.claimId}: ${usdc(l.args.amount!)} bond refunded to ${short(l.args.finder!)}`, l);
  for (const l of bondSlashed) pushLsr("ClaimBondSlashed", `Claim #${l.args.claimId}: ${usdc(l.args.amount!)} bond slashed to owner ${short(l.args.owner!)}`, l);
  for (const l of bountyRefunded) pushLsr("BountyRefunded", `${usdc(l.args.amount!)} bounty refunded to ${short(l.args.owner!)}`, l);
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
    contract: r.contract,
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
