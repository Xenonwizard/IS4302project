"use client";

import clsx from "clsx";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Flag, MessagesSquare, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getListing } from "@/lib/catalog";
import { usd } from "@/lib/format";
import { bidValue, lastActivity, latestOffer, offerMix } from "@/lib/negotiation";
import { useStore } from "@/lib/store";
import type { Listing, Negotiation } from "@/lib/types";
import { Slab } from "../slab/Slab";
import { Avatar, Badge, Button, TimeAgo } from "../ui/primitives";
import { reportItemLabel } from "./ReportLostModal";
import { CollectorChats } from "./CollectorChats";

type Tab = "all" | "buying" | "selling";

/** Where a chat's back button returns to: the inbox as the user last left it. */
export const INBOX_URL_KEY = "pokechain.inboxUrl";

/** Inbox of the user's one-to-one negotiations, like Carousell's chats. */
export function NegotiationsInbox() {
  const params = useSearchParams();
  const router = useRouter();
  const { ready, user, negotiations, lostReports, setAuthOpen, slabs, vault } = useStore();
  const [tab, setTab] = useState<Tab>(() => {
    const t = params.get("tab");
    return t === "buying" || t === "selling" ? t : params.get("listing") ? "selling" : "all";
  });
  const [listingFilter, setListingFilter] = useState(params.get("listing"));
  const me = user?.username;

  // Keep the tab and slab filter in the URL, and remember it for the chat's back button.
  useEffect(() => {
    const next = new URLSearchParams();
    if (tab !== "all") next.set("tab", tab);
    if (listingFilter) next.set("listing", listingFilter);
    const url = next.toString() ? `/trades?${next}` : "/trades";
    if (window.location.pathname + window.location.search !== url) router.replace(url, { scroll: false });
    try {
      window.sessionStorage.setItem(INBOX_URL_KEY, url);
    } catch {
      /* storage blocked: back falls through to the default inbox */
    }
  }, [tab, listingFilter, router]);

  const matchingListingIds = useMemo(() => {
    if (!listingFilter) return null;
    const ids = new Set<string>([listingFilter]);
    if (listingFilter.startsWith("token-")) ids.add(listingFilter.replace("token-", ""));
    else if (/^\d+$/.test(listingFilter)) ids.add(`token-${listingFilter}`);

    // Look for target slab across slabs, catalog and vault
    const slab =
      getListing(listingFilter) ||
      slabs.find(
        (s) =>
          s.id === listingFilter ||
          s.tokenId === listingFilter ||
          s.id === `token-${listingFilter}` ||
          (s.tokenId && `token-${s.tokenId}` === listingFilter),
      ) ||
      vault.find(
        (v) =>
          v.listingId === listingFilter ||
          v.token?.tokenId === listingFilter ||
          (v.token?.tokenId && `token-${v.token.tokenId}` === listingFilter),
      );

    if (slab) {
      if ("id" in slab) {
        ids.add(slab.id);
        if (slab.tokenId) {
          ids.add(slab.tokenId);
          ids.add(`token-${slab.tokenId}`);
        }
        if (slab.certNumber) {
          for (const s of slabs) {
            if (s.certNumber === slab.certNumber) {
              ids.add(s.id);
              if (s.tokenId) {
                ids.add(s.tokenId);
                ids.add(`token-${s.tokenId}`);
              }
            }
          }
          for (const v of vault) {
            const vListing = getListing(v.listingId) || slabs.find((s) => s.id === v.listingId);
            if (vListing?.certNumber === slab.certNumber) {
              ids.add(v.listingId);
              if (v.token?.tokenId) {
                ids.add(v.token.tokenId);
                ids.add(`token-${v.token.tokenId}`);
              }
            }
          }
        }
      } else {
        if (slab.listingId) ids.add(slab.listingId);
        if (slab.token?.tokenId) {
          ids.add(slab.token.tokenId);
          ids.add(`token-${slab.token.tokenId}`);
        }
      }
    }
    return ids;
  }, [listingFilter, slabs, vault]);

  if (!ready) {
    return (
      <div className="space-y-6 px-4 py-6 lg:px-6">
        <div className="skeleton h-10 w-48 rounded-xl" />
        <div className="skeleton h-12 w-full rounded-2xl" />
        <div className="skeleton h-[400px] w-full rounded-card" />
      </div>
    );
  }

  if (!me) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-accent/15 text-accent">
          <MessagesSquare size={26} />
        </span>
        <h1 className="text-xl font-bold">Negotiation rooms</h1>
        <p className="max-w-sm text-sm text-muted">
          Log in to see your chats with buyers and sellers.
        </p>
        <Button size="lg" onClick={() => setAuthOpen(true)}>
          Log in
        </Button>
      </div>
    );
  }

  const mine = Object.values(negotiations)
    .filter((n) => n.buyer === me || n.seller === me)
    .sort((a, b) => Date.parse(lastActivity(b)) - Date.parse(lastActivity(a)));
  const shown = mine
    .filter((n) => tab === "all" || (tab === "buying" ? n.buyer === me : n.seller === me))
    .filter((n) => {
      if (!matchingListingIds) return true;
      if (matchingListingIds.has(n.listingId)) return true;
      const nSlab =
        getListing(n.listingId) ||
        slabs.find(
          (s) =>
            s.id === n.listingId ||
            s.tokenId === n.listingId ||
            s.id === `token-${n.listingId}` ||
            (s.tokenId && `token-${s.tokenId}` === n.listingId),
        );
      if (nSlab) {
        if (matchingListingIds.has(nSlab.id)) return true;
        if (nSlab.tokenId && (matchingListingIds.has(nSlab.tokenId) || matchingListingIds.has(`token-${nSlab.tokenId}`))) return true;
      }
      return false;
    });
  const filtered = listingFilter
    ? getListing(listingFilter) ||
      slabs.find(
        (s) =>
          s.id === listingFilter ||
          s.tokenId === listingFilter ||
          s.id === `token-${listingFilter}` ||
          (s.tokenId && `token-${s.tokenId}` === listingFilter),
      ) ||
      (() => {
        const v = vault.find(
          (item) =>
            item.listingId === listingFilter ||
            item.token?.tokenId === listingFilter ||
            (item.token?.tokenId && `token-${item.token.tokenId}` === listingFilter),
        );
        return v ? getListing(v.listingId) || slabs.find((s) => s.id === v.listingId) : undefined;
      })()
    : undefined;

  return (
    <div className="space-y-6 px-4 py-6 lg:px-6">
      <div>
        <h1 className="text-[24px] font-bold">Negotiation rooms</h1>
        <p className="mt-1.5 max-w-2xl text-[14px] text-muted">
          Every offer opens a private chat between the buyer and the seller. Between collectors the chat also carries
          trade offers: slabs and cash both ways, with a balance showing who comes out ahead.
        </p>
      </div>

      {user?.address ? <CollectorChats me={user.address} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        {(["all", "buying", "selling"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={clsx(
              "h-9 rounded-full px-4 text-[13px] font-bold capitalize transition",
              tab === t ? "bg-white text-black" : "bg-surface-2 text-muted hover:text-white",
            )}
          >
            {t}
          </button>
        ))}
        {filtered ? (
          <span className="ml-1 flex items-center gap-1.5 rounded-full bg-accent/15 py-1.5 pl-3 pr-1.5 text-[12px] font-semibold text-accent">
            {filtered.shortName} · {filtered.grader} {filtered.grade}
            <button
              onClick={() => setListingFilter(null)}
              className="grid h-5 w-5 place-items-center rounded-full hover:bg-accent/20"
              aria-label="Show all slabs"
            >
              <X size={12} />
            </button>
          </span>
        ) : null}
      </div>

      {shown.length ? (
        <ul className="divide-y divide-[rgba(255,255,255,0.08)] overflow-hidden rounded-card border border-hairline bg-surface">
          {shown.map((n) => (
            <Row key={n.id} n={n} me={me!} slabs={slabs} />
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-hairline py-16 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-surface text-muted">
            <MessagesSquare size={24} />
          </span>
          <p className="text-base font-bold">No chats yet</p>
          <p className="max-w-sm text-[13px] text-muted">
            {tab === "selling"
              ? "List a slab from your Vault. When buyers make offers, their chats appear here."
              : "Find a slab on the marketplace and make an offer. Your chat with the seller appears here."}
          </p>
          <Link href={tab === "selling" ? "/vault" : "/marketplace"}>
            <Button variant="secondary" className="mt-1">
              {tab === "selling" ? "Go to Vault" : "Browse the marketplace"}
            </Button>
          </Link>
        </div>
      )}

      {lostReports.length ? (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-lg font-bold">
            <Flag size={17} className="text-bad" />
            Lost item reports
          </h2>
          <ul className="divide-y divide-[rgba(255,255,255,0.08)] overflow-hidden rounded-card border border-hairline bg-surface">
            {lostReports.map((r) => {
              const n = negotiations[r.negotiationId];
              const listing = n ? getListing(n.listingId) : undefined;
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-3 p-4 text-[13px]">
                  <span className="font-mono font-bold">{r.id}</span>
                  <Link href={`/trades/${r.negotiationId}`} className="min-w-0 flex-1 truncate font-semibold hover:underline">
                    {listing?.title ?? "Deal"}
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

function Row({ n, me, slabs }: { n: Negotiation; me: string; slabs: Listing[] }) {
  const listing =
    getListing(n.listingId) ||
    slabs.find(
      (s) =>
        s.id === n.listingId ||
        s.tokenId === n.listingId ||
        s.id === `token-${n.listingId}` ||
        (s.tokenId && `token-${s.tokenId}` === n.listingId),
    );
  if (!listing) return null;
  const iAmBuyer = n.buyer === me;
  const other = iAmBuyer ? n.seller : n.buyer;
  const last = n.messages.at(-1);
  const offer = latestOffer(n);
  const preview =
    last?.kind === "trade" && last.trade
      ? `${last.from === me ? "You" : last.from} offered a trade (#${last.trade.offerId})`
      : last?.kind === "offer" && last.offer
      ? `${last.from === me ? "You" : last.from} offered ${usd(bidValue(last.offer), { cents: true })} (${offerMix(last.offer)})`
      : last?.kind === "system"
        ? last.text
        : `${last?.from === me ? "You: " : ""}${last?.text ?? ""}`;
  const badge =
    n.status === "sold"
      ? { tone: "good" as const, label: n.buyer === me ? "Bought" : "Sold" }
      : n.status === "closed"
        ? { tone: "neutral" as const, label: "Closed" }
        : last?.kind === "trade"
          ? { tone: "accent" as const, label: last.from === me ? "Trade sent" : "Trade to review" }
        : offer?.status === "pending"
          ? { tone: "accent" as const, label: iAmBuyer ? "Offer sent" : "Offer to review" }
          : { tone: "neutral" as const, label: "Open" };

  return (
    <li>
      <Link href={`/trades/${n.id}`} className="flex items-center gap-4 p-4 transition hover:bg-white/5">
        <span className="relative w-11 shrink-0">
          <Slab listing={listing} flat />
          <Avatar name={other} size={20} className="absolute -bottom-1 -right-1 ring-2 ring-[#16161a]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[13px] font-bold">{other}</span>
            <span className="shrink-0 text-[11px] text-dim">{iAmBuyer ? "Seller" : "Buyer"}</span>
          </span>
          <span className="block truncate text-[12px] font-medium text-white/80">{listing.title}</span>
          <span className="mt-0.5 block truncate text-[12px] text-muted">{preview}</span>
        </span>
        <span className="hidden shrink-0 flex-col items-end gap-1.5 sm:flex">
          <span className="text-[11px] text-dim">
            <TimeAgo value={lastActivity(n)} />
          </span>
          <Badge tone={badge.tone}>{badge.label}</Badge>
        </span>
      </Link>
    </li>
  );
}
