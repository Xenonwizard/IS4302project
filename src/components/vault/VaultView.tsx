"use client";

import clsx from "clsx";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Package, ShieldCheck, Tag, Truck } from "lucide-react";
import { useMemo, useState } from "react";
import { BRAND } from "@/lib/brand";
import { getListing } from "@/lib/catalog";
import { shortDate, truncMiddle, usd } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { Listing, VaultItem } from "@/lib/types";
import { Slab } from "../slab/Slab";
import { Badge, Button, Field, Modal, TimeAgo, inputClass } from "../ui/primitives";

type Tab = "collection" | "listings" | "offers" | "orders" | "watchlist";

const TABS: { value: Tab; label: string }[] = [
  { value: "collection", label: "Collection" },
  { value: "listings", label: "My listings" },
  { value: "offers", label: "Offers made" },
  { value: "orders", label: "Orders" },
  { value: "watchlist", label: "Watchlist" },
];

export function VaultView() {
  const params = useSearchParams();
  const {
    user,
    setAuthOpen,
    vault,
    orders,
    offersMade,
    watchlist,
    listFromVault,
    delist,
    requestShipping,
    resolve,
  } = useStore();
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab) ?? "collection");
  const [sellTarget, setSellTarget] = useState<Listing | null>(null);
  const [price, setPrice] = useState("");

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
        <h1 className="text-xl font-bold">Your vault</h1>
        <p className="max-w-sm text-sm text-muted">
          Log in to see the slabs you own, the offers you have made and your order history.
        </p>
        <Button size="lg" onClick={() => setAuthOpen(true)}>
          Log in
        </Button>
      </div>
    );
  }

  return (
    <div className="px-4 py-5 lg:px-6">
      <h1 className="text-[24px] font-bold">My vault</h1>
      <p className="mt-1 text-[13px] text-muted">
        Held in the {BRAND.vaultCity} vault, insured at full market value.
      </p>

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Slabs owned" value={String(items.length)} />
        <Stat label="Collection value" value={usd(totalValue)} />
        <Stat label="Listed for sale" value={String(listed.length)} />
        <Stat label="Points" value={user.points.toLocaleString()} />
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
                        <Button size="sm" variant="secondary" onClick={() => delist(listing.id)}>
                          Remove listing
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => {
                            setSellTarget(listing);
                            setPrice(String(Math.round(listing.fmv * 0.97 * 100) / 100));
                          }}
                        >
                          <Tag size={13} />
                          List for sale
                        </Button>
                      )}
                      {entry.status !== "Shipping requested" ? (
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
              title="Nothing vaulted yet"
              body="Buy a slab on the marketplace or rip a pack — either way it lands here."
              cta={{ href: "/packs", label: "Open a pack" }}
            />
          )
        ) : null}

        {tab === "listings" ? (
          listed.length ? (
            <ul className="divide-y divide-[rgba(255,255,255,0.08)] overflow-hidden rounded-card border border-hairline bg-surface">
              {listed.map(({ entry, listing }) => (
                <li key={listing.id} className="flex items-center gap-4 p-4">
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
                      Listed at {usd(entry.listedPrice ?? listing.price)} · FMV {usd(listing.fmv)}
                    </p>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => delist(listing.id)}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <Empty
              icon={<Tag size={24} />}
              title="No active listings"
              body="List a slab from your collection and it appears on the marketplace instantly."
            />
          )
        ) : null}

        {tab === "offers" ? (
          offersMade.length ? (
            <ul className="divide-y divide-[rgba(255,255,255,0.08)] overflow-hidden rounded-card border border-hairline bg-surface">
              {offersMade.map((o) => {
                const listing = getListing(o.listingId);
                return (
                  <li key={o.id} className="flex items-center gap-4 p-4">
                    {listing ? (
                      <Link href={`/asset/${listing.id}`} className="w-12 shrink-0">
                        <Slab listing={listing} flat />
                      </Link>
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-1 text-[13px] font-semibold">
                        {listing?.title ?? o.listingId}
                      </p>
                      <p className="mt-1 text-[12px] text-muted">
                        Offered {usd(o.amount)} · expires <TimeAgo value={o.expiresAt} />
                      </p>
                    </div>
                    <Badge tone="warn">Pending</Badge>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Empty
              icon={<Tag size={24} />}
              title="No offers yet"
              body="Offers you make on other collectors' slabs show up here until they are accepted or expire."
            />
          )
        ) : null}

        {tab === "orders" ? (
          orders.length ? (
            <ul className="divide-y divide-[rgba(255,255,255,0.08)] overflow-hidden rounded-card border border-hairline bg-surface">
              {orders.map((o) => (
                <li key={o.id} className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-[13px] font-bold">{o.id}</p>
                      <p className="mt-0.5 text-[12px] text-muted">
                        {shortDate(o.createdAt)} · {o.listingIds.length} item
                        {o.listingIds.length === 1 ? "" : "s"} ·{" "}
                        {o.method === "usdc" ? `USDC on ${BRAND.chain}` : "Card / balance"}
                      </p>
                    </div>
                    <p className="text-sm font-bold">{usd(o.total)}</p>
                  </div>
                  <p className="mt-2 font-mono text-[11px] text-dim">
                    tx {truncMiddle(o.txHash, 14, 8)}
                  </p>
                  <div className="mt-3 flex gap-2">
                    {o.listingIds.map((id) => {
                      const listing = getListing(id);
                      if (!listing) return null;
                      return (
                        <Link key={id} href={`/asset/${id}`} className="w-11 shrink-0">
                          <Slab listing={listing} flat />
                        </Link>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty
              icon={<Package size={24} />}
              title="No orders yet"
              body="Your purchase receipts and on-chain transfer hashes live here."
              cta={{ href: "/marketplace", label: "Browse the marketplace" }}
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

      {/* list-for-sale modal */}
      <Modal
        open={Boolean(sellTarget)}
        onClose={() => setSellTarget(null)}
        title="List for sale"
      >
        {sellTarget ? (
          <div className="p-5">
            <div className="flex gap-4">
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

            <div className="mt-5">
              <Field label="Ask price" hint="Listings run for 7 days and renew automatically.">
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted">
                    $
                  </span>
                  <input
                    className={`${inputClass} pl-7 text-base font-bold`}
                    inputMode="decimal"
                    value={price}
                    onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))}
                  />
                </div>
              </Field>
            </div>

            <div className="mt-3 flex gap-2">
              {[0.9, 0.97, 1, 1.1].map((m) => (
                <button
                  key={m}
                  onClick={() => setPrice(String(Math.round(sellTarget.fmv * m * 100) / 100))}
                  className="h-9 flex-1 rounded-lg bg-surface-2 text-[12px] font-semibold text-muted transition hover:bg-surface-3 hover:text-white"
                >
                  {m === 1 ? "FMV" : `${Math.round(m * 100)}%`}
                </button>
              ))}
            </div>

            <div className="mt-5 space-y-2.5 rounded-2xl bg-surface p-4 text-[13px]">
              <div className="flex justify-between">
                <span className="text-muted">You receive (after 2% fee)</span>
                <span className="font-semibold">
                  {usd(Math.max(0, Number(price) || 0) * 0.98)}
                </span>
              </div>
            </div>

            <Button
              size="lg"
              className="mt-5 w-full"
              disabled={!Number(price)}
              onClick={() => {
                listFromVault(sellTarget.id, Number(price));
                setSellTarget(null);
              }}
            >
              List for {usd(Number(price) || 0)}
            </Button>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-hairline bg-surface p-4">
      <p className="text-[11px] font-bold uppercase tracking-wide text-dim">{label}</p>
      <p className="mt-1.5 text-lg font-bold">{value}</p>
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
