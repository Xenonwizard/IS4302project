"use client";

import clsx from "clsx";
import Link from "next/link";
import { Check, Flag, Gavel, MessageSquare, Send, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getListing } from "@/lib/catalog";
import { usd } from "@/lib/format";
import { useStore } from "@/lib/store";
import { bidValue, bidders, messageId, nextBotEvent, topBid } from "@/lib/trade";
import type { Listing, TradeMessage, TradeRoom } from "@/lib/types";
import { Slab } from "../slab/Slab";
import { Avatar, Badge, Button, Countdown, TimeAgo, inputClass } from "../ui/primitives";
import { ReportLostModal, reportItemLabel } from "./ReportLostModal";

export function TradeRoomView({ listing: base }: { listing: Listing }) {
  const {
    ready,
    user,
    trades,
    resolve,
    isOwned,
    openTradeRoom,
    postTradeMessage,
    placeBid,
    settleTrade,
    requireAuth,
    lostReports,
  } = useStore();
  const listing = resolve(base);
  const room = trades[listing.id];
  const me = user?.username ?? "";
  const iAmSeller = Boolean(user && room && room.seller === me);
  const iOwnIt = isOwned(listing.id);
  const [typing, setTyping] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);

  // Seed the room once stored state has hydrated, so the seed is not overwritten.
  useEffect(() => {
    if (ready && !room) openTradeRoom(listing.id);
  }, [ready, room, listing.id, openTradeRoom]);

  useCrowd(room, listing, me, iAmSeller, setTyping, postTradeMessage, settleTrade);

  const scrollRef = useRef<HTMLDivElement>(null);
  const count = room?.messages.length ?? 0;
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [count, typing]);

  if (!room) {
    return (
      <div className="px-4 py-5 lg:px-6">
        <div className="skeleton h-[70vh] rounded-card" />
      </div>
    );
  }

  const top = topBid(room);
  const reports = lostReports.filter((r) => r.roomId === room.id);
  const people = bidders(room);
  const winningBid = room.messages.find((m) => m.id === room.settledBidId);

  return (
    <div className="px-4 py-5 lg:px-6">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        {/* ---------------- chat ---------------- */}
        <section className="flex h-[calc(100vh-150px)] min-h-[520px] flex-col overflow-hidden rounded-card border border-hairline bg-surface">
          <header className="flex flex-wrap items-center gap-3 border-b border-hairline px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-bold">
                {room.status === "live" ? (
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-good opacity-60" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-good" />
                  </span>
                ) : null}
                <span className="truncate">Trade room · {listing.shortName}</span>
              </p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[12px] text-muted">
                <span className="flex items-center gap-1">
                  <Users size={12} /> {people.length} bidder{people.length === 1 ? "" : "s"}
                </span>
                {room.status === "live" ? (
                  <span>
                    Closes in <Countdown to={room.closesAt} className="font-semibold text-white" />
                  </span>
                ) : (
                  <span className="font-semibold text-good">Settled</span>
                )}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => requireAuth(() => setReportOpen(true)) && setReportOpen(true)}
            >
              <Flag size={14} />
              Report lost
            </Button>
          </header>

          <div ref={scrollRef} className="cy-scroll flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {room.messages.map((m) => (
              <MessageRow
                key={m.id}
                message={m}
                room={room}
                me={me}
                isTop={m.id === top?.id}
                canAccept={iAmSeller && room.status === "live"}
                onAccept={() => settleTrade(room.id, m.id)}
              />
            ))}
            {typing ? (
              <p className="flex items-center gap-2 pl-10 text-[12px] text-dim">
                <span className="flex gap-0.5">
                  <Dot delay="0ms" />
                  <Dot delay="150ms" />
                  <Dot delay="300ms" />
                </span>
                {typing} is typing…
              </p>
            ) : null}
          </div>

          {room.status === "settled" ? (
            <div className="space-y-3 border-t border-hairline p-4">
              <p className="text-[13px] text-muted">
                <span className="font-semibold text-white">{room.winner}</span> won this trade
                {winningBid?.bid ? ` with ${usd(bidValue(winningBid.bid))}` : ""}. If a slab or
                payment from this trade went missing, file a lost item report.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => requireAuth(() => setReportOpen(true)) && setReportOpen(true)}
                >
                  <Flag size={14} />
                  Report lost
                </Button>
                {iOwnIt ? (
                  <Button size="sm" variant="secondary" onClick={() => openTradeRoom(listing.id, true)}>
                    Open a new room as seller
                  </Button>
                ) : null}
              </div>
            </div>
          ) : user ? (
            iOwnIt && !iAmSeller ? (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline p-4 text-[13px] text-muted">
                You own this slab now, so this old room is stale.
                <Button size="sm" variant="secondary" onClick={() => openTradeRoom(listing.id, true)}>
                  Open a new room as seller
                </Button>
              </div>
            ) : (
              <Composer
                room={room}
                listing={listing}
                iAmSeller={iAmSeller}
                onText={(text) =>
                  postTradeMessage(room.id, {
                    id: messageId(),
                    from: me,
                    at: new Date().toISOString(),
                    kind: "text",
                    text,
                  })
                }
                onBid={(bid) => placeBid(room.id, bid)}
              />
            )
          ) : (
            <div className="flex items-center justify-between gap-3 border-t border-hairline p-4">
              <p className="text-[13px] text-muted">Sign in to chat and bid in this room.</p>
              <Button size="sm" onClick={() => requireAuth()}>
                Sign in
              </Button>
            </div>
          )}
        </section>

        {/* ---------------- slab + facts ---------------- */}
        <aside className="space-y-4">
          <div className="rounded-card border border-hairline bg-[#0c0c10] p-6">
            <div className="mx-auto w-[62%] max-w-[230px]">
              <Slab listing={listing} interactive sizes="240px" />
            </div>
          </div>
          <div className="rounded-card border border-hairline bg-surface p-4">
            <Link href={`/asset/${listing.id}`} className="text-[14px] font-bold leading-snug hover:underline">
              {listing.title}
            </Link>
            <p className="mt-2 flex items-center gap-2 text-[12px] text-muted">
              Seller
              <Avatar name={room.seller} size={16} />
              <span className="font-semibold text-white">{room.seller}</span>
              {iAmSeller ? <Badge tone="accent">You</Badge> : null}
            </p>
            <dl className="mt-4 space-y-2.5 text-[13px]">
              <Fact label="Asking" value={usd(listing.price)} />
              <Fact label="Market value" value={usd(listing.fmv)} />
              <Fact label="Top bid" value={top?.bid ? `${usd(bidValue(top.bid))} · ${top.from}` : "None yet"} />
            </dl>
          </div>

          <div className="rounded-card border border-hairline bg-surface p-4 text-[12px] leading-relaxed text-muted">
            <p className="mb-2 text-[13px] font-bold text-white">How the room works</p>
            <ul className="list-disc space-y-1 pl-4">
              <li>Bids are binding. Mix cash with slabs from your vault.</li>
              <li>The owner can accept any bid before the room closes.</li>
              <li>On accept, the token moves on-chain and the vault updates custody.</li>
              <li>Something missing after a trade? Use Report lost.</li>
            </ul>
          </div>

          {reports.length ? (
            <div className="rounded-card border border-hairline bg-surface p-4">
              <p className="mb-3 text-[13px] font-bold">Lost item reports</p>
              <ul className="space-y-2">
                {reports.map((r) => (
                  <li key={r.id} className="rounded-xl bg-surface-2 p-3 text-[12px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-bold">{r.id}</span>
                      <Badge tone="warn">{r.status}</Badge>
                    </div>
                    <p className="mt-1.5 text-muted">
                      {reportItemLabel(r.item)} · filed <TimeAgo value={r.filedAt} />
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </aside>
      </div>

      <ReportLostModal room={room} open={reportOpen} onClose={() => setReportOpen(false)} />
    </div>
  );
}

/**
 * Drives the simulated crowd: every few seconds someone types, then bids or chats.
 * Reads the latest room through refs so the timer chain survives re-renders.
 */
function useCrowd(
  room: TradeRoom | undefined,
  listing: Listing,
  me: string,
  iAmSeller: boolean,
  setTyping: (name: string | null) => void,
  post: (roomId: string, m: TradeMessage) => void,
  settle: (roomId: string, bidId: string, note?: string) => void,
) {
  const latest = useRef({ room, listing, me, iAmSeller });
  useEffect(() => {
    latest.current = { room, listing, me, iAmSeller };
  });

  const roomId = room?.id;
  const live = room?.status === "live";
  useEffect(() => {
    if (!roomId || !live) return;
    let wait = 0;
    let type = 0;
    const loop = (delay: number) => {
      wait = window.setTimeout(() => {
        const cur = latest.current;
        if (!cur.room || cur.room.status !== "live" || document.hidden) return loop(4000);
        const ev = nextBotEvent(cur.room, cur.listing, cur.me, cur.iAmSeller);
        if (!ev) return loop(6000);
        setTyping(ev.type === "accept" ? ev.from : ev.message.from);
        type = window.setTimeout(() => {
          setTyping(null);
          if (ev.type === "accept") settle(roomId, ev.bidId, ev.text);
          else post(roomId, ev.message);
          loop(4500 + Math.random() * 7000);
        }, 1300 + Math.random() * 900);
      }, delay);
    };
    loop(2500);
    return () => {
      window.clearTimeout(wait);
      window.clearTimeout(type);
      setTyping(null);
    };
  }, [roomId, live, post, settle, setTyping]);
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="h-1.5 w-1.5 animate-bounce rounded-full bg-dim"
      style={{ animationDelay: delay }}
    />
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="truncate font-semibold">{value}</dd>
    </div>
  );
}

function MessageRow({
  message: m,
  room,
  me,
  isTop,
  canAccept,
  onAccept,
}: {
  message: TradeMessage;
  room: TradeRoom;
  me: string;
  isTop: boolean;
  canAccept: boolean;
  onAccept: () => void;
}) {
  if (m.kind === "system") {
    return (
      <p className="mx-auto max-w-md rounded-full bg-surface-2 px-3 py-1.5 text-center text-[11px] font-medium text-muted">
        {m.text}
      </p>
    );
  }
  const mine = m.from === me;
  const seller = m.from === room.seller;

  return (
    <div className={clsx("flex gap-2.5", mine && "flex-row-reverse")}>
      {!mine ? <Avatar name={m.from} size={28} className="mt-5" /> : null}
      <div className={clsx("min-w-0 max-w-[80%]", mine && "items-end text-right")}>
        <p className={clsx("mb-1 flex items-center gap-1.5 text-[11px] text-dim", mine && "justify-end")}>
          <span className="font-semibold text-muted">{mine ? "You" : m.from}</span>
          {seller ? <Badge tone="accent">Owner</Badge> : null}
          <TimeAgo value={m.at} />
        </p>
        {m.kind === "text" ? (
          <p
            className={clsx(
              "inline-block rounded-2xl px-3.5 py-2 text-left text-[13px] leading-relaxed",
              mine ? "rounded-tr-md bg-accent text-white" : "rounded-tl-md bg-surface-2",
            )}
          >
            {m.text}
          </p>
        ) : m.bid ? (
          <BidCard bid={m} isTop={isTop} mine={mine} canAccept={canAccept} onAccept={onAccept} />
        ) : null}
      </div>
    </div>
  );
}

function BidCard({
  bid: m,
  isTop,
  mine,
  canAccept,
  onAccept,
}: {
  bid: TradeMessage;
  isTop: boolean;
  mine: boolean;
  canAccept: boolean;
  onAccept: () => void;
}) {
  const bid = m.bid!;
  const slabs = bid.slabIds.map((id) => getListing(id)).filter((l): l is Listing => Boolean(l));
  return (
    <div
      className={clsx(
        "inline-block min-w-[220px] rounded-2xl border p-3 text-left",
        m.accepted
          ? "border-good/50 bg-good-bg"
          : isTop
            ? "border-accent/60 bg-accent/10"
            : "border-hairline bg-surface-2",
        mine ? "rounded-tr-md" : "rounded-tl-md",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted">
          <Gavel size={12} /> Bid
        </span>
        {m.accepted ? (
          <Badge tone="good">
            <Check size={11} /> Accepted
          </Badge>
        ) : isTop ? (
          <Badge tone="accent">Top bid</Badge>
        ) : null}
      </div>
      <p className="mt-1 text-[20px] font-bold leading-tight">{usd(bidValue(bid))}</p>
      <p className="text-[12px] text-muted">
        {usd(bid.cash)} cash{slabs.length ? ` + ${slabs.length} slab${slabs.length === 1 ? "" : "s"}` : ""}
      </p>
      {slabs.length ? (
        <ul className="mt-2 space-y-1.5">
          {slabs.map((s) => (
            <li key={s.id} className="flex items-center gap-2">
              <span className="w-7 shrink-0">
                <Slab listing={s} flat />
              </span>
              <Link href={`/asset/${s.id}`} className="min-w-0 truncate text-[12px] font-semibold hover:underline">
                {s.shortName} · {s.grader} {s.grade}
              </Link>
              <span className="ml-auto shrink-0 text-[11px] text-muted">{usd(s.fmv)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {canAccept && !m.accepted ? (
        <Button size="sm" className="mt-3 w-full" onClick={onAccept}>
          Accept bid
        </Button>
      ) : null}
    </div>
  );
}

function Composer({
  room,
  listing,
  iAmSeller,
  onText,
  onBid,
}: {
  room: TradeRoom;
  listing: Listing;
  iAmSeller: boolean;
  onText: (text: string) => void;
  onBid: (bid: { cash: number; slabIds: string[] }) => boolean;
}) {
  const { vault, user, resolve } = useStore();
  const [mode, setMode] = useState<"chat" | "bid">(iAmSeller ? "chat" : "bid");
  const [text, setText] = useState("");
  const [cash, setCash] = useState("");
  const [picked, setPicked] = useState<string[]>([]);

  const top = topBid(room);
  const topValue = top?.bid ? bidValue(top.bid) : 0;
  const mySlabs = useMemo(
    () =>
      vault
        .filter((v) => v.status === "Vaulted" && v.listingId !== listing.id)
        .map((v) => getListing(v.listingId))
        .filter((l): l is Listing => Boolean(l))
        .map(resolve),
    [vault, listing.id, resolve],
  );
  const total = bidValue({ cash: Number(cash) || 0, slabIds: picked });
  const tooLow = total <= topValue;

  const suggest = (n: number) => setCash(String(Math.max(0, Math.round((n - (total - (Number(cash) || 0))) * 100) / 100)));

  return (
    <div className="border-t border-hairline">
      {!iAmSeller ? (
        <div className="flex gap-1 px-4 pt-3">
          {(
            [
              ["bid", "Place bid", <Gavel key="g" size={13} />],
              ["chat", "Message", <MessageSquare key="m" size={13} />],
            ] as const
          ).map(([value, label, icon]) => (
            <button
              key={value}
              onClick={() => setMode(value)}
              className={clsx(
                "flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12px] font-bold transition",
                mode === value ? "bg-surface-3 text-white" : "text-muted hover:text-white",
              )}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {mode === "chat" ? (
        <form
          className="flex gap-2 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return;
            onText(text.trim());
            setText("");
          }}
        >
          <input
            className={inputClass}
            placeholder={iAmSeller ? "Reply to bidders… accept a bid from the chat above" : "Ask about the slab…"}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <Button type="submit" aria-label="Send">
            <Send size={16} />
          </Button>
        </form>
      ) : (
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-[160px] flex-1">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
              <input
                className={`${inputClass} pl-7 font-bold`}
                inputMode="decimal"
                placeholder="Cash"
                value={cash}
                onChange={(e) => setCash(e.target.value.replace(/[^\d.]/g, ""))}
              />
            </div>
            {[
              ["Top +5%", topValue ? topValue * 1.05 : listing.price * 0.8],
              ["Market", listing.fmv],
              ["Ask", listing.price],
            ].map(([label, n]) => (
              <button
                key={label as string}
                type="button"
                onClick={() => suggest(n as number)}
                className="h-11 rounded-xl bg-surface-2 px-3 text-[12px] font-semibold text-muted transition hover:bg-surface-3 hover:text-white"
              >
                {label}
              </button>
            ))}
          </div>

          {mySlabs.length ? (
            <div>
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-dim">
                Add slabs from your vault
              </p>
              <div className="cy-scroll flex gap-2 overflow-x-auto pb-1">
                {mySlabs.map((l) => {
                  const on = picked.includes(l.id);
                  return (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() =>
                        setPicked((p) => (p.includes(l.id) ? p.filter((x) => x !== l.id) : [...p, l.id]))
                      }
                      className={clsx(
                        "flex w-[150px] shrink-0 items-center gap-2 rounded-xl border p-2 text-left transition",
                        on ? "border-accent bg-accent/10" : "border-hairline bg-surface-2 hover:bg-surface-3",
                      )}
                    >
                      <span className="w-7 shrink-0">
                        <Slab listing={l} flat />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[11px] font-semibold">{l.shortName}</span>
                        <span className="block text-[11px] text-muted">{usd(l.fmv)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[12px] text-muted">
              Bid value <span className="text-[15px] font-bold text-white">{usd(total)}</span>
              {user ? <> · balance {usd(user.balance)}</> : null}
              {topValue && tooLow && total > 0 ? (
                <span className="ml-2 text-warn">Must beat {usd(topValue)}</span>
              ) : null}
            </p>
            <Button
              disabled={total <= 0 || tooLow}
              onClick={() => {
                if (onBid({ cash: Number(cash) || 0, slabIds: picked })) {
                  setCash("");
                  setPicked([]);
                }
              }}
            >
              <Gavel size={15} />
              Post bid
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
