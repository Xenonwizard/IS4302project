"use client";

import clsx from "clsx";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Blocks, Lock, MessagesSquare, Package, PackageOpen, Plus, Route, Send, ShieldCheck, Tag, Truck } from "lucide-react";
import type { Address } from "viem";
import { useMemo, useState } from "react";
import { BRAND } from "@/lib/brand";
import { getListing } from "@/lib/catalog";
import { usd } from "@/lib/format";
import { bidValue, pendingOffer } from "@/lib/negotiation";
import { useEscrowedByMe } from "@/lib/chain/trades";
import { useStore } from "@/lib/store";
import { IS_DEPLOYED } from "@/lib/chain/config";
import { useMarketChain } from "@/lib/chain/useMarketChain";
import type { Listing, VaultItem } from "@/lib/types";
import { PendingSubmissions } from "../chain/PendingSubmissions";
import { RedeemModal } from "../chain/RedeemModal";
import { TransferModal } from "../chain/TransferModal";
import { WithdrawnList } from "../chain/WithdrawnList";
import { Slab } from "../slab/Slab";
import { Badge, Button, Modal, TimeAgo } from "../ui/primitives";
import { ListForSaleForm } from "./ListForSaleForm";
import { Empty, LoginPrompt } from "./shared";

type Tab = "all" | "listed" | "unlisted" | "withdrawn";

const TABS: { value: Tab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "listed", label: "Listed" },
  { value: "unlisted", label: "Unlisted" },
  { value: "withdrawn", label: "Withdrawn" },
];

export function VaultView() {
  const params = useSearchParams();
  const {
    user,
    ready,
    vault,
    delist,
    requestShipping,
    resolve,
    negotiations,
    balance,
    pushToast,
  } = useStore();
  const { cancelListing } = useMarketChain();
  const [delistingId, setDelistingId] = useState<string | null>(null);

  const handleDelist = async (listingId: string, tokenId?: string) => {
    setDelistingId(listingId);
    try {
      if (user?.address && tokenId) {
        await cancelListing(tokenId);
      }
      delist(listingId);
    } catch (err) {
      pushToast({ title: "Could not cancel listing", body: (err as Error).message, tone: "error" });
    } finally {
      setDelistingId(null);
    }
  };

  const [tab, setTab] = useState<Tab>(
    () => TABS.find((t) => t.value === params.get("tab"))?.value ?? "all",
  );
  const [sellTarget, setSellTarget] = useState<Listing | null>(null);
  const [redeemTarget, setRedeemTarget] = useState<{ entry: VaultItem; listing: Listing } | null>(null);
  const [transferTarget, setTransferTarget] = useState<{ entry: VaultItem; listing: Listing } | null>(null);
  // Slabs locked in one of my open trade offers (held by TradeEscrow): tokenId → offerId
  const { data: escrowed = {} } = useEscrowedByMe(user?.address as Address | undefined);

  const allItems = useMemo(
    () =>
      vault
        .filter((v) => !IS_DEPLOYED || !user?.address || Boolean(v.token))
        .map((v) => {
          const listing = getListing(v.listingId);
          return listing ? { entry: v, listing: resolve(listing) } : null;
        })
        .filter((x): x is { entry: VaultItem; listing: Listing } => Boolean(x)),
    [vault, resolve, user?.address],
  );
  // Withdrawn slabs have left the vault but keep their token, so they get their own tab.
  const items = allItems.filter((i) => i.entry.status !== "Withdrawn");
  const withdrawn = allItems.filter((i) => i.entry.status === "Withdrawn");

  const totalValue = items.reduce((sum, i) => sum + (i.entry.status === "Listed" ? i.entry.listedPrice ?? i.listing.price : 0), 0);
  const listed = items.filter((i) => i.entry.status === "Listed");
  const unlisted = items.filter((i) => i.entry.status !== "Listed");
  const counts: Record<Tab, number> = {
    all: items.length,
    listed: listed.length,
    unlisted: unlisted.length,
    withdrawn: withdrawn.length,
  };

  if (!ready) {
    return (
      <div className="space-y-6 px-4 py-6 lg:px-6">
        <div className="skeleton h-10 w-48 rounded-xl" />
        <div className="skeleton h-24 w-full rounded-2xl" />
        <div className="skeleton h-[400px] w-full rounded-card" />
      </div>
    );
  }

  if (!user) {
    return (
      <LoginPrompt
        icon={<ShieldCheck size={26} />}
        title="Vault"
        body="Log in to see the slabs you own and your listings."
      />
    );
  }

  return (
    <div className="px-4 py-5 lg:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[24px] font-bold">Vault</h1>
        <Link href="/submit">
          <Button size="sm">
            <Plus size={14} /> Vault a slab
          </Button>
        </Link>
      </div>
      <p className="mt-1 text-[13px] text-muted">
        {user.address
          ? "Stored by Collector Crypt. Each slab's token is yours on Polygon, and its Collector Crypt NFT is held in Pokechain's escrow."
          : `Held in the ${BRAND.vaultCity} vault, insured.`}
      </p>

      {user.address ? (
        <div className="mt-5">
          <PendingSubmissions />
        </div>
      ) : null}

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Slabs owned" value={String(items.length)} />
        <Stat label="Total asking prices" value={usd(totalValue, { cents: items.some((i) => i.entry.token) })} />
        <Stat label="Listed for sale" value={String(listed.length)} />
        <Stat label="Wallet balance" value={usd(balance, { cents: true })} href="/wallet" />
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
            <span className="ml-1.5 rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px]">{counts[t.value]}</span>
            {tab === t.value ? (
              <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-accent" />
            ) : null}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {tab === "all" || tab === "unlisted" ? (
          (tab === "all" ? items : unlisted).length ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
              {(tab === "all" ? items : unlisted).map(({ entry, listing }) => (
                <SlabCard
                  key={listing.id}
                  entry={entry}
                  listing={listing}
                  onManage={() => setTab("listed")}
                  onSell={() => setSellTarget({ ...listing, tokenId: entry.token?.tokenId ?? listing.tokenId })}
                  onShip={() => (user.address ? setRedeemTarget({ entry, listing }) : requestShipping(listing.id))}
                  onTransfer={entry.token && user.address ? () => setTransferTarget({ entry, listing }) : undefined}
                  inOffer={entry.token ? escrowed[entry.token.tokenId] : undefined}
                />
              ))}
            </div>
          ) : tab === "all" ? (
            <Empty
              icon={<Package size={24} />}
              title="No slabs yet"
              body="Vault a graded slab you own, or win one with an offer in a negotiation room. Either way it lands here."
              cta={{ href: "/submit", label: "Vault a graded slab" }}
            />
          ) : (
            <Empty
              icon={<Package size={24} />}
              title="Everything is listed"
              body="Slabs you hold without listing them show up here."
            />
          )
        ) : null}

        {tab === "withdrawn" ? (
          withdrawn.length ? (
            <WithdrawnList items={withdrawn} />
          ) : (
            <Empty
              icon={<PackageOpen size={24} />}
              title="Nothing withdrawn"
              body="Slabs you ship home move here. Their tokens stay in your wallet, so each one's custody trail can still be traced and a lost parcel reported."
            />
          )
        ) : null}

        {tab === "listed" ? (
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
                        Asking {usd(entry.listedPrice ?? listing.price)}
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
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={delistingId === listing.id}
                        onClick={() => handleDelist(listing.id, entry.token?.tokenId ?? listing.tokenId)}
                      >
                        {delistingId === listing.id ? "Delisting..." : "Delist"}
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
              body="List a slab from the All or Unlisted tab. Buyers' offers arrive as private negotiation rooms."
            />
          )
        ) : null}

      </div>

      <RedeemModal target={redeemTarget} onClose={() => setRedeemTarget(null)} />
      <TransferModal target={transferTarget} onClose={() => setTransferTarget(null)} />

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
                  {sellTarget.grader} {sellTarget.grade} · Set your own asking price
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

