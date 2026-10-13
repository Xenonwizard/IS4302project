"use client";

import Link from "next/link";
import { Flag, MessagesSquare } from "lucide-react";
import { getListing } from "@/lib/catalog";
import { usd } from "@/lib/format";
import { useStore } from "@/lib/store";
import { LIVE_ROOMS, bidValue, topBid } from "@/lib/trade";
import { Slab } from "../slab/Slab";
import { Badge, TimeAgo } from "../ui/primitives";
import { RoomCard } from "./RoomCard";
import { reportItemLabel } from "./ReportLostModal";

export function TradesView() {
  const { trades, user, lostReports } = useStore();
  const me = user?.username;
  const mine = Object.values(trades)
    .filter(
      (r) => me && (r.seller === me || r.winner === me || r.messages.some((m) => m.from === me)),
    )
    .sort((a, b) => Date.parse(b.messages.at(-1)?.at ?? b.openedAt) - Date.parse(a.messages.at(-1)?.at ?? a.openedAt));

  return (
    <div className="space-y-8 px-4 py-6 lg:px-6">
      <div>
        <h1 className="text-[24px] font-bold">Trade rooms</h1>
        <p className="mt-1.5 max-w-2xl text-[14px] text-muted">
          Every slab has a live room. Bid in the chat with cash, slabs from your vault, or both.
          The owner accepts the bid they like and the token settles on-chain.
        </p>
      </div>

      {mine.length ? (
        <section>
          <h2 className="mb-3 text-lg font-bold">Your rooms</h2>
          <ul className="divide-y divide-[rgba(255,255,255,0.08)] overflow-hidden rounded-card border border-hairline bg-surface">
            {mine.map((r) => {
              const listing = getListing(r.listingId);
              if (!listing) return null;
              const last = r.messages.at(-1);
              const top = topBid(r);
              return (
                <li key={r.id}>
                  <Link href={`/trades/${r.id}`} className="flex items-center gap-4 p-4 transition hover:bg-white/5">
                    <span className="w-11 shrink-0">
                      <Slab listing={listing} flat />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-semibold">{listing.title}</span>
                        {r.seller === me ? <Badge tone="accent">Selling</Badge> : null}
                      </span>
                      <span className="mt-1 block truncate text-[12px] text-muted">
                        {last?.from === "system" ? "" : `${last?.from === me ? "You" : last?.from}: `}
                        {last?.kind === "bid" && last.bid ? `bid ${usd(bidValue(last.bid))}` : last?.text}
                      </span>
                    </span>
                    <span className="hidden shrink-0 text-right sm:block">
                      <span className="block text-[13px] font-bold">
                        {top?.bid ? usd(bidValue(top.bid)) : "—"}
                      </span>
                      <span className="block text-[11px] text-dim">top bid</span>
                    </span>
                    <Badge tone={r.status === "live" ? "good" : "neutral"}>
                      {r.status === "live" ? "Live" : r.winner === me ? "Won" : "Settled"}
                    </Badge>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">
          <MessagesSquare size={18} className="text-accent" />
          Live now
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {LIVE_ROOMS.map((l) => (
            <RoomCard key={l.id} listing={l} />
          ))}
        </div>
        <p className="mt-3 text-[12px] text-dim">
          Any slab on the marketplace has a room too: open it from the slab page.
        </p>
      </section>

      {lostReports.length ? (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">
            <Flag size={17} className="text-bad" />
            Lost item reports
          </h2>
          <ul className="divide-y divide-[rgba(255,255,255,0.08)] overflow-hidden rounded-card border border-hairline bg-surface">
            {lostReports.map((r) => {
              const listing = getListing(r.roomId);
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-3 p-4 text-[13px]">
                  <span className="font-mono font-bold">{r.id}</span>
                  <Link href={`/trades/${r.roomId}`} className="min-w-0 flex-1 truncate font-semibold hover:underline">
                    {listing?.title ?? r.roomId}
                  </Link>
                  <span className="text-muted">{reportItemLabel(r.item)}</span>
                  <span className="text-dim">
                    <TimeAgo value={r.filedAt} />
                  </span>
                  <Badge tone="warn">{r.status}</Badge>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
