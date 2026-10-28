"use client";

import { MarketInsightsSlider } from "./MarketInsightsSlider";

import clsx from "clsx";
import Link from "next/link";
import {
  MessagesSquare,
  BadgeCheck,
  Gavel,
  Play,
  Share2,
  ShieldCheck,
  ShoppingCart,
  Tag,
  Truck,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { truncMiddle, usd } from "@/lib/format";
import { useLostSlabs, useStore } from "@/lib/store";
import { useMarketChain, useMarketFeeBps } from "@/lib/chain/useMarketChain";
import { useOnchainAccount } from "@/lib/chain/useOnchainAccount";
import { CUSTODY, chain, DEPLOY_BLOCK, IS_DEPLOYED, contracts, fromUsdcUnits, shortHash } from "@/lib/chain/config";
import { zeroAddress } from "viem";
import { usePublicClient } from "wagmi";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ActivityEvent, Listing } from "@/lib/types";
import { CopyText } from "../chain/ChainConsole";
import { OfferModal } from "../modals/OfferModal";
import { SoldBanner } from "../negotiations/SoldBanner";
import { Slab, SlabStage } from "../slab/Slab";
import {
  Avatar,
  Badge,
  Button,
  Modal,
  TimeAgo,
} from "../ui/primitives";

export function AssetDetail({ listing: base }: { listing: Listing }) {
  const {
    user,
    balance,
    resolve,
    isOwned,
    requireAuth,
    pushToast,
    isListed,
    delist,
    buyNow,
    negotiations,
    slabs,
    vault,
  } = useStore();

  const baseResolved = resolve(base);
  const resolvedTokenId =
    baseResolved.tokenId ||
    slabs.find((s) => s.id === baseResolved.id || s.tokenId === baseResolved.id || `token-${s.tokenId}` === baseResolved.id)?.tokenId ||
    vault.find((v) => v.listingId === baseResolved.id || v.token?.tokenId === baseResolved.id)?.token?.tokenId ||
    (baseResolved.id.startsWith("token-") ? baseResolved.id.replace("token-", "") : /^\d+$/.test(baseResolved.id) ? baseResolved.id : null);
  const listing = useMemo(
    () => ({ ...baseResolved, tokenId: resolvedTokenId || baseResolved.tokenId }),
    [baseResolved, resolvedTokenId],
  );
  // A slab minted through SlabVault: its facts come from the chain, not the catalogue.
  const onChainTokenId =
    resolvedTokenId ||
    (listing.contract?.toLowerCase() === contracts.slabVault.address.toLowerCase() ? listing.tokenId : null);

  const { buyCard, cancelListing } = useMarketChain();
  const { data: marketFeeBps = 0 } = useMarketFeeBps();
  const acct = useOnchainAccount();
  const client = usePublicClient();
  const queryClient = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const lostView = searchParams.get("lost") === "1";
  const lostReport = useLostSlabs().find((item) => item.listing.id === base.id || item.listing.tokenId === base.tokenId)?.loss;

  const tokenIdBigInt = resolvedTokenId ? BigInt(resolvedTokenId) : null;
  const enabledOnChain = Boolean(client && tokenIdBigInt !== null && IS_DEPLOYED);

  const { data: onChainMarketListing } = useQuery({
    queryKey: ["token-market-listing", resolvedTokenId],
    enabled: enabledOnChain,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      if (!client || tokenIdBigInt === null) return null;
      try {
        const l = await client.readContract({
          ...contracts.slabMarket,
          functionName: "getListing",
          args: [tokenIdBigInt],
        });
        if (!l || l.seller === zeroAddress || l.price === BigInt(0)) return null;
        return {
          seller: l.seller,
          price: fromUsdcUnits(l.price),
          listedAt: Number(l.listedAt),
        };
      } catch {
        return null;
      }
    },
  });

  const { data: onChainOwner } = useQuery({
    queryKey: ["token-owner", resolvedTokenId],
    enabled: enabledOnChain,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      if (!client || tokenIdBigInt === null) return null;
      try {
        const ownerAddr = await client.readContract({
          ...contracts.slabVault,
          functionName: "ownerOf",
          args: [tokenIdBigInt],
        });
        if (!ownerAddr || ownerAddr === zeroAddress) return null;
        const ownerAcct = await client
          .readContract({
            ...contracts.accounts,
            functionName: "accountOf",
            args: [ownerAddr],
          })
          .catch(() => null);
        return {
          address: ownerAddr,
          handle: ownerAcct?.handle || shortHash(ownerAddr),
        };
      } catch {
        return null;
      }
    },
  });

  // A slab whose owner asked to ship it out: locked from the request, burned once markShipped
  // has notified Collector Crypt. Either way it is no longer tradeable.
  const { data: shippedOut = false } = useQuery({
    queryKey: ["token-shipped-out", resolvedTokenId],
    enabled: enabledOnChain,
    queryFn: async () => {
      if (!client || tokenIdBigInt === null) return false;
      const custody = await client.readContract({ ...contracts.slabVault, functionName: "custodyOf", args: [tokenIdBigInt] }).catch(() => null);
      return custody !== null && ["Redemption requested", "Shipped", "Delivered"].includes(CUSTODY[custody]);
    },
  });

  const currentOwner = enabledOnChain && onChainOwner?.handle
    ? onChainOwner.handle
    : listing.owner;

  const currentOwnerAddress = enabledOnChain && onChainOwner?.address
    ? onChainOwner.address
    : listing.ownerAddress;

  const owned = enabledOnChain && onChainOwner && user?.address
    ? onChainOwner.address.toLowerCase() === user.address.toLowerCase()
    : isOwned(listing.id);
  const vaultEntry = vault.find((entry) => entry.listingId === listing.id || entry.token?.tokenId === resolvedTokenId);
  const awaitingVaulting = owned && vaultEntry?.status === "Awaiting vaulting";
  const withdrawn = shippedOut || (owned && vaultEntry?.status === "Withdrawn");
  const withdrawnBurned = withdrawn && onChainOwner === null;
  // A slab still being vaulted has no page of its own: it lives in the Vault's Awaiting vault tab.
  useEffect(() => {
    if (awaitingVaulting) router.replace("/vault?tab=awaiting");
  }, [awaitingVaulting, router]);

  const listed = !lostView && (enabledOnChain
    ? onChainMarketListing !== undefined
      ? Boolean(onChainMarketListing)
      : isListed(listing.id)
    : isListed(listing.id));

  const displayPrice = enabledOnChain && onChainMarketListing
    ? onChainMarketListing.price
    : listing.price;

  const effectiveListing = useMemo(
    () => ({
      ...listing,
      owner: lostView ? "Anonymous owner" : currentOwner,
      ownerAddress: lostView ? "" : currentOwnerAddress,
      price: displayPrice,
    }),
    [listing, lostView, currentOwner, currentOwnerAddress, displayPrice],
  );

  const refreshActivity = () => {
    if (resolvedTokenId) {
      void queryClient.invalidateQueries({ queryKey: ["token-activity", resolvedTokenId] });
      void queryClient.invalidateQueries({ queryKey: ["token-market-listing", resolvedTokenId] });
      void queryClient.invalidateQueries({ queryKey: ["token-owner", resolvedTokenId] });
      void queryClient.invalidateQueries({ queryKey: ["market-active-listings"] });
    }
  };

  const { data: onChainEvents = [] } = useQuery({
    queryKey: ["token-activity", listing.tokenId],
    enabled: enabledOnChain,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<ActivityEvent[]> => {
      if (!client || tokenIdBigInt === null) return [];
      try {
        const [marketCode, vaultCode] = await Promise.all([
          client.getBytecode({ address: contracts.slabMarket.address }).catch(() => null),
          client.getBytecode({ address: contracts.slabVault.address }).catch(() => null),
        ]);
        if (!marketCode || marketCode === "0x" || !vaultCode || vaultCode === "0x") return [];

        const from = { fromBlock: DEPLOY_BLOCK };
        const [sales, listings, transfers, mints] = await Promise.all([
          client
            .getContractEvents({
              ...contracts.slabMarket,
              eventName: "CardPurchased",
              args: { tokenId: tokenIdBigInt },
              ...from,
            })
            .catch(() => []),
          client
            .getContractEvents({
              ...contracts.slabMarket,
              eventName: "CardListed",
              args: { tokenId: tokenIdBigInt },
              ...from,
            })
            .catch(() => []),
          client
            .getContractEvents({
              ...contracts.slabVault,
              eventName: "Transfer",
              args: { tokenId: tokenIdBigInt },
              ...from,
            })
            .catch(() => []),
          client
            .getContractEvents({
              ...contracts.slabVault,
              eventName: "SlabVaulted",
              args: { tokenId: tokenIdBigInt },
              ...from,
            })
            .catch(() => []),
        ]);

        const events: ActivityEvent[] = [];
        const saleTxHashes = new Set(sales.map((s) => s.transactionHash));

        for (const log of sales) {
          const a = log.args as { tokenId?: bigint; seller?: string; buyer?: string; price?: bigint; fee?: bigint; settledAt?: bigint };
          if (!a?.buyer) continue;
          const [sellerAcct, buyerAcct] = await Promise.all([
            a.seller
              ? client.readContract({ ...contracts.accounts, functionName: "accountOf", args: [a.seller as `0x${string}`] }).catch(() => null)
              : null,
            a.buyer
              ? client.readContract({ ...contracts.accounts, functionName: "accountOf", args: [a.buyer as `0x${string}`] }).catch(() => null)
              : null,
          ]);

          const fromName = sellerAcct?.handle || shortHash(a.seller);
          const toName = buyerAcct?.handle || shortHash(a.buyer);
          const at = a.settledAt ? new Date(Number(a.settledAt) * 1000).toISOString() : new Date().toISOString();

          events.push({
            kind: "Sale",
            price: fromUsdcUnits(a.price ?? BigInt(0)),
            from: fromName,
            to: toName,
            at,
            txHash: log.transactionHash ?? "",
          });
        }

        for (const log of listings) {
          const a = log.args as { tokenId?: bigint; seller?: string; price?: bigint; listedAt?: bigint };
          if (!a?.seller) continue;
          const sellerAcct = await client
            .readContract({ ...contracts.accounts, functionName: "accountOf", args: [a.seller as `0x${string}`] })
            .catch(() => null);
          const fromName = sellerAcct?.handle || shortHash(a.seller);
          const at = a.listedAt ? new Date(Number(a.listedAt) * 1000).toISOString() : new Date().toISOString();

          events.push({
            kind: "Listed",
            price: fromUsdcUnits(a.price ?? BigInt(0)),
            from: fromName,
            to: "Marketplace",
            at,
            txHash: log.transactionHash ?? "",
          });
        }

        for (const log of transfers) {
          const a = log.args as { from?: string; to?: string; tokenId?: bigint };
          // If from is 0x0, it's the mint. If txHash was a sale, it's already shown as Sale.
          if (!a?.from || a.from === zeroAddress || saleTxHashes.has(log.transactionHash)) continue;

          const [fromAcct, toAcct] = await Promise.all([
            a.from
              ? client.readContract({ ...contracts.accounts, functionName: "accountOf", args: [a.from as `0x${string}`] }).catch(() => null)
              : null,
            a.to
              ? client.readContract({ ...contracts.accounts, functionName: "accountOf", args: [a.to as `0x${string}`] }).catch(() => null)
              : null,
          ]);

          const fromName = fromAcct?.handle || shortHash(a.from);
          const toName = toAcct?.handle || shortHash(a.to);
          const block = await client.getBlock({ blockNumber: log.blockNumber }).catch(() => null);
          const at = block?.timestamp ? new Date(Number(block.timestamp) * 1000).toISOString() : new Date().toISOString();

          // A transfer to the zero address is the burn when the slab was withdrawn (or written off).
          const burned = a.to === zeroAddress;
          events.push({
            kind: burned ? "Burn" : "Transfer",
            from: fromName,
            to: burned ? "burned" : toName,
            at,
            txHash: log.transactionHash ?? "",
          });
        }

        for (const log of mints) {
          const a = log.args as { owner?: string; certNumber?: string };
          if (!a?.owner) continue;
          const ownerAcct = await client
            .readContract({ ...contracts.accounts, functionName: "accountOf", args: [a.owner as `0x${string}`] })
            .catch(() => null);
          const ownerName = ownerAcct?.handle || shortHash(a.owner);
          const block = await client.getBlock({ blockNumber: log.blockNumber }).catch(() => null);
          const at = block?.timestamp ? new Date(Number(block.timestamp) * 1000).toISOString() : new Date().toISOString();

          events.push({
            kind: "Mint",
            from: "0x0000...0000",
            to: ownerName,
            at,
            txHash: log.transactionHash ?? "",
          });
        }

        return events;
      } catch {
        return [];
      }
    },
  });

  const allActivity = useMemo(() => {
    // If we have real on-chain events, filter out synthetic initial Mint from catalog
    // But keep Sale events which have the negotiated deal price
    const baseActivity = onChainEvents.length
      ? (listing.activity ?? []).filter((a) => {
          if (a.kind === "Mint") return false;
          if (a.kind === "Sale" && a.price) return true;
          return !onChainEvents.some((oe) => oe.txHash === a.txHash);
        })
      : (listing.activity ?? []);

    const saleTxHashes = new Set(baseActivity.filter((b) => b.kind === "Sale").map((b) => b.txHash));
    const filteredOnChain = onChainEvents.filter((oe) => !(oe.kind === "Transfer" && saleTxHashes.has(oe.txHash)));

    const combined = [...filteredOnChain, ...baseActivity];
    const seen = new Set<string>();
    const deduped: ActivityEvent[] = [];
    for (const item of combined) {
      const key = `${item.kind}-${item.txHash}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(item);
      }
    }
    return deduped.sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0));
  }, [onChainEvents, listing.activity]);

  const [buyOpen, setBuyOpen] = useState(false);
  const [buyBusy, setBuyBusy] = useState(false);
  const [delisting, setDelisting] = useState(false);
  const [offerOpen, setOfferOpen] = useState(false);
  const [view, setView] = useState<"video" | "front" | "back">("video");
  const [spinRun, setSpinRun] = useState(0);
  const [videoPlaying, setVideoPlaying] = useState(true);

  useEffect(() => {
    if (view !== "video" || !videoPlaying) return;
    const stop = window.setTimeout(() => setVideoPlaying(false), 5000);
    return () => window.clearTimeout(stop);
  }, [view, spinRun, videoPlaying]);

  const handleBuy = async () => {
    setBuyBusy(true);
    try {
      let txHash = "";
      if (user?.address && listing.tokenId) {
        txHash = await buyCard(listing.tokenId, displayPrice);
      }
      buyNow(listing.id, txHash);
      setBuyOpen(false);
      refreshActivity();
    } catch (err) {
      pushToast({
        title: "Purchase failed",
        body: (err as Error).message,
        tone: "error",
      });
    } finally {
      setBuyBusy(false);
    }
  };

  const handleDelist = async () => {
    setDelisting(true);
    try {
      if (user?.address && listing.tokenId) {
        await cancelListing(listing.tokenId);
      }
      delist(listing.id);
    } catch (err) {
      pushToast({
        title: "Delist failed",
        body: (err as Error).message,
        tone: "error",
      });
    } finally {
      setDelisting(false);
    }
  };

  const openChats = Object.values(negotiations).filter(
    (n) => n.listingId === listing.id && n.status === "open",
  ).length;

  if (awaitingVaulting) {
    return <div className="px-4 py-10 text-center text-sm text-muted">Opening Awaiting vault…</div>;
  }

  return (
    <div className="px-4 py-5 lg:px-6">
      <div className="mb-4 empty:hidden">
        <SoldBanner tokenId={listing.tokenId} relisted={listed} />
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* ---------------- left ---------------- */}
        <div className={clsx("min-w-0", !lostView && "xl:h-full")}>
          <div
            className={clsx(
              "relative mx-auto flex aspect-square w-full flex-col overflow-hidden rounded-card border border-hairline bg-[#0c0c10]",
              !lostView && "xl:h-full xl:aspect-auto",
            )}
            style={{ maxWidth: "min(100%, 80vh)" }}
          >
            <div className="relative min-h-0 w-full flex-1">
              <SlabStage
                key={view === "video" ? `video-${spinRun}` : view}
                listing={listing}
                spinning={view === "video" && videoPlaying}
                side={view === "front" ? "front" : view === "back" ? "back" : undefined}
              />
            </div>

            <div className="flex items-center gap-2.5 border-t border-hairline p-3">
              <button
                onClick={() => {
                  setView("video");
                  setVideoPlaying(true);
                  setSpinRun((run) => run + 1);
                }}
                className={clsx(
                  "grid h-14 w-14 shrink-0 place-items-center rounded-xl border transition",
                  view === "video" ? "border-accent bg-accent/15 text-accent" : "border-hairline bg-surface text-muted hover:text-white",
                )}
                aria-label="Play one slab rotation"
                title="Play one slab rotation"
              >
                <Play size={17} />
              </button>
              <Thumb
                active={view === "front"}
                onClick={() => {
                  setView("front");
                  setVideoPlaying(false);
                }}
              >
                <div className="relative h-full aspect-[0.62]">
                  <Slab listing={listing} flat fit />
                </div>
              </Thumb>
              <Thumb
                active={view === "back"}
                onClick={() => {
                  setView("back");
                  setVideoPlaying(false);
                }}
              >
                <div className="relative h-full aspect-[0.62]">
                  <Slab listing={listing} fit side="back" />
                </div>
              </Thumb>
              <p className="ml-auto hidden text-[12px] text-dim sm:block">
                Move your cursor over the slab to tilt it
              </p>
            </div>
          </div>
        </div>

        {/* ---------------- right ---------------- */}
        <div className="min-w-0 space-y-4">
          <div className="flex items-center justify-between gap-3">
            {withdrawn ? (
              <Badge tone="neutral" className="gap-1.5 px-2.5 py-1.5">
                <Truck size={13} className="text-muted" />
                {withdrawnBurned ? "Withdrawn · NFT burned" : "Withdrawn · NFT locked"}
              </Badge>
            ) : (
              <Badge tone="neutral" className="gap-1.5 px-2.5 py-1.5">
                <ShieldCheck size={13} className="text-good" />
                Vaulted and insured
              </Badge>
            )}
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  if (typeof navigator !== "undefined" && navigator.clipboard) {
                    navigator.clipboard.writeText(window.location.href);
                  }
                  pushToast({ title: "Link copied" });
                }}
                className="grid h-9 w-9 place-items-center rounded-xl border border-hairline text-muted transition hover:text-white"
                aria-label="Share"
              >
                <Share2 size={15} />
              </button>
            </div>
          </div>

          <h1 className="text-[22px] font-bold leading-tight">{listing.title}</h1>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
            {lostView ? (
              <span className="text-muted">Owner identity hidden for lost-card recovery</span>
            ) : (
              <span className="flex items-center gap-2 text-muted">
                Owned by
                <Link
                  href={`/profile/${currentOwner}`}
                  className="flex items-center gap-1.5 font-semibold text-accent hover:underline"
                >
                  <Avatar name={currentOwner} size={18} />
                  {currentOwner}
                </Link>
              </span>
            )}
          </div>

          {lostView && lostReport ? (
            <div className="mt-4 rounded-2xl border border-warn/25 bg-warn/5 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[12px] font-bold uppercase tracking-wide text-warn">Lost-card report</p>
                <TimeAgo value={lostReport.reportedAt} />
              </div>
              <p className="mt-2 text-[13px] leading-relaxed text-muted">{lostReport.details}</p>
              {lostReport.bounty ? (
                <p className="mt-3 border-t border-warn/15 pt-3 text-[13px] font-semibold text-good">
                  Recovery bounty: {usd(lostReport.bounty.amount)} USDC
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 text-[13px] text-muted">
              <BadgeCheck size={14} className="text-accent" />
              {listing.grader}: {listing.certNumber}
            </span>
            <button
              onClick={() =>
                pushToast({
                  title: "Certification verified",
                  body: `${listing.grader} cert ${listing.certNumber} matches the registry.`,
                  tone: "success",
                })
              }
              className="rounded-md border border-hairline px-2 py-1 text-[11px] font-semibold text-muted transition hover:text-white"
            >
              Verify certification
            </button>
          </div>

          {withdrawn ? (
            <div data-testid="withdrawn-status" className="rounded-card border border-hairline bg-surface p-4 sm:p-5">
              <p className="text-[12px] font-semibold text-muted">Status</p>
              <p className="mt-1 text-[24px] font-bold leading-tight">Withdrawn from the vault</p>
              <p className="mt-2 text-[12px] leading-relaxed text-muted">
                {withdrawnBurned
                  ? "This slab was shipped out of Collector Crypt's vault. Its Pokechain NFT was burned once Collector Crypt was notified to ship it, so it can't be listed or traded."
                  : "Its owner asked to ship this slab out. Its Pokechain NFT is locked, so it can't be listed or traded, and burns once Collector Crypt is notified to ship it."}
              </p>
              {owned ? (
                <Link href="/submissions?tab=withdrawn" className="mt-4 block">
                  <Button size="lg" variant="secondary" className="w-full">
                    <Truck size={16} />
                    Track it in Status Center
                  </Button>
                </Link>
              ) : null}
            </div>
          ) : null}

          {!lostView && !withdrawn ? <>
          {/* listing status and actions */}
          <div className="overflow-hidden rounded-card border border-hairline bg-surface">
            <div className="grid gap-5 p-4 sm:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] sm:items-center sm:p-5">
              <div className="min-w-0">
                <p className="text-[12px] font-semibold text-muted">{listed ? "Listed for" : "Listing status"}</p>
                <p className="mt-1 text-[30px] font-bold leading-tight">
                  {listed ? usd(displayPrice, { cents: Boolean(onChainTokenId) }) : "Not listed"}
                </p>
                {!listed ? (
                  <p className="mt-2 text-[12px] leading-relaxed text-muted">
                    {owned ? "Held in your vault and ready to list." : "This slab is not for sale right now."}
                  </p>
                ) : null}
              </div>

              <div className="grid min-w-0 gap-2">
                {owned ? listed ? (
                  <>
                    <Link href={`/trades?listing=${listing.id}`}>
                      <Button size="lg" className="w-full">
                        <MessagesSquare size={16} />
                        Offers on this slab{openChats ? ` (${openChats})` : ""}
                      </Button>
                    </Link>
                    <Button size="lg" variant="secondary" className="w-full" disabled={delisting} onClick={handleDelist}>
                      {delisting ? "Delisting..." : "Delist from Marketplace"}
                    </Button>
                  </>
                ) : (
                  <Link href="/vault">
                    <Button size="lg" className="w-full">
                      <Tag size={16} />
                      List it from your Vault
                    </Button>
                  </Link>
                ) : listed ? (
                  <>
                    <Button size="lg" className="w-full" onClick={() => requireAuth(() => setBuyOpen(true)) && setBuyOpen(true)}>
                      <ShoppingCart size={16} />
                      Buy now
                    </Button>
                    <Button size="lg" variant="secondary" className="w-full" onClick={() => requireAuth(() => setOfferOpen(true)) && setOfferOpen(true)}>
                      <Gavel size={16} />
                      Make an offer
                    </Button>
                  </>
                ) : null}
              </div>
            </div>

            {listed ? (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline px-4 py-3 text-[11px] text-muted sm:px-5">
                <span className="flex items-center gap-1.5"><ShieldCheck size={13} className="text-good" />{marketFeeBps === 0 ? "0% platform fee" : `${marketFeeBps / 100}% protocol fee`} · Atomic on-chain settlement</span>
              </div>
            ) : null}
          </div>

          {/* trust strip */}
          <div className="grid grid-cols-1 gap-3 rounded-card border border-hairline bg-surface p-4 sm:grid-cols-3">
            <Trust icon={<BadgeCheck size={15} />} text="Authenticity guarantee" />
            <Trust icon={<ShieldCheck size={15} />} text="Vaulted and insured for free" />
            <Trust icon={<Truck size={15} />} text="Ship to you anytime" />
          </div>

          <MarketInsightsSlider key={listing.id} card={listing} tokenId={onChainTokenId ?? undefined} />

          </> : null}
        </div>
      </div>

      {!lostView ? (
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <Details
            listing={effectiveListing}
            blockchain={{
              network: chain.name,
              chainId: chain.id,
              configured: IS_DEPLOYED,
              readerReady: Boolean(client),
              loading: enabledOnChain && onChainOwner === undefined,
              contractAddress: IS_DEPLOYED ? contracts.slabVault.address : null,
              tokenId: onChainOwner?.address ? resolvedTokenId : null,
              ownerAddress: onChainOwner?.address ?? null,
            }}
          />

          <section className="relative flex h-full flex-col overflow-hidden rounded-card border border-hairline bg-surface">
            <h2 className="border-b border-hairline px-4 py-3 text-sm font-bold">Activity history</h2>
            <ul
              className="flex flex-1 flex-col divide-y divide-[rgba(255,255,255,0.08)] lg:absolute lg:inset-x-0 lg:bottom-0 lg:top-[45px] lg:grid lg:overflow-y-auto"
              style={{ gridTemplateRows: `repeat(${Math.max(allActivity.length, 1)}, minmax(72px, 1fr))` }}
            >
              {allActivity.map((e, i) => (
                <li key={`${e.txHash}-${i}`} className="flex min-h-[72px] items-center gap-4 p-4">
                  <Badge tone={e.kind === "Mint" ? "accent" : e.kind === "Sale" ? "good" : "neutral"}>
                    {e.kind}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold">{e.price ? usd(e.price) : "—"}</p>
                    <p className="truncate text-[12px] text-muted">
                      From <span className="text-white/80">{e.from}</span> to{" "}
                      <span className="text-white/80">{e.to}</span>
                    </p>
                  </div>
                  <span className="shrink-0 text-[12px] text-dim">
                    <TimeAgo value={e.at} />
                  </span>
                  <span className="hidden shrink-0 items-center gap-1 text-[12px] text-dim sm:flex">
                    <CopyText text={e.txHash} title={truncMiddle(e.txHash, 6, 4)} />
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}

      {/* Buy Confirmation Modal */}
      <Modal open={buyOpen} onClose={() => !buyBusy && setBuyOpen(false)} title="Confirm Purchase">
        <div className="p-5">
          <div className="flex gap-4">
            <div className="w-20 shrink-0">
              <Slab listing={listing} flat />
            </div>
            <div className="min-w-0">
              <p className="text-[14px] font-bold leading-snug">{listing.title}</p>
              <p className="mt-1 text-[12px] text-muted">
                {listing.grader} Cert #{listing.certNumber}
              </p>
              <p className="mt-1 text-[12px] text-muted">{lostView ? "Seller identity hidden" : `Seller: @${currentOwner}`}</p>
            </div>
          </div>

          <dl className="mt-5 space-y-2.5 rounded-2xl bg-surface-2 p-4 text-[13px]">
            <div className="flex justify-between">
              <dt className="text-muted">Item price</dt>
              <dd className="font-semibold">{usd(displayPrice, { cents: true })}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Pokéchain protocol fee {marketFeeBps > 0 ? `(${marketFeeBps / 100}%)` : "(Rule 2)"}</dt>
              <dd className={clsx("font-semibold", marketFeeBps > 0 ? "text-accent" : "text-good")}>
                {marketFeeBps > 0 ? `${marketFeeBps / 100}% (${usd((displayPrice * marketFeeBps) / 10000, { cents: true })})` : "0% ($0.00)"}
              </dd>
            </div>
            {marketFeeBps > 0 ? (
              <div className="flex justify-between text-[12px] text-dim">
                <dt>Seller net proceeds</dt>
                <dd>{usd(displayPrice - (displayPrice * marketFeeBps) / 10000, { cents: true })} USDC</dd>
              </div>
            ) : null}
            <div className="h-px bg-hairline" />
            <div className="flex justify-between">
              <dt className="text-muted">Total payment from your Pokechain account</dt>
              <dd className="text-base font-bold text-accent">{usd(displayPrice, { cents: true })} USDC</dd>
            </div>
          </dl>

          <div className="mt-4 flex items-center justify-between rounded-xl border border-hairline p-3 text-[12px]">
            <span className="text-muted">Your Pokechain account balance:</span>
            <span className="font-bold">
              {user?.address ? `${usd(acct.custodyBalance, { cents: true })} USDC` : usd(balance, { cents: true })}
            </span>
          </div>

          {user?.address && acct.custodyBalance < displayPrice ? (
            <p className="mt-3 text-[12px] text-bad">
              You need {usd(displayPrice - acct.custodyBalance, { cents: true })} more USDC in your Pokechain account. Deposit more before buying.
            </p>
          ) : !user?.address && balance < displayPrice ? (
            <p className="mt-3 text-[12px] text-bad">
              Your demo balance is insufficient. Top up in your account menu.
            </p>
          ) : null}

          <div className="mt-5 flex gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              disabled={buyBusy}
              onClick={() => setBuyOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              disabled={
                buyBusy ||
                (user?.address ? acct.custodyBalance < displayPrice : balance < displayPrice)
              }
              onClick={handleBuy}
            >
              {buyBusy ? "Settling atomically..." : `Pay ${usd(displayPrice, { cents: true })}`}
            </Button>
          </div>
        </div>
      </Modal>

      <OfferModal listing={effectiveListing} open={offerOpen} onClose={() => setOfferOpen(false)} />
    </div>
  );
}

function Thumb({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl border bg-[#101014] p-1 transition",
        active ? "border-accent" : "border-hairline hover:border-white/25",
      )}
    >
      {children}
    </button>
  );
}

function Trust({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <span className="flex items-center gap-2 text-[12px] font-medium text-muted">
      <span className="text-good">{icon}</span>
      {text}
    </span>
  );
}

function Details({
  listing,
  blockchain,
}: {
  listing: Listing;
  blockchain: {
    network: string;
    chainId: number;
    configured: boolean;
    readerReady: boolean;
    loading: boolean;
    contractAddress: string | null;
    tokenId: string | null;
    ownerAddress: string | null;
  };
}) {
  // Older sets share their era's name (e.g. Base, Platinum), so drop the repeat.
  const chips = [
    ...new Set([
    listing.grader,
    `${listing.grade} ${listing.gradeLabel}`,
    String(listing.year),
    listing.series,
    listing.set,
    listing.subject,
    listing.variant,
  ])];
  return (
    <section className="rounded-card border border-hairline bg-surface">
      <h2 className="border-b border-hairline px-4 py-3 text-sm font-bold">Details</h2>
      <div className="p-4">
        <div className="flex flex-wrap gap-2">
          {chips.map((c) => (
            <span
              key={c}
              className="rounded-lg bg-surface-2 px-2.5 py-1.5 text-[12px] font-semibold text-muted"
            >
              {c}
            </span>
          ))}
        </div>

        <div className="mt-4 border-t border-hairline pt-4">
          <p className="mb-2 text-[12px] font-bold uppercase tracking-wide text-muted">Blockchain details</p>
          <dl className="space-y-2.5 text-[12px]">
            <BlockchainRow label="Network" value={blockchain.network} />
            <BlockchainRow label="Chain ID" value={String(blockchain.chainId)} />
            {blockchain.contractAddress ? (
              <BlockchainRow label="Contract address" value={blockchain.contractAddress} copy />
            ) : null}
            {blockchain.tokenId && blockchain.ownerAddress ? (
              <>
                <BlockchainRow label="Token ID" value={blockchain.tokenId} copy />
                <BlockchainRow label="Owner address" value={blockchain.ownerAddress} copy />
              </>
            ) : null}
            {!blockchain.tokenId || !blockchain.ownerAddress ? (
              <div>
                <dt className="sr-only">Token record status</dt>
                <dd className="rounded-lg bg-surface-2 px-3 py-2 text-[12px] leading-relaxed text-muted">
                  {!blockchain.configured
                    ? `No SlabVault deployment is configured for ${blockchain.network}.`
                    : !blockchain.readerReady
                      ? "The blockchain read provider is not available."
                      : blockchain.loading
                        ? "Reading token data from the blockchain…"
                        : "No on-chain token was found for this listing on the selected network."}
                </dd>
              </div>
            ) : null}
          </dl>
        </div>
      </div>
    </section>
  );
}

function BlockchainRow({ label, value, copy = false }: { label: string; value: string; copy?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-hairline/70 pb-2 last:border-0">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="min-w-0 break-all text-right font-semibold text-white">
        {copy ? <CopyText text={value} title={value} /> : value}
      </dd>
    </div>
  );
}
