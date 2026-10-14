"use client";

import clsx from "clsx";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { MessagesSquare, Package, Plus, ShieldCheck, Tag, Truck, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { BRAND } from "@/lib/brand";
import { getListing } from "@/lib/catalog";
import { shortDate, usd } from "@/lib/format";
import { bidValue, pendingOffer } from "@/lib/negotiation";
import { useStore } from "@/lib/store";
import type { Listing, VaultItem } from "@/lib/types";
import { Slab } from "../slab/Slab";
import { Badge, Button, Modal, TimeAgo } from "../ui/primitives";
import { ListForSaleForm } from "./ListForSaleForm";

type Tab = "collection" | "listings" | "watchlist" | "wallet";

const TABS: { value: Tab; label: string }[] = [
  { value: "collection", label: "Collection" },
  { value: "listings", label: "My listings" },
  { value: "watchlist", label: "Watchlist" },
  { value: "wallet", label: "Wallet" },
];

export function VaultView() {
  const params = useSearchParams();
  const {
    user,
    setAuthOpen,
    vault,
    watchlist,
    delist,
    requestShipping,
    resolve,
    negotiations,
    balance,
  } = useStore();
  const [tab, setTab] = useState<Tab>(
    () => TABS.find((t) => t.value === params.get("tab"))?.value ?? "collection",
  );
  const [sellTarget, setSellTarget] = useState<Listing | null>(null);

  const items = useMemo(
    () =>
      vault
        .map((v) => {
          const listing = getListing(v.listingId);
          return listing ? { entry: v, listing: resolve(listing) } : null;
        })
        .filter((x): x is { entry: VaultItem; listing: Listing } => Boolean(x)),
    [vault, resolve],
  );

  const totalValue = items.reduce((sum, i) => sum + i.listing.fmv, 0);
  const listed = items.filter((i) => i.entry.status === "Listed");

  if (!user) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-accent/15 text-accent">
          <ShieldCheck size={26} />
        </span>
        <h1 className="text-xl font-bold">My Slabs</h1>
        <p className="max-w-sm text-sm text-muted">
          Log in to see the slabs you own, your listings and your wallet.
        </p>
        <Button size="lg" onClick={() => setAuthOpen(true)}>
          Log in
        </Button>
      </div>
    );
  }

  return (
    <div className="px-4 py-5 lg:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-bold">My Slabs</h1>
          <p className="mt-1 text-[13px] text-muted">
            Held in the {BRAND.vaultCity} vault, insured at full market value.
          </p>
        </div>
        <Link href="/submit">
          <Button>
            <Plus size={15} />
            Vault a graded slab
          </Button>
        </Link>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Slabs owned" value={String(items.length)} />
        <Stat label="Collection value" value={usd(totalValue)} />
        <Stat label="Listed for sale" value={String(listed.length)} />
        <Stat label="Wallet balance" value={usd(balance, { cents: true })} onClick={() => setTab("wallet")} />
      </div>

      <div className="no-scrollbar mt-6 flex gap-1 overflow-x-auto border-b border-hairline">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={clsx(
              "relative shrink-0 px-4 py-3 text-[13px] font-bold transition",
              tab === t.value ? "text-white" : "text-muted hover:text-white",
            )}
          >
            {t.label}
            {t.value === "listings" && listed.length ? (
              <span className="ml-1.5 rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px]">{listed.length}</span>
            ) : null}
            {tab === t.value ? (
              <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-accent" />
            ) : null}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {tab === "collection" ? (
          items.length ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
              {items.map(({ entry, listing }) => (
                <div
                  key={listing.id}
                  className="overflow-hidden rounded-card border border-hairline bg-surface"
                >
                  <Link href={`/asset/${listing.id}`} className="block bg-[#101014] p-4">
                    <Slab listing={listing} />
                  </Link>
                  <div className="p-3.5">
                    <Link
                      href={`/asset/${listing.id}`}
                      className="line-clamp-2 text-[12px] font-semibold leading-snug hover:underline"
                    >
                      {listing.title}
                    </Link>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-[13px] font-bold">{usd(listing.fmv)}</span>
                      <Badge tone={entry.status === "Listed" ? "accent" : entry.status === "Shipping requested" ? "warn" : "good"}>
                        {entry.status}
                      </Badge>
                    </div>
                    <p className="mt-1.5 text-[11px] text-dim">
                      {entry.via} · <TimeAgo value={entry.acquiredAt} />
                    </p>
                    <div className="mt-3 grid gap-2">
                      {entry.status === "Listed" ? (
                        <Button size="sm" variant="secondary" onClick={() => setTab("listings")}>
                          Manage listing
                        </Button>
                      ) : entry.status === "Vaulted" ? (
                        <Button size="sm" onClick={() => setSellTarget(listing)}>
                          <Tag size={13} />
                          List for sale
                        </Button>
                      ) : null}
                      {entry.status === "Vaulted" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => requestShipping(listing.id)}
                        >
                          <Truck size={13} />
                          Ship to me
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty
              icon={<Package size={24} />}
              title="No slabs yet"
              body="Vault a graded slab you own, or win one with an offer or in a negotiation room. Either way it lands here."
              cta={{ href: "/submit", label: "Vault a graded slab" }}
            />
          )
        ) : null}

        {tab === "listings" ? (
          listed.length ? (
            <ul className="divide-y divide-[rgba(255,255,255,0.08)] overflow-hidden rounded-card border border-hairline bg-surface">
              {listed.map(({ entry, listing }) => {
                const chats = Object.values(negotiations).filter(
                  (n) => n.listingId === listing.id && n.seller === user.username && n.status === "open",
                );
                const offers = chats.map(pendingOffer).filter((m) => m?.offer);
                const best = Math.max(0, ...offers.map((m) => bidValue(m!.offer!)));
                return (
                  <li key={listing.id} className="flex flex-wrap items-center gap-4 p-4">
                    <Link href={`/asset/${listing.id}`} className="w-12 shrink-0">
                      <Slab listing={listing} flat />
                    </Link>
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/asset/${listing.id}`}
                        className="line-clamp-1 text-[13px] font-semibold hover:underline"
                      >
                        {listing.title}
                      </Link>
                      <p className="mt-1 text-[12px] text-muted">
                        Asking {usd(entry.listedPrice ?? listing.price)} · FMV {usd(listing.fmv)}
                      </p>
                      <p className="mt-1 text-[12px] text-muted">
                        {offers.length
                          ? `${offers.length} offer${offers.length === 1 ? "" : "s"} to review · best ${usd(best, { cents: true })}`
                          : chats.length
                            ? `${chats.length} open chat${chats.length === 1 ? "" : "s"}`
                            : "No offers yet. Buyers' offers show up as private chats."}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Link href={`/trades?listing=${listing.id}`}>
                        <Button size="sm">
                          <MessagesSquare size={13} />
                          Negotiation rooms{chats.length ? ` (${chats.length})` : ""}
                        </Button>
                      </Link>
                      <Button size="sm" variant="secondary" onClick={() => delist(listing.id)}>
                        Remove
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Empty
              icon={<Tag size={24} />}
              title="No active listings"
              body="List a slab from your collection. Buyers' offers arrive as private negotiation rooms."
            />
          )
        ) : null}

        {tab === "watchlist" ? (
          watchlist.length ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
              {watchlist.map((id) => {
                const listing = getListing(id);
                if (!listing) return null;
                const resolved = resolve(listing);
                return (
                  <Link
                    key={id}
                    href={`/asset/${id}`}
                    className="overflow-hidden rounded-card border border-hairline bg-surface transition hover:border-white/20"
                  >
                    <div className="bg-[#101014] p-4">
                      <Slab listing={resolved} />
                    </div>
                    <div className="p-3.5">
                      <p className="line-clamp-2 text-[12px] font-semibold leading-snug">
                        {resolved.title}
                      </p>
                      <p className="mt-2 text-[13px] font-bold">{usd(resolved.price)}</p>
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <Empty
              icon={<ShieldCheck size={24} />}
              title="Watchlist is empty"
              body="Tap the heart on any listing to track it here."
              cta={{ href: "/marketplace", label: "Find something" }}
            />
          )
        ) : null}
      </div>

      {tab === "wallet" ? <WalletPanel /> : null}

      {/* list-for-sale modal */}
      <Modal
        open={Boolean(sellTarget)}
        onClose={() => setSellTarget(null)}
        title="List for sale"
      >
        {sellTarget ? (
          <div className="p-5">
            <div className="mb-5 flex gap-4">
              <div className="w-20 shrink-0">
                <Slab listing={sellTarget} flat />
              </div>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold leading-snug">{sellTarget.title}</p>
                <p className="mt-1.5 text-[12px] text-muted">
                  Market value {usd(sellTarget.fmv)} · confidence {sellTarget.confidence}
                </p>
              </div>
            </div>
            <ListForSaleForm listing={sellTarget} onListed={() => setSellTarget(null)} />
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function Stat({ label, value, onClick }: { label: string; value: string; onClick?: () => void }) {
  const Box = onClick ? "button" : "div";
  return (
    <Box
      onClick={onClick}
      className={clsx(
        "rounded-card border border-hairline bg-surface p-4 text-left",
        onClick && "transition hover:border-white/20",
      )}
    >
      <p className="text-[11px] font-bold uppercase tracking-wide text-dim">{label}</p>
      <p className="mt-1.5 text-lg font-bold">{value}</p>
    </Box>
  );
}

/** Wallet balance with every credit and debit that makes it up. */
function WalletPanel() {
  const { ledger, balance, negotiations, user, topUp } = useStore();
  const me = user?.username;
  // Balance after each entry: everything from that entry back to the oldest.
  const rows = ledger.map((e, i) => ({
    ...e,
    after: Math.round(ledger.slice(i).reduce((sum, x) => sum + x.amount, 0) * 100) / 100,
  }));
  const pendingCash = Object.values(negotiations)
    .filter((n) => n.buyer === me && n.status === "open")
    .map(pendingOffer)
    .reduce((sum, m) => sum + (m?.offer?.cash ?? 0), 0);

  return (
    <div className="mt-5 space-y-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center rounded-card border border-hairline bg-surface p-5">
        <div>
          <p className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-wide text-dim">
            <Wallet size={14} /> Wallet balance
          </p>
          <p className="mt-1 text-[30px] font-bold leading-none">{usd(balance, { cents: true })}</p>
          <p className="mt-2 text-[12px] text-muted">
            The sum of every entry below. Demo money only.
            {pendingCash > 0
              ? ` ${usd(pendingCash, { cents: true })} is in offers waiting on sellers. It is not held, and only leaves your wallet if an offer is accepted.`
              : ""}
          </p>
        </div>
        <Button variant="secondary" onClick={() => topUp(1000)}>
          <Plus size={15} />
          Top up $1,000 (demo)
        </Button>
      </div>

      {rows.length ? (
        <div className="overflow-hidden rounded-card border border-hairline bg-surface">
          <div className="grid grid-cols-[1fr_auto_auto] gap-4 border-b border-hairline px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide text-dim">
            <span>Entry</span>
            <span className="w-24 text-right">Amount</span>
            <span className="hidden w-24 text-right sm:block">Balance</span>
          </div>
          <ul className="divide-y divide-[rgba(255,255,255,0.08)]">
            {rows.map((e) => (
              <li key={e.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-4 py-3 text-[13px]">
                <span className="min-w-0">
                  {e.listingId ? (
                    <Link href={`/asset/${e.listingId}`} className="block truncate font-semibold hover:underline">
                      {e.label}
                    </Link>
                  ) : (
                    <span className="block truncate font-semibold">{e.label}</span>
                  )}
                  <span className="text-[11px] text-dim">{shortDate(e.at)}</span>
                </span>
                <span className={clsx("w-24 text-right font-bold", e.amount >= 0 ? "text-good" : "text-white")}>
                  {e.amount >= 0 ? "+" : "−"}
                  {usd(Math.abs(e.amount), { cents: true })}
                </span>
                <span className="hidden w-24 text-right text-muted sm:block">{usd(e.after, { cents: true })}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Empty({
  icon,
  title,
  body,
  cta,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  cta?: { href: string; label: string };
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-hairline py-16 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-surface text-muted">
        {icon}
      </span>
      <p className="text-base font-bold">{title}</p>
      <p className="max-w-sm text-[13px] text-muted">{body}</p>
      {cta ? (
        <Link href={cta.href}>
          <Button variant="secondary" className="mt-1">
            {cta.label}
          </Button>
        </Link>
      ) : null}
    </div>
  );
}
