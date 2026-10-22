"use client";

import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import type { Address } from "viem";
import { usePublicClient } from "wagmi";
import { DEPLOY_BLOCK, contracts, fromUsdcUnits, shortHash } from "@/lib/chain/config";
import { usd } from "@/lib/format";
import { CopyText } from "./ChainConsole";
import { Fn } from "./ui";

interface Row {
  key: string;
  contract: string;
  event: string;
  detail: string;
  block: bigint;
  tx: string;
}

/**
 * The account's history, read from the chain itself: `eth_getLogs` over both contracts,
 * filtered on the indexed `account` / `owner` topic. The chain is the database here: there is
 * no Pokechain server keeping this list, and anyone with the address can rebuild it.
 */
export function ChainHistory({ address }: { address: Address }) {
  const client = usePublicClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["chain-history", address],
    enabled: Boolean(client),
    refetchInterval: 10_000,
    queryFn: async (): Promise<Row[]> => {
      const from = { fromBlock: DEPLOY_BLOCK };
      const [accountEvents, vaultEvents] = await Promise.all([
        Promise.all(
          (["AccountOpened", "Deposited", "Withdrawn", "AccountClosed"] as const).map((eventName) =>
            client!.getContractEvents({ ...contracts.accounts, eventName, args: { account: address }, ...from }),
          ),
        ),
        Promise.all(
          ([
            "SubmissionRequested",
            "SlabMinted",
            "RedemptionRequested",
            "SlabShipped",
            "SlabDelivered",
            "SlabReportedLost",
            "LostReportResolved",
          ] as const).map((eventName) =>
            client!.getContractEvents({ ...contracts.slabVault, eventName, args: { owner: address }, ...from }),
          ),
        ),
      ]);
      const rows: Row[] = [];
      for (const log of accountEvents.flat()) {
        const a = log.args as Record<string, unknown>;
        const detail =
          log.eventName === "AccountOpened"
            ? `@${a.handle}`
            : log.eventName === "AccountClosed"
              ? `refunded ${usd(fromUsdcUnits(a.refunded as bigint), { cents: true })}`
              : `${usd(fromUsdcUnits(a.amount as bigint), { cents: true })} · balance ${usd(fromUsdcUnits(a.newBalance as bigint), { cents: true })}`;
        rows.push({ key: `${log.transactionHash}-${log.logIndex}`, contract: "AccountRegistry", event: log.eventName, detail, block: log.blockNumber, tx: log.transactionHash });
      }
      for (const log of vaultEvents.flat()) {
        const a = log.args as Record<string, unknown>;
        const detail =
          log.eventName === "SubmissionRequested"
            ? `submission #${a.submissionId} · ${a.grader} ${a.certNumber}`
            : log.eventName === "SlabMinted"
              ? `token #${a.tokenId} · cert ${a.certNumber} · Solana ${String(a.custodianRef).slice(0, 8)}…`
              : log.eventName === "SlabShipped"
                ? `token #${a.tokenId} · ${a.carrier} ${a.trackingNumber}`
                : log.eventName === "SlabReportedLost"
                  ? `token #${a.tokenId} · tracking ${a.trackingNumber}`
                  : `token #${a.tokenId}`;
        rows.push({ key: `${log.transactionHash}-${log.logIndex}`, contract: "SlabVault", event: log.eventName, detail, block: log.blockNumber, tx: log.transactionHash });
      }
      return rows.sort((x, y) => Number(y.block - x.block));
    },
  });

  return (
    <section className="rounded-card border border-hairline bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-4 py-3">
        <h2 className="flex items-center gap-2 text-[14px] font-bold">
          <History size={15} /> On-chain history
        </h2>
        <p className="text-[11px] text-dim">
          <Fn>eth_getLogs</Fn> on both contracts, filtered by your address · from block {DEPLOY_BLOCK.toString()}
        </p>
      </header>
      {isLoading ? (
        <p className="px-4 py-6 text-[13px] text-muted">Reading events…</p>
      ) : error ? (
        <p className="px-4 py-6 text-[13px] text-bad">{(error as Error).message}</p>
      ) : data?.length ? (
        <ul className="divide-y divide-[rgba(255,255,255,0.08)]">
          {data.map((r) => (
            <li key={r.key} className="grid grid-cols-[1fr_auto] gap-3 px-4 py-3 text-[12.5px]">
              <div className="min-w-0">
                <p className="font-semibold">
                  <span className="text-dim">{r.contract}.</span>
                  {r.event}
                </p>
                <p className="mt-0.5 truncate text-muted">{r.detail}</p>
              </div>
              <div className="text-right text-[11px] text-dim">
                <p>block {r.block.toString()}</p>
                <CopyText text={r.tx} title={`tx ${shortHash(r.tx)}`} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-6 text-[13px] text-muted">No events for this address yet.</p>
      )}
    </section>
  );
}
