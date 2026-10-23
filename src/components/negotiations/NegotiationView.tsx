"use client";

import clsx from "clsx";
import Link from "next/link";
import { ArrowLeft, Check, Flag, Gavel, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BRAND } from "@/lib/brand";
import { getListing } from "@/lib/catalog";
import { usd } from "@/lib/format";
import { bidValue, offerMix, pendingOffer } from "@/lib/negotiation";
import { sellerFee, useStore } from "@/lib/store";
import type { ChatMessage, Listing, Negotiation, OfferStatus } from "@/lib/types";
import { OfferModal } from "../modals/OfferModal";
import { Slab } from "../slab/Slab";
import { Avatar, Badge, Button, TimeAgo, inputClass } from "../ui/primitives";
import { INBOX_URL_KEY } from "./NegotiationsInbox";
import { ReportLostModal, reportItemLabel } from "./ReportLostModal";

const exact = (n: number) => usd(n, { cents: true });

const BUYER_QUICK = ["Is this still available?", "Any flaws on the slab?", "Is the price negotiable?"];
const SELLER_QUICK = ["Yes, it's available.", "Price is firm, sorry.", "Can you go a bit higher?"];

/** A one-to-one chat between a buyer and the seller about one listing. */
export function NegotiationView({ id }: { id: string }) {
  const { ready, user, negotiations, requireAuth } = useStore();
  const n = negotiations[id];
  const base = n ? getListing(n.listingId) : undefined;

  if (!ready) {
    return (
      <div className="px-4 py-5 lg:px-6">
        <div className="skeleton h-[70vh] rounded-card" />
      </div>
    );
  }
  if (!user || !n || !base) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-xl font-bold">{user ? "Chat not found" : "Log in to see this chat"}</h1>
        <p className="max-w-sm text-sm text-muted">
          {user
            ? "This negotiation does not exist or belongs to another account."
            : "Negotiations are private between the buyer and the seller."}
        </p>
        {user ? (
          <Link href="/trades">
            <Button size="lg">Back to negotiations</Button>
          </Link>
        ) : (
          <Button size="lg" onClick={() => requireAuth()}>
            Log in
          </Button>
        )}
      </div>
    );
  }
  return <Chat negotiation={n} base={base} me={user.username} />;
}

