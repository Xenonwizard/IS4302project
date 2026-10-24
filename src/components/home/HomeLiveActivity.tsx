"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, ArrowRight, CheckCircle2, ShieldCheck, Tag, ShoppingCart } from "lucide-react";
import Link from "next/link";
import { zeroAddress } from "viem";
import { usePublicClient, useWatchContractEvent } from "wagmi";
import { DEPLOY_BLOCK, IS_DEPLOYED, chain, contracts, fromUsdcUnits, shortHash } from "@/lib/chain/config";
import { usd } from "@/lib/format";
import { CopyText } from "../chain/ChainConsole";

interface OnChainEventRow {
  key: string;
  kind: "sale" | "listed" | "mint" | "transfer" | "redeem" | "cancelled";
  title: string;
  detail: string;
  block: bigint;
  txHash: string;
  tokenId?: string;
}

export function HomeLiveActivity() {
  const client = usePublicClient();
  const enabled = Boolean(client && IS_DEPLOYED);
  const queryClient = useQueryClient();

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["home-live-onchain-activity"] });
  };

  useWatchContractEvent({ ...contracts.slabMarket, eventName: "CardPurchased", enabled, poll: true, pollingInterval: 1000, onLogs: refresh });
  useWatchContractEvent({ ...contracts.slabMarket, eventName: "CardListed", enabled, poll: true, pollingInterval: 1000, onLogs: refresh });
  useWatchContractEvent({ ...contracts.slabMarket, eventName: "ListingCancelled", enabled, poll: true, pollingInterval: 1000, onLogs: refresh });
  useWatchContractEvent({ ...contracts.slabVault, eventName: "SlabMinted", enabled, poll: true, pollingInterval: 1000, onLogs: refresh });
  useWatchContractEvent({ ...contracts.slabVault, eventName: "Transfer", enabled, poll: true, pollingInterval: 1000, onLogs: refresh });
  useWatchContractEvent({ ...contracts.slabVault, eventName: "RedemptionRequested", enabled, poll: true, pollingInterval: 1000, onLogs: refresh });

  const { data: events = [] } = useQuery({
    queryKey: ["home-live-onchain-activity"],
    enabled,
    refetchInterval: 3000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<OnChainEventRow[]> => {
      if (!client) return [];
      const from = { fromBlock: DEPLOY_BLOCK };

      try {
        const [marketCode, vaultCode] = await Promise.all([
          client.getBytecode({ address: contracts.slabMarket.address }).catch(() => null),
          client.getBytecode({ address: contracts.slabVault.address }).catch(() => null),
        ]);
        if (!marketCode || marketCode === "0x" || !vaultCode || vaultCode === "0x") {
          return [];
        }

        const [sales, listings, cancellations, mints, redemptions, transfers] = await Promise.all([
          client.getContractEvents({ ...contracts.slabMarket, eventName: "CardPurchased", ...from }).catch(() => []),
          client.getContractEvents({ ...contracts.slabMarket, eventName: "CardListed", ...from }).catch(() => []),
          client.getContractEvents({ ...contracts.slabMarket, eventName: "ListingCancelled", ...from }).catch(() => []),
          client.getContractEvents({ ...contracts.slabVault, eventName: "SlabMinted", ...from }).catch(() => []),
          client.getContractEvents({ ...contracts.slabVault, eventName: "RedemptionRequested", ...from }).catch(() => []),
          client.getContractEvents({ ...contracts.slabVault, eventName: "Transfer", ...from }).catch(() => []),
        ]);

        const rows: OnChainEventRow[] = [];

        for (const log of sales) {
          const a = log.args as { tokenId?: bigint; seller?: string; buyer?: string; price?: bigint; fee?: bigint };
          if (!a || a.tokenId === undefined) continue;
          const tx = log.transactionHash ?? "";
          rows.push({
            key: `sale-${tx}-${log.logIndex}`,
            kind: "sale",
            title: `Card Purchased`,
            detail: `Token #${a.tokenId} sold for ${usd(fromUsdcUnits(a.price ?? BigInt(0)), { cents: true })} to ${shortHash(a.buyer)} (0% platform fee)`,
            block: log.blockNumber ?? BigInt(0),
            txHash: tx,
            tokenId: a.tokenId.toString(),
          });
        }

        for (const log of listings) {
          const a = log.args as { tokenId?: bigint; seller?: string; price?: bigint };
          if (!a || a.tokenId === undefined) continue;
          const tx = log.transactionHash ?? "";
          rows.push({
            key: `list-${tx}-${log.logIndex}`,
            kind: "listed",
            title: `Listed for Sale`,
            detail: `Token #${a.tokenId} listed at ${usd(fromUsdcUnits(a.price ?? BigInt(0)), { cents: true })} by ${shortHash(a.seller)}`,
            block: log.blockNumber ?? BigInt(0),
            txHash: tx,
            tokenId: a.tokenId.toString(),
          });
        }

        for (const log of cancellations) {
          const a = log.args as { tokenId?: bigint; seller?: string };
          if (!a || a.tokenId === undefined) continue;
          const tx = log.transactionHash ?? "";
          rows.push({
            key: `cancel-${tx}-${log.logIndex}`,
            kind: "cancelled",
            title: `Listing Cancelled`,
            detail: `Token #${a.tokenId} listing was cancelled by ${shortHash(a.seller)}`,
            block: log.blockNumber ?? BigInt(0),
            txHash: tx,
            tokenId: a.tokenId.toString(),
          });
        }

        for (const log of mints) {
          const a = log.args as { tokenId?: bigint; to?: string; certNumber?: string; custodianRef?: string };
          if (!a || a.tokenId === undefined) continue;
          const tx = log.transactionHash ?? "";
          rows.push({
            key: `mint-${tx}-${log.logIndex}`,
            kind: "mint",
            title: `Slab Minted`,
            detail: `Token #${a.tokenId} (Cert #${a.certNumber ?? "—"}) vaulted and minted to ${shortHash(a.to)}`,
            block: log.blockNumber ?? BigInt(0),
            txHash: tx,
            tokenId: a.tokenId.toString(),
          });
        }

        for (const log of redemptions) {
          const a = log.args as { tokenId?: bigint; owner?: string; carrier?: string; trackingNumber?: string };
          if (!a || a.tokenId === undefined) continue;
          const tx = log.transactionHash ?? "";
          rows.push({
            key: `redeem-${tx}-${log.logIndex}`,
            kind: "redeem",
            title: `Redemption Requested`,
            detail: `Token #${a.tokenId} physical delivery requested to ${shortHash(a.owner)}`,
            block: log.blockNumber ?? BigInt(0),
            txHash: tx,
            tokenId: a.tokenId.toString(),
          });
        }

        for (const log of transfers) {
          const a = log.args as { from?: string; to?: string; tokenId?: bigint };
          if (!a || a.tokenId === undefined) continue;
          // Ignore mint transfers (from zero address) since they are covered by SlabMinted
          if (!a.from || a.from === zeroAddress) continue;
          const tx = log.transactionHash ?? "";
          rows.push({
            key: `transfer-${tx}-${log.logIndex}`,
            kind: "transfer",
            title: `Token Transfer`,
            detail: `Token #${a.tokenId} transferred from ${shortHash(a.from)} to ${shortHash(a.to)}`,
            block: log.blockNumber ?? BigInt(0),
            txHash: tx,
            tokenId: a.tokenId.toString(),
          });
        }

        return rows.sort((x, y) => Number(y.block - x.block)).slice(0, 8);
      } catch (err) {
        console.error("Failed to fetch on-chain live events:", err);
        return [];
      }
    },
  });

  if (!events.length) return null;

  return (
    <section className="rounded-card border border-hairline bg-surface p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-hairline pb-3.5">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold">
            <Activity size={18} className="text-accent" />
            Live On-Chain Activity
          </h2>
          <p className="mt-0.5 text-[12.5px] text-muted">
            Real-time mints, marketplace listings, and settled sales from {chain.name}.
          </p>
        </div>
        <span className="flex items-center gap-1.5 rounded-full border border-good/30 bg-good-bg px-2.5 py-1 text-[11px] font-semibold text-good">
          <span className="h-2 w-2 rounded-full bg-good animate-pulse" />
          Live Contract Events
        </span>
      </div>

      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {events.map((e) => {
          const badge =
            e.kind === "sale"
              ? { bg: "bg-good-bg text-good border-good/30", icon: <ShoppingCart size={13} /> }
              : e.kind === "listed"
                ? { bg: "bg-accent/15 text-accent border-accent/30", icon: <Tag size={13} /> }
                : e.kind === "mint"
                  ? { bg: "bg-brand/15 text-brand border-brand/30", icon: <ShieldCheck size={13} /> }
                  : { bg: "bg-surface-2 text-muted border-white/10", icon: <CheckCircle2 size={13} /> };

          return (
            <div
              key={e.key}
              className="flex flex-col justify-between rounded-xl border border-hairline bg-[#101014] p-3.5 transition hover:border-white/20"
            >
              <div>
                <div className="flex items-center justify-between gap-1">
                  <span
                    className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10.5px] font-bold ${badge.bg}`}
                  >
                    {badge.icon}
                    {e.title}
                  </span>
                  <span className="font-mono text-[10px] text-dim">Block #{e.block.toString()}</span>
                </div>
                <p className="mt-2 text-[12px] leading-snug font-medium text-white/90">{e.detail}</p>
              </div>

              <div className="mt-3 flex items-center justify-between border-t border-hairline/60 pt-2 text-[11px] text-dim">
                <CopyText text={e.txHash} title={`tx ${shortHash(e.txHash)}`} />
                {e.tokenId ? (
                  <Link
                    href={`/asset/sub-${e.tokenId}`}
                    className="flex items-center gap-0.5 font-semibold text-accent hover:underline"
                  >
                    View <ArrowRight size={11} />
                  </Link>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
