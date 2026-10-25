"use client";

import clsx from "clsx";
import Link from "next/link";
import {
  MessagesSquare,
  BadgeCheck,
  Clock,
  ExternalLink,
  Gavel,
  Heart,
  Play,
  Share2,
  ShieldCheck,
  ShoppingCart,
  Tag,
  Truck,
} from "lucide-react";
import Image from "next/image";
import { useMemo, useState } from "react";
import { BRAND } from "@/lib/brand";
import { GRADERS, GRADE_STEPS } from "@/lib/pools";
import { population, salesFor } from "@/lib/catalog";
import { shortDate, truncMiddle, usd } from "@/lib/format";
import { useStore } from "@/lib/store";
import { useMarketChain } from "@/lib/chain/useMarketChain";
import { useOnchainAccount } from "@/lib/chain/useOnchainAccount";
import { DEPLOY_BLOCK, IS_DEPLOYED, contracts, fromUsdcUnits, shortHash } from "@/lib/chain/config";
import { zeroAddress } from "viem";
import { usePublicClient, useWatchContractEvent } from "wagmi";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ActivityEvent, Grader, Listing, Sale } from "@/lib/types";
import { CopyText } from "../chain/ChainConsole";
import { TokenRecord } from "../chain/TokenRecord";
import { OfferModal } from "../modals/OfferModal";
import { SoldBanner } from "../negotiations/SoldBanner";
import { CardBack } from "../slab/CardBack";
import { Slab, SlabStage } from "../slab/Slab";
import {
  Avatar,
  Badge,
  Button,
  Countdown,
  Modal,
  Sparkline,
  TimeAgo,
  inputClass,
} from "../ui/primitives";