function Chat({ negotiation: n, base, me }: { negotiation: Negotiation; base: Listing; me: string }) {
  const { resolve, sendMessage, respondToOffer, withdrawOffer, lostReports } = useStore();
  const listing = resolve(base);
  const iAmBuyer = n.buyer === me;
  const other = iAmBuyer ? n.seller : n.buyer;
  const pending = pendingOffer(n);
  const [text, setText] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const reports = lostReports.filter((r) => r.negotiationId === n.id);
  const [backHref] = useState(() => {
    try {
      return window.sessionStorage.getItem(INBOX_URL_KEY) ?? "/trades";
    } catch {
      return "/trades";
    }
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  const count = n.messages.length;
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [count]);

  const sendingRef = useRef(false);
  const send = (value: string) => {
    if (!value.trim() || sendingRef.current) return;
    sendingRef.current = true;
    sendMessage(n.id, value.trim());
    setText("");
    setTimeout(() => {
      sendingRef.current = false;
    }, 400);
  };

  return (
    <div className="px-4 py-5 lg:px-6">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="flex h-[calc(100dvh-230px)] min-h-[480px] flex-col lg:h-[calc(100vh-150px)] overflow-hidden rounded-card border border-hairline bg-surface">
          {/* who you are talking to */}
          <header className="flex items-center gap-3 border-b border-hairline px-4 py-3">
            <Link href={backHref} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-white/5 hover:text-white" aria-label="Back to negotiations">
              <ArrowLeft size={17} />
            </Link>
            <Avatar name={other} size={34} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold">{other}</p>
              <p className="text-[12px] text-muted">{iAmBuyer ? "Seller" : "Buyer"} · only you two see this chat</p>
            </div>
            {n.status === "sold" ? (
              <Button size="sm" variant="outline" onClick={() => setReportOpen(true)}>
                <Flag size={14} />
                Report lost
              </Button>
            ) : null}
          </header>

          {/* the listing and the offer on the table */}
          <div className="flex flex-wrap items-center gap-3 border-b border-hairline bg-surface-2/50 px-4 py-3">
            <Link href={`/asset/${listing.id}`} className="w-10 shrink-0">
              <Slab listing={listing} flat />
            </Link>
            <div className="min-w-0 flex-1">
              <Link href={`/asset/${listing.id}`} className="line-clamp-1 text-[13px] font-semibold hover:underline">
                {listing.title}
              </Link>
              <p className="text-[12px] text-muted">
                Asking {exact(listing.price)} · market value {exact(listing.fmv)}
              </p>
            </div>
            <OfferBar
              n={n}
              iAmBuyer={iAmBuyer}
              pending={pending}
              onEdit={() => setEditOpen(true)}
              onWithdraw={() => pending && withdrawOffer(n.id, pending.id)}
              onAccept={() => pending && respondToOffer(n.id, pending.id, true)}
              onDecline={() => pending && respondToOffer(n.id, pending.id, false)}
            />
          </div>

          <div ref={scrollRef} className="cy-scroll flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {n.messages.map((m) => (
              <MessageRow key={m.id} message={m} me={me} />
            ))}
          </div>

          {n.status === "open" ? (
            <div className="border-t border-hairline p-3">
              <div className="no-scrollbar mb-2 flex gap-2 overflow-x-auto">
                {(iAmBuyer ? BUYER_QUICK : SELLER_QUICK).map((q) => (
                  <button
                    key={q}
                    onClick={() => send(q)}
                    className="shrink-0 rounded-full border border-hairline px-3 py-1.5 text-[12px] font-medium text-muted transition hover:bg-white/5 hover:text-white"
                  >
                    {q}
                  </button>
                ))}
              </div>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  send(text);
                }}
              >
                <input
                  className={inputClass}
                  placeholder={`Message ${other}…`}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
                <Button type="submit" aria-label="Send">
                  <Send size={16} />
                </Button>
              </form>
            </div>
          ) : (
            <p className="border-t border-hairline p-4 text-center text-[13px] text-muted">
              {n.status === "sold" ? "Deal done. This chat is now read-only." : "This chat is closed."}
            </p>
          )}
        </section>

        <aside className="space-y-4">
          <div className="rounded-card border border-hairline bg-[#0c0c10] p-6">
            <div className="mx-auto w-[62%] max-w-[220px]">
              <Slab listing={listing} interactive sizes="240px" />
            </div>
          </div>
          <div className="rounded-card border border-hairline bg-surface p-4 text-[12px] leading-relaxed text-muted">
            <p className="mb-2 text-[13px] font-bold text-white">How negotiating works</p>
            <ul className="list-disc space-y-1 pl-4">
              <li>Offers are full cash, or slabs from your vault plus a cash top-up.</li>
              <li>The seller accepts or declines. The buyer can edit or cancel a pending offer.</li>
              <li>On accept the token moves on-chain and the vault updates custody. Nothing ships.</li>
              <li>The seller pays a {BRAND.sellerFee * 100}% fee on the cash part only.</li>
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

      <OfferModal listing={listing} open={editOpen} onClose={() => setEditOpen(false)} editing />
      <ReportLostModal negotiation={n} open={reportOpen} onClose={() => setReportOpen(false)} />
    </div>
  );
}

