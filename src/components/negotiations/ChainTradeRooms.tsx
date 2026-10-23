"use client";

import Link from "next/link";
import { ArrowLeftRight } from "lucide-react";
import type { Address } from "viem";
import { useCollectors, useTradeEvents, useTradeOffers } from "@/lib/chain/trades";
import { Avatar, Badge } from "../ui/primitives";

/**
 * The inbox's on-chain section: one trade room per collector, read from the chain, so both sides
 * see the same rooms from their own browsers. Every active account is listed, so a trade can be
 * started with anyone; rooms with offers come first.
 */
export function ChainTradeRooms({ me }: { me: string }) {
  const address = me as Address;
  useTradeEvents(true);
  const { data: collectors = [] } = useCollectors(address);
  const { data: offers = [] } = useTradeOffers(address);

  const rooms = collectors
    .map((c) => {
      const lower = c.address.toLowerCase();
      const withThem = offers.filter((o) => o.maker.toLowerCase() === lower || o.taker.toLowerCase() === lower);
      const yourMove = withThem.filter((o) => o.status === "Open" && o.taker === address).length;
      const waiting = withThem.filter((o) => o.status === "Open" && o.maker === address).length;
      const latest = withThem[0];
      return { ...c, count: withThem.length, yourMove, waiting, latest };
    })
    .sort((a, b) => b.yourMove - a.yourMove || b.count - a.count || a.handle.localeCompare(b.handle));

  return (
    <section>
      <h2 className="mb-1 flex items-center gap-2 text-lg font-bold">
        <ArrowLeftRight size={17} className="text-accent" />
        On-chain trade rooms
      </h2>
      <p className="mb-3 text-[13px] text-muted">
        Swap slabs and cash with another collector, e.g. 3 Pikachus + $50 for 2 Articunos. Offers are locked in the
        TradeEscrow contract and settle in one transaction.
      </p>
      {rooms.length ? (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {rooms.map((r) => (
            <li key={r.address}>
              <Link
                href={`/trades/chain-${r.address}`}
                className="flex items-center gap-3 rounded-card border border-hairline bg-surface p-3 transition hover:bg-white/5"
              >
                <Avatar name={r.handle} size={30} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-bold">@{r.handle}</span>
                  <span className="block truncate text-[11.5px] text-dim">
                    {r.latest ? `Offer #${r.latest.id} · ${r.latest.status}` : "No offers yet · start a trade"}
                  </span>
                </span>
                {r.yourMove ? (
                  <Badge tone="warn">{r.yourMove} to answer</Badge>
                ) : r.waiting ? (
                  <Badge tone="accent">{r.waiting} waiting</Badge>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-card border border-dashed border-hairline p-4 text-[13px] text-muted">
          No other collectors on-chain yet. Open a second account with Hardhat test collector #2 (or use{" "}
          <b className="text-white">Load demo traders</b> in the Chain log panel).
        </p>
      )}
    </section>
  );
}
