"use client";

import clsx from "clsx";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Blocks, Grid2x2, Grid3x3, Lock, MessagesSquare, Package, PackageOpen, Route, Send, ShieldCheck, Tag, Truck } from "lucide-react";
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
import { useSlabChain } from "@/lib/chain/useSlabChain";
import type { Listing, VaultItem } from "@/lib/types";
import { RedeemModal } from "../chain/RedeemModal";
import { TransferModal } from "../chain/TransferModal";
import { WithdrawnList } from "../chain/WithdrawnList";
import { Slab } from "../slab/Slab";
import { Badge, Button, Modal, TimeAgo } from "../ui/primitives";
import { ListForSaleForm } from "./ListForSaleForm";
import { Empty, LoginPrompt } from "./shared";

type Tab = "all" | "awaiting" | "listed" | "unlisted" | "withdrawn";

const TABS: { value: Tab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "awaiting", label: "Awaiting vault" },
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
  const { reportLost } = useSlabChain();
  const [delistingId, setDelistingId] = useState<string | null>(null);
  const [gridSize, setGridSize] = useState<"medium" | "small">("medium");

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
  const items = allItems.filter((i) => i.entry.status !== "Withdrawn");
  const awaiting = items.filter((i) => i.entry.status === "Awaiting vaulting");
  const withdrawn = allItems.filter((i) => i.entry.status === "Withdrawn");

  const totalValue = items.reduce((sum, i) => sum + (i.entry.status === "Listed" ? i.entry.listedPrice ?? i.listing.price : 0), 0);
  const listed = items.filter((i) => i.entry.status === "Listed");
  const unlisted = items.filter((i) => i.entry.status === "Vaulted");
  const counts: Record<Tab, number> = {
    all: items.length,
    awaiting: awaiting.length,
    listed: listed.length,
    unlisted: unlisted.length,
    withdrawn: withdrawn.length,
  };

  const handleReportLost = async (tokenId: string) => {
    try {
      await reportLost(tokenId, "Reported lost from Awaiting vault");
      pushToast({ title: "Lost slab reported", body: "The vault team has been notified.", tone: "success" });
    } catch (err) {
      pushToast({ title: "Could not report slab", body: (err as Error).message, tone: "error" });
    }
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
      <h1 className="text-[24px] font-bold">Vault</h1>
      <p className="mt-1 text-[13px] text-muted">
        {user.address
          ? "Stored by Collector Crypt. Each slab's token is yours on Polygon, and its Collector Crypt NFT is held in Pokechain's escrow."
          : `Held in the ${BRAND.vaultCity} vault, insured.`}
        {" "}
        <Link href="/submissions" className="font-semibold text-accent hover:underline">Track inbound requests in Submissions.</Link>
      </p>

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
        {tab === "all" || tab === "awaiting" || tab === "unlisted" ? (
          <div className="mb-3 flex justify-end">
            <div className="flex h-10 items-center rounded-xl border border-hairline bg-surface p-1" role="group" aria-label="Vault grid size">
              <button
                onClick={() => setGridSize("medium")}
                aria-label="Medium grid"
                aria-pressed={gridSize === "medium"}
                title="Medium grid"
                className={clsx(
                  "grid h-8 w-8 place-items-center rounded-lg transition",
                  gridSize === "medium" ? "bg-surface-3 text-white" : "text-muted hover:text-white",
                )}
              >
                <Grid2x2 size={15} />
              </button>
              <button
                onClick={() => setGridSize("small")}
                aria-label="Small grid"
                aria-pressed={gridSize === "small"}
                title="Small grid"
                className={clsx(
                  "grid h-8 w-8 place-items-center rounded-lg transition",
                  gridSize === "small" ? "bg-surface-3 text-white" : "text-muted hover:text-white",
                )}
              >
                <Grid3x3 size={15} />
              </button>
            </div>
          </div>
        ) : null}
        {/* Awaiting vault has its own block below, so it isn't drawn twice. */}
        {tab === "all" || tab === "unlisted" ? (
          (tab === "all" ? items : unlisted).length ? (
            <div className={clsx(
              "grid gap-3",
              gridSize === "small"
                ? "grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-9"
                : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-7",
            )}>
              {(tab === "all" ? items : unlisted).map(({ entry, listing }, index) => {
                const shouldAnimate = index < 12;
                return (
                  <div
                    key={listing.id}
                    className={clsx("min-w-0", shouldAnimate && "fade-up motion-reduce:animate-none")}
                    style={shouldAnimate ? { animationDelay: `${index * 22}ms` } : undefined}
                  >
                    <SlabCard
                      entry={entry}
                      listing={listing}
                      size={gridSize}
                      onManage={() => setTab("listed")}
                      onSell={() => setSellTarget({ ...listing, tokenId: entry.token?.tokenId ?? listing.tokenId })}
                      onShip={() => (user.address ? setRedeemTarget({ entry, listing }) : requestShipping(listing.id))}
                      onTransfer={entry.token && user.address ? () => setTransferTarget({ entry, listing }) : undefined}
                      inOffer={entry.token ? escrowed[entry.token.tokenId] : undefined}
                      onReportLost={entry.token?.tokenId ? () => void handleReportLost(entry.token!.tokenId) : undefined}
                    />
                  </div>
                );
              })}
            </div>
          ) : tab === "all" ? (
            <Empty
              icon={<Package size={24} />}
              title="No slabs yet"
              body="Add a graded slab, or win one with an offer in a negotiation room. Vaulted slabs land here; inbound requests stay in Submissions."
              cta={{ href: "/submit", label: "Add a slab" }}
            />
          ) : (
            <Empty
              icon={<Package size={24} />}
              title="No vaulted slabs to list"
              body="Slabs arrive here once Collector Crypt has vaulted and unlocked them."
            />
          )
        ) : null}

        {tab === "awaiting" ? (
          awaiting.length ? (
            <div className={clsx(
              "grid gap-3",
              gridSize === "small" ? "grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-9" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-7",
            )}>
              {awaiting.map(({ entry, listing }) => (
                <AwaitingSlabCard key={listing.id} entry={entry} listing={listing} onReportLost={entry.token?.tokenId ? () => void handleReportLost(entry.token!.tokenId) : undefined} />
              ))}
            </div>
          ) : (
            <Empty icon={<Package size={24} />} title="Nothing awaiting vaulting" body="Newly received slabs will appear here until Collector Crypt completes vaulting." />
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
  size,
  onManage,
  onSell,
  onShip,
  onTransfer,
  inOffer,
  onReportLost,
}: {
  entry: VaultItem;
  listing: Listing;
  size: "medium" | "small";
  onManage: () => void;
  onSell: () => void;
  onShip: () => void;
  /** tokenised slabs on a wallet account only */
  onTransfer?: () => void;
  /** the open trade offer that has this slab locked in escrow */
  inOffer?: { offerId: string; taker: string; room: string };
  onReportLost?: () => void;
}) {
  const small = size === "small";
  if (entry.status === "Awaiting vaulting") {
    return <AwaitingSlabCard entry={entry} listing={listing} onReportLost={onReportLost} />;
  }
  if (inOffer) {
    return (
      <div className="overflow-hidden rounded-card border border-accent/50 bg-surface ring-1 ring-accent/30">
        <Link href={`/asset/${listing.id}`} className={clsx("block bg-[#101014] opacity-70", small ? "p-2" : "p-4")}>
          <Slab listing={listing} />
        </Link>
        <div className={small ? "p-2" : "p-3.5"}>
          <p className={clsx("line-clamp-2 font-semibold leading-snug", small ? "text-[10.5px]" : "text-[12px]")}>{listing.title}</p>
          <div className="mt-2 flex items-center justify-between">
            <span className={clsx("font-bold", small ? "text-[11px]" : "text-[13px]")}>In trade</span>
            <Badge className={small ? "px-1.5 text-[9px]" : undefined} tone="accent"><Lock size={11} /> In offer #{inOffer.offerId}</Badge>
          </div>
          <p className={clsx("mt-1.5 text-dim", small ? "text-[9.5px]" : "text-[11px]")}>
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
      <Link href={`/asset/${listing.id}`} className={clsx("block bg-[#101014]", small ? "p-2" : "p-4")}>
        <Slab listing={listing} />
      </Link>
      <div className={small ? "p-2" : "p-3.5"}>
        <Link
          href={`/asset/${listing.id}`}
          className={clsx("line-clamp-2 font-semibold leading-snug hover:underline", small ? "text-[10.5px]" : "text-[12px]")}
        >
          {listing.title}
        </Link>
        <div className={clsx("mt-2", small ? "space-y-1.5" : "flex items-center justify-between gap-2")}>
          <span className={clsx("font-bold", small ? "text-[11px]" : "text-[13px]")}>{entry.status === "Listed" ? `Asking ${usd(entry.listedPrice ?? listing.price, { cents: true })}` : "Not listed"}</span>
          <Badge className={small ? "w-fit px-1.5 text-[9px]" : undefined} tone={entry.status === "Listed" ? "accent" : entry.status === "Shipping requested" ? "warn" : "good"}>
            {entry.status}
          </Badge>
        </div>
        <p className={clsx("mt-1.5 text-dim", small ? "text-[9.5px]" : "text-[11px]")}>
          {entry.via} · <TimeAgo value={entry.acquiredAt} />
        </p>
        {entry.token ? (
          <Link
            href={`/trace/${entry.token.tokenId}`}
            className={clsx("mt-1 flex items-center gap-1 font-semibold text-accent hover:underline", small ? "text-[9.5px]" : "text-[11px]")}
            title="Trace this slab across Polygon, Solana and Collector Crypt"
          >
            <Blocks size={11} /> Token #{entry.token.tokenId} · <Route size={11} /> Trace
          </Link>
        ) : null}
        <div className={clsx("mt-3 grid", small ? "gap-1.5" : "gap-2")}>
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

function AwaitingSlabCard({
  entry,
  listing,
  onReportLost,
}: {
  entry: VaultItem;
  listing: Listing;
  onReportLost?: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-card border border-hairline bg-surface">
      <div className="bg-[#101014] p-4">
        <Slab listing={listing} />
      </div>
      <div className="space-y-2 p-3.5">
        <p className="line-clamp-2 text-[12px] font-semibold leading-snug">{listing.title}</p>
        <Badge tone="warn">Awaiting Vaulting</Badge>
        <p className="text-[11px] text-muted">
          Submitted <TimeAgo value={entry.acquiredAt} />
        </p>
        {onReportLost ? (
          <Button size="sm" variant="outline" className="w-full" onClick={onReportLost}>
            Report lost
          </Button>
        ) : null}
      </div>
    </div>
  );
}