function Stat({ label, value, href }: { label: string; value: string; href?: string }) {
  const body = (
    <>
      <p className="text-[11px] font-bold uppercase tracking-wide text-dim">{label}</p>
      <p className="mt-1.5 text-lg font-bold">{value}</p>
    </>
  );
  const className = "block rounded-card border border-hairline bg-surface p-4";
  return href ? (
    <Link href={href} className={clsx(className, "transition hover:border-white/20")}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

/** A slab in the vault grid with the actions its status allows. */
function SlabCard({
  entry,
  listing,
  onManage,
  onSell,
  onShip,
  onTransfer,
  inOffer,
}: {
  entry: VaultItem;
  listing: Listing;
  onManage: () => void;
  onSell: () => void;
  onShip: () => void;
  /** tokenised slabs on a wallet account only */
  onTransfer?: () => void;
  /** the open trade offer that has this slab locked in escrow */
  inOffer?: { offerId: string; taker: string; room: string };
}) {
  if (inOffer) {
    return (
      <div className="overflow-hidden rounded-card border border-accent/50 bg-surface ring-1 ring-accent/30">
        <Link href={`/asset/${listing.id}`} className="block bg-[#101014] p-4 opacity-70">
          <Slab listing={listing} />
        </Link>
        <div className="p-3.5">
          <p className="line-clamp-2 text-[12px] font-semibold leading-snug">{listing.title}</p>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[13px] font-bold">In trade</span>
            <Badge tone="accent"><Lock size={11} /> In offer #{inOffer.offerId}</Badge>
          </div>
          <p className="mt-1.5 text-[11px] text-dim">
            Locked in TradeEscrow until the other collector answers, or you withdraw the offer in the chat.
          </p>
          <Link href={`/trades/${inOffer.room}`} className="mt-3 block">
            <Button size="sm" variant="secondary" className="w-full">See chat</Button>
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-card border border-hairline bg-surface">
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
          <span className="text-[13px] font-bold">{entry.status === "Listed" ? `Asking ${usd(entry.listedPrice ?? listing.price, { cents: true })}` : "Not listed"}</span>
          <Badge tone={entry.status === "Listed" ? "accent" : entry.status === "Shipping requested" ? "warn" : "good"}>
            {entry.status}
          </Badge>
        </div>
        <p className="mt-1.5 text-[11px] text-dim">
          {entry.via} · <TimeAgo value={entry.acquiredAt} />
        </p>
        {entry.token ? (
          <Link
            href={`/trace/${entry.token.tokenId}`}
            className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-accent hover:underline"
            title="Trace this slab across Polygon, Solana and Collector Crypt"
          >
            <Blocks size={11} /> Token #{entry.token.tokenId} · <Route size={11} /> Trace
          </Link>
        ) : null}
        <div className="mt-3 grid gap-2">
          {entry.status === "Listed" ? (
            <Button size="sm" variant="secondary" onClick={onManage}>
              Manage listing
            </Button>
          ) : entry.status === "Vaulted" ? (
            <Button size="sm" onClick={onSell}>
              <Tag size={13} />
              List for sale
            </Button>
          ) : null}
          {entry.status === "Vaulted" ? (
            <Button size="sm" variant="outline" onClick={onShip}>
              <Truck size={13} />
              Ship to me
            </Button>
          ) : null}
          {entry.status === "Vaulted" && onTransfer ? (
            <Button size="sm" variant="outline" onClick={onTransfer}>
              <Send size={13} />
              Transfer
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