/** The current offer and the buttons that act on it, Carousell-style. */
function OfferBar({
  n,
  iAmBuyer,
  pending,
  onEdit,
  onWithdraw,
  onAccept,
  onDecline,
}: {
  n: Negotiation;
  iAmBuyer: boolean;
  pending?: ChatMessage;
  onEdit: () => void;
  onWithdraw: () => void;
  onAccept: () => void;
  onDecline: () => void;
}) {
  if (n.status === "sold") return <Badge tone="good">Deal done</Badge>;
  if (n.status === "closed") return <Badge tone="neutral">Closed</Badge>;

  if (iAmBuyer) {
    return pending ? (
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" onClick={onEdit}>
          Edit offer
        </Button>
        <Button size="sm" variant="outline" onClick={onWithdraw}>
          Cancel offer
        </Button>
      </div>
    ) : (
      <Button size="sm" onClick={onEdit}>
        <Gavel size={14} />
        Make offer
      </Button>
    );
  }

  if (!pending?.offer) return <span className="text-[12px] text-dim">Waiting for an offer</span>;
  const { cash, slabIds } = pending.offer;
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={onDecline}>
          Decline
        </Button>
        <Button size="sm" onClick={onAccept}>
          Accept {exact(bidValue(pending.offer))}
        </Button>
      </div>
      <p className="text-[11px] text-dim">
        You receive {exact(cash - sellerFee(cash))} cash
        {slabIds.length ? ` + ${slabIds.length} slab${slabIds.length === 1 ? "" : "s"}` : ""} after the{" "}
        {BRAND.sellerFee * 100}% fee
      </p>
    </div>
  );
}

const STATUS_LABEL: Record<OfferStatus, string> = {
  pending: "Pending",
  accepted: "Accepted",
  declined: "Declined",
  withdrawn: "Cancelled",
  replaced: "Replaced",
};

function MessageRow({ message: m, me }: { message: ChatMessage; me: string }) {
  if (m.kind === "system") {
    return (
      <p className="mx-auto max-w-md rounded-full bg-surface-2 px-3 py-1.5 text-center text-[11px] font-medium text-muted">
        {m.text}
      </p>
    );
  }
  const mine = m.from === me;
  return (
    <div className={clsx("flex gap-2.5", mine && "flex-row-reverse")}>
      {!mine ? <Avatar name={m.from} size={28} className="mt-5" /> : null}
      <div className={clsx("min-w-0 max-w-[80%]", mine && "text-right")}>
        <p className={clsx("mb-1 flex items-center gap-1.5 text-[11px] text-dim", mine && "justify-end")}>
          <span className="font-semibold text-muted">{mine ? "You" : m.from}</span>
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
        ) : m.offer ? (
          <OfferCard message={m} mine={mine} />
        ) : null}
      </div>
    </div>
  );
}

function OfferCard({ message: m, mine }: { message: ChatMessage; mine: boolean }) {
  const offer = m.offer!;
  const status = m.status ?? "pending";
  const slabs = offer.slabIds.map((id) => getListing(id)).filter((l): l is Listing => Boolean(l));
  const faded = status === "replaced" || status === "withdrawn" || status === "declined";
  return (
    <div
      className={clsx(
        "inline-block min-w-[230px] rounded-2xl border p-3 text-left",
        status === "accepted" ? "border-good/50 bg-good-bg" : status === "pending" ? "border-accent/60 bg-accent/10" : "border-hairline bg-surface-2",
        mine ? "rounded-tr-md" : "rounded-tl-md",
        faded && "opacity-60",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted">
          <Gavel size={12} /> {mine ? "You offered" : "Offered"}
        </span>
        <Badge tone={status === "accepted" ? "good" : status === "pending" ? "accent" : "neutral"}>
          {status === "accepted" ? <Check size={11} /> : null}
          {STATUS_LABEL[status]}
        </Badge>
      </div>
      <p className={clsx("mt-1 text-[20px] font-bold leading-tight", faded && "line-through")}>
        {exact(bidValue(offer))}
      </p>
      <p className="text-[12px] text-muted">{offerMix(offer)}</p>
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
              <span className="ml-auto shrink-0 text-[11px] text-muted">{exact(s.fmv)}</span>
            </li>
          ))}
          {offer.cash > 0 ? (
            <li className="flex justify-between text-[12px] text-muted">
              <span>Cash top-up</span>
              <span>{exact(offer.cash)}</span>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-dim" style={{ animationDelay: delay }} />
  );
}