export function AssetDetail({ listing: base }: { listing: Listing }) {
  const {
    user,
    balance,
    resolve,
    isOwned,
    isWatched,
    toggleWatch,
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
  const acct = useOnchainAccount();
  const client = usePublicClient();
  const queryClient = useQueryClient();

  const tokenIdBigInt = resolvedTokenId ? BigInt(resolvedTokenId) : null;
  const enabledOnChain = Boolean(client && tokenIdBigInt !== null && IS_DEPLOYED);

  const { data: onChainMarketListing } = useQuery({
    queryKey: ["token-market-listing", resolvedTokenId],
    enabled: enabledOnChain,
    refetchInterval: 2000,
    refetchIntervalInBackground: true,
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
    refetchInterval: 2000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
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

  const currentOwner = enabledOnChain && onChainOwner?.handle
    ? onChainOwner.handle
    : listing.owner;

  const currentOwnerAddress = enabledOnChain && onChainOwner?.address
    ? onChainOwner.address
    : listing.ownerAddress;

  const owned = enabledOnChain && onChainOwner && user?.address
    ? onChainOwner.address.toLowerCase() === user.address.toLowerCase()
    : isOwned(listing.id);

  const listed = enabledOnChain
    ? onChainMarketListing !== undefined
      ? Boolean(onChainMarketListing)
      : isListed(listing.id)
    : isListed(listing.id);

  const displayPrice = enabledOnChain && onChainMarketListing
    ? onChainMarketListing.price
    : (listed || !owned ? listing.price : listing.fmv);

  const effectiveListing = useMemo(
    () => ({
      ...listing,
      owner: currentOwner,
      ownerAddress: currentOwnerAddress,
      price: displayPrice,
    }),
    [listing, currentOwner, currentOwnerAddress, displayPrice],
  );

  const refreshActivity = () => {
    if (resolvedTokenId) {
      void queryClient.invalidateQueries({ queryKey: ["token-activity", resolvedTokenId] });
      void queryClient.invalidateQueries({ queryKey: ["token-market-listing", resolvedTokenId] });
      void queryClient.invalidateQueries({ queryKey: ["token-owner", resolvedTokenId] });
      void queryClient.invalidateQueries({ queryKey: ["market-active-listings"] });
    }
  };

  useWatchContractEvent({
    ...contracts.slabMarket,
    eventName: "CardPurchased",
    enabled: enabledOnChain,
    poll: true,
    pollingInterval: 1000,
    onLogs: refreshActivity,
  });

  useWatchContractEvent({
    ...contracts.slabMarket,
    eventName: "CardListed",
    enabled: enabledOnChain,
    poll: true,
    pollingInterval: 1000,
    onLogs: refreshActivity,
  });

  useWatchContractEvent({
    ...contracts.slabVault,
    eventName: "Transfer",
    enabled: enabledOnChain,
    poll: true,
    pollingInterval: 1000,
    onLogs: refreshActivity,
  });

  useWatchContractEvent({
    ...contracts.slabVault,
    eventName: "SlabVaulted",
    enabled: enabledOnChain,
    poll: true,
    pollingInterval: 1000,
    onLogs: refreshActivity,
  });

  const { data: onChainEvents = [] } = useQuery({
    queryKey: ["token-activity", listing.tokenId],
    enabled: enabledOnChain,
    refetchInterval: 3000,
    refetchIntervalInBackground: true,
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

          events.push({
            kind: "Transfer",
            from: fromName,
            to: toName,
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
  const [view, setView] = useState<"slab" | "front" | "back">("slab");
  const [spin, setSpin] = useState(false);

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

  return (
    <div className="px-4 py-5 lg:px-6">
      <div className="mb-4 empty:hidden">
        <SoldBanner tokenId={listing.tokenId} relisted={listed} />
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        {/* ---------------- left ---------------- */}
        <div className="min-w-0">
          <div className="relative overflow-hidden rounded-card border border-hairline bg-[#0c0c10]">
            <div className="aspect-[4/3] w-full sm:aspect-[16/11]">
              {view === "slab" ? (
                <SlabStage listing={listing} spinning={spin} />
              ) : (
                <div className="flex h-full w-full items-center justify-center p-8">
                  <div className="@container relative aspect-[63/88] h-[86%] max-h-[460px] overflow-hidden rounded-[4.5cqw] shadow-[0_30px_60px_-20px_rgba(0,0,0,0.9)]">
                    {view === "front" ? (
                      <Image
                        src={listing.image}
                        alt={`${listing.subject} card front`}
                        fill
                        sizes="(min-width: 1280px) 340px, 60vw"
                        className="object-cover"
                        preload
                      />
                    ) : (
                      <CardBack />
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2.5 border-t border-hairline p-3">
              <button
                onClick={() => {
                  setView("slab");
                  setSpin((v) => !v);
                }}
                className={clsx(
                  "grid h-14 w-14 shrink-0 place-items-center rounded-xl border transition",
                  spin ? "border-accent bg-accent/15 text-accent" : "border-hairline bg-surface text-muted hover:text-white",
                )}
                aria-label="Rotate slab"
              >
                <Play size={17} />
              </button>
              <Thumb active={view === "slab"} onClick={() => setView("slab")}>
                <Slab listing={listing} flat />
              </Thumb>
              <Thumb active={view === "front"} onClick={() => setView("front")}>
                <div className="relative aspect-[63/88] w-full overflow-hidden rounded">
                  <Image src={listing.image} alt="" fill sizes="56px" className="object-cover" />
                </div>
              </Thumb>
              <Thumb active={view === "back"} onClick={() => setView("back")}>
                <div className="@container aspect-[63/88] w-full overflow-hidden rounded">
                  <CardBack />
                </div>
              </Thumb>
              <p className="ml-auto hidden text-[12px] text-dim sm:block">
                Move your cursor over the slab to tilt it
              </p>
            </div>
          </div>

          {/* activity */}
          <section className="mt-6">
            <h2 className="mb-3 text-base font-bold">Activity history</h2>
            <ul className="divide-y divide-[rgba(255,255,255,0.08)] overflow-hidden rounded-card border border-hairline bg-surface">
              {allActivity.map((e, i) => (
                <li key={`${e.txHash}-${i}`} className="flex items-center gap-4 p-4">
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

        {/* ---------------- right ---------------- */}
        <div className="min-w-0 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <Badge tone="neutral" className="gap-1.5 px-2.5 py-1.5">
              <ShieldCheck size={13} className="text-good" />
              Vaulted and insured
            </Badge>
            <div className="flex items-center gap-2">
              <button
                onClick={() => requireAuth(() => toggleWatch(listing.id)) && toggleWatch(listing.id)}
                className="flex h-9 items-center gap-1.5 rounded-xl border border-hairline px-3 text-[13px] font-semibold text-muted transition hover:text-white"
              >
                <Heart
                  size={15}
                  className={isWatched(listing.id) ? "text-bad" : ""}
                  fill={isWatched(listing.id) ? "currentColor" : "none"}
                />
                {listing.likes + (isWatched(listing.id) ? 1 : 0)}
              </button>
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
          </div>

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

          {/* purchase box */}
          <div className="overflow-hidden rounded-card border border-hairline bg-surface">
            <div className="flex items-center gap-2 border-b border-hairline px-4 py-3 text-[13px] text-muted">
              <Clock size={14} />
              {!listed ? (
                <span>{owned ? "Held in your vault, not listed" : "Not listed right now"}</span>
              ) : (
                <span>
                  Listing renews in:{" "}
                  <Countdown to={listing.endsAt} every={7 * 86_400_000} className="font-semibold text-white" />
                </span>
              )}
            </div>

            <div className="p-4">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">
                    {listed ? "Asking" : owned ? "Market value" : "Last asked"}
                  </p>
                  <p className="mt-1 text-[30px] font-bold leading-none">
                    {usd(displayPrice, { cents: Boolean(onChainTokenId) })}
                  </p>
                </div>
              </div>

              {owned ? (
                <div className="mt-4 grid gap-2">
                  {listed ? (
                    <>
                      <Link href={`/trades?listing=${listing.id}`}>
                        <Button size="lg" className="w-full">
                          <MessagesSquare size={16} />
                          Offers on this slab{openChats ? ` (${openChats})` : ""}
                        </Button>
                      </Link>
                      <Button
                        size="lg"
                        variant="secondary"
                        className="w-full"
                        disabled={delisting}
                        onClick={handleDelist}
                      >
                        {delisting ? "Delisting..." : "Delist from Marketplace"}
                      </Button>
                    </>
                  ) : (
                    <>
                      <p className="text-[12px] text-muted">
                        List this slab from your Vault to put it on the marketplace and receive offers.
                      </p>
                      <Link href="/vault">
                        <Button size="lg" className="w-full">
                          <Tag size={16} />
                          List it from your Vault
                        </Button>
                      </Link>
                    </>
                  )}
                </div>
              ) : listed ? (
                <div className="mt-4 grid gap-2">
                  <Button
                    size="lg"
                    className="w-full"
                    onClick={() => requireAuth(() => setBuyOpen(true)) && setBuyOpen(true)}
                  >
                    <ShoppingCart size={16} />
                    Buy now for {usd(displayPrice)}
                  </Button>
                  <Button
                    size="lg"
                    variant="secondary"
                    className="w-full"
                    onClick={() => requireAuth(() => setOfferOpen(true)) && setOfferOpen(true)}
                  >
                    <Gavel size={16} />
                    Make an offer
                  </Button>
                  <p className="text-center text-[11px] text-dim">
                    0% platform fee · Atomic on-chain settlement
                  </p>
                </div>
              ) : (
                <p className="mt-4 text-[12px] text-muted">This slab is not for sale right now.</p>
              )}
            </div>
          </div>

          {/* trust strip */}
          <div className="grid grid-cols-1 gap-3 rounded-card border border-hairline bg-surface p-4 sm:grid-cols-3">
            <Trust icon={<BadgeCheck size={15} />} text="Authenticity guarantee" />
            <Trust icon={<ShieldCheck size={15} />} text="Vaulted and insured for free" />
            <Trust icon={<Truck size={15} />} text="Ship to you anytime" />
          </div>

          {/* pricing */}
          <section className="rounded-card border border-hairline bg-surface">
            <h2 className="border-b border-hairline px-4 py-3 text-sm font-bold">
              {BRAND.name} pricing
            </h2>
            <div className="space-y-3 p-4">
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-muted">Market value</span>
                <span className="text-lg font-bold">{usd(listing.fmv, { cents: Boolean(onChainTokenId) })}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-muted">Confidence</span>
                <span className="flex items-center gap-2 text-[13px] font-semibold">
                  {listing.confidence}
                  <span className="flex gap-1">
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className={clsx(
                          "h-2 w-2 rounded-full",
                          i <
                            (listing.confidence === "High" ? 3 : listing.confidence === "Medium" ? 2 : 1)
                            ? "bg-good"
                            : "bg-surface-3",
                        )}
                      />
                    ))}
                  </span>
                </span>
              </div>
              <Sparkline
                values={[...listing.sales].reverse().map((s) => s.price)}
                className="h-10 w-full"
              />
            </div>
          </section>

          {onChainTokenId ? <TokenRecord tokenId={onChainTokenId} /> : null}
          <PriceHistory listing={listing} />
          <Details listing={effectiveListing} />
        </div>
      </div>

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
              <p className="mt-1 text-[12px] text-muted">Seller: @{currentOwner}</p>
            </div>
          </div>

          <dl className="mt-5 space-y-2.5 rounded-2xl bg-surface-2 p-4 text-[13px]">
            <div className="flex justify-between">
              <dt className="text-muted">Item price</dt>
              <dd className="font-semibold">{usd(displayPrice, { cents: true })}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Pokéchain fee (Rule 2)</dt>
              <dd className="font-semibold text-good">0% ($0.00)</dd>
            </div>
            <div className="h-px bg-hairline" />
            <div className="flex justify-between">
              <dt className="text-muted">Total payment from your Pokechain account</dt>
              <dd className="text-base font-bold text-accent">{usd(displayPrice, { cents: true })} Pokechain credits</dd>
            </div>
          </dl>

          <div className="mt-4 flex items-center justify-between rounded-xl border border-hairline p-3 text-[12px]">
            <span className="text-muted">Your Pokechain account balance:</span>
            <span className="font-bold">
              {user?.address ? `${usd(acct.custodyBalance, { cents: true })} Pokechain credits` : usd(balance, { cents: true })}
            </span>
          </div>

          {user?.address && acct.custodyBalance < displayPrice ? (
            <p className="mt-3 text-[12px] text-bad">
              You need {usd(displayPrice - acct.custodyBalance, { cents: true })} more Pokechain credits in your Pokechain account. Deposit more before buying.
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

function PriceHistory({ listing }: { listing: Listing }) {
  const [grader, setGrader] = useState<Grader>(listing.grader);
  const [grade, setGrade] = useState<number>(listing.grade);
  const [allOpen, setAllOpen] = useState(false);
  const sales = useMemo(() => {
    const raw = salesFor(listing, grader, grade);
    const seen = new Set<string>();
    const deduped: Sale[] = [];
    for (const s of raw) {
      const key = `${s.date}-${s.price}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(s);
      }
    }
    return deduped;
  }, [listing, grader, grade]);

  return (
    <section className="rounded-card border border-hairline bg-surface">
      <h2 className="border-b border-hairline px-4 py-3 text-sm font-bold">Price history</h2>
      <div className="space-y-3 p-4">
        <div className="flex gap-1.5 rounded-xl bg-surface-2 p-1">
          {GRADERS.map((g) => (
            <button
              key={g}
              onClick={() => setGrader(g)}
              className={clsx(
                "h-8 flex-1 rounded-lg text-[12px] font-bold transition",
                grader === g ? "bg-accent text-white" : "text-muted hover:text-white",
              )}
            >
              {g}
            </button>
          ))}
        </div>
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
          {GRADE_STEPS.map((g) => (
            <button
              key={g}
              onClick={() => setGrade(g)}
              className={clsx(
                "h-8 min-w-[42px] shrink-0 rounded-lg text-[12px] font-bold transition",
                grade === g ? "bg-accent text-white" : "bg-surface-2 text-muted hover:text-white",
              )}
            >
              {g}
            </button>
          ))}
        </div>

        {sales.length ? <Sparkline values={[...sales].reverse().map((s) => s.price)} className="h-12 w-full" /> : null}

        <div className="flex items-center justify-between pt-1">
          <span className="text-[13px] font-bold">
            {grader} {grade}
          </span>
          {sales.length > 3 ? (
            <button
              onClick={() => setAllOpen(true)}
              className="text-[12px] font-semibold text-accent hover:underline"
            >
              View all sales
            </button>
          ) : null}
        </div>

        {sales.length ? (
          <ul className="divide-y divide-[rgba(255,255,255,0.08)]">
            {sales.slice(0, 3).map((s, idx) => (
              <li key={`${s.date}-${s.price}-${idx}`} className="flex items-center justify-between py-2.5 text-[13px]">
                <span className="text-muted">{shortDate(s.date)}</span>
                <span className="font-semibold">{usd(s.price)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-6 text-center text-[13px] text-dim">
            No recorded sales for {grader} {grade}.
          </p>
        )}
      </div>

      <Modal open={allOpen} onClose={() => setAllOpen(false)} title={`${grader} ${grade} sales`}>
        <ul className="divide-y divide-[rgba(255,255,255,0.08)] p-5 pt-0">
          {sales.map((s, idx) => (
            <li key={`${s.date}-${s.price}-${idx}`} className="flex items-center justify-between py-3 text-[13px]">
              <span className="text-muted">{shortDate(s.date)}</span>
              <span className="font-semibold">{usd(s.price)}</span>
            </li>
          ))}
        </ul>
      </Modal>
    </section>
  );
}

function Details({ listing }: { listing: Listing }) {
  const [open, setOpen] = useState(false);
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
  const pop = population(listing);

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

        <div className="mt-4 space-y-2.5 border-t border-hairline pt-4 text-[13px]">
          <Row label="Token standard" value="ERC-721" />
          <Row label="Chain" value={listing.chain} />
          <Row label="Token ID" value={truncMiddle(listing.tokenId, 6, 4)} />
          <Row label="Contract" value={truncMiddle(listing.contract, 6, 4)} />
          <Row label="Owner address" value={truncMiddle(listing.ownerAddress, 6, 4)} />
          <Row label="Card data" value="pokemontcg.io" />
        </div>

        {open ? (
          <div className="mt-4 border-t border-hairline pt-4">
            <p className="mb-2 text-[12px] font-bold uppercase tracking-wide text-muted">
              {listing.grader} population report
            </p>
            <ul className="grid grid-cols-3 gap-2">
              {pop.map((p) => (
                <li
                  key={p.grade}
                  className={clsx(
                    "rounded-xl px-2.5 py-2 text-center",
                    String(listing.grade) === p.grade ? "bg-accent/15" : "bg-surface-2",
                  )}
                >
                  <p className="text-[11px] text-muted">Grade {p.grade}</p>
                  <p className="text-[13px] font-bold">{p.count.toLocaleString()}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <button
          onClick={() => setOpen((v) => !v)}
          className="mt-4 w-full rounded-xl bg-surface-2 py-2.5 text-[12px] font-bold text-muted transition hover:bg-surface-3 hover:text-white"
        >
          {open ? "Show less" : "Show more"}
        </button>
      </div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}
