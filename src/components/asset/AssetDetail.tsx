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
  Tag,
  Truck,
} from "lucide-react";
import Image from "next/image";
import { useMemo, useState } from "react";
import { contracts } from "@/lib/chain/config";
import { BRAND } from "@/lib/brand";
import { GRADERS, GRADE_STEPS } from "@/lib/pools";
import { population, salesFor } from "@/lib/catalog";
import { shortDate, truncMiddle, usd } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { Grader, Listing } from "@/lib/types";
import { TokenRecord } from "../chain/TokenRecord";
import { OfferModal } from "../modals/OfferModal";
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
    resolve,
    isOwned,
    isWatched,
    toggleWatch,
    requireAuth,
    comments,
    addComment,
    pushToast,
    isListed,
    negotiations,
  } = useStore();

  const listing = resolve(base);
  // A slab minted through SlabVault: its facts come from the chain, not the catalogue.
  const onChainTokenId =
    listing.contract.toLowerCase() === contracts.slabVault.address.toLowerCase() ? listing.tokenId : null;
  const owned = isOwned(listing.id);
  const listed = isListed(listing.id);

  const [offerOpen, setOfferOpen] = useState(false);
  const [view, setView] = useState<"slab" | "front" | "back">("slab");
  const [spin, setSpin] = useState(false);
  const [draft, setDraft] = useState("");

  const localComments = comments[listing.id] ?? [];
  const allComments = [...localComments, ...listing.comments];
  const openChats = Object.values(negotiations).filter(
    (n) => n.listingId === listing.id && n.status === "open",
  ).length;

  return (
    <div className="px-4 py-5 lg:px-6">
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

          {/* comments */}
          <section className="mt-6">
            <h2 className="mb-3 text-base font-bold">Comments</h2>
            <div className="rounded-card border border-hairline bg-surface p-4">
              <div className="flex gap-2">
                <input
                  className={inputClass}
                  placeholder="Add a comment…"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <Button
                  variant="secondary"
                  onClick={() => {
                    if (!draft.trim()) return;
                    if (!requireAuth()) return;
                    addComment(listing.id, draft.trim());
                    setDraft("");
                  }}
                >
                  Post
                </Button>
              </div>
              {allComments.length ? (
                <ul className="mt-4 space-y-4">
                  {allComments.map((c) => (
                    <li key={c.id} className="flex gap-3">
                      <Avatar name={c.user} size={28} />
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold">
                          {c.user}{" "}
                          <span className="font-normal text-dim">
                            · <TimeAgo value={c.at} />
                          </span>
                        </p>
                        <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{c.text}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-8 text-center text-[13px] text-dim">
                  No comments yet. Be the first to comment!
                </p>
              )}
            </div>
          </section>

          {/* activity */}
          <section className="mt-6">
            <h2 className="mb-3 text-base font-bold">Activity history</h2>
            <ul className="divide-y divide-[rgba(255,255,255,0.08)] overflow-hidden rounded-card border border-hairline bg-surface">
              {listing.activity.map((e, i) => (
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
                    {truncMiddle(e.txHash, 6, 4)}
                    <ExternalLink size={12} />
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
                href={`/profile/${listing.owner}`}
                className="flex items-center gap-1.5 font-semibold text-accent hover:underline"
              >
                <Avatar name={listing.owner} size={18} />
                {listing.owner}
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
                    {listed ? "Asking" : owned ? (onChainTokenId ? "Declared value (on-chain)" : "Market value") : "Last asked"}
                  </p>
                  <p className="mt-1 text-[30px] font-bold leading-none">
                    {usd(listed || !owned ? listing.price : listing.fmv, { cents: Boolean(onChainTokenId) })}
                  </p>
                </div>
              </div>

              {owned ? (
                <div className="mt-4 grid gap-2">
                  {listed ? (
                    <Link href={`/trades?listing=${listing.id}`}>
                      <Button size="lg" className="w-full">
                        <MessagesSquare size={16} />
                        Offers on this slab{openChats ? ` (${openChats})` : ""}
                      </Button>
                    </Link>
                  ) : (
                    <p className="text-[12px] text-muted">
                      List this slab from your Vault to put it on the marketplace and receive offers.
                    </p>
                  )}
                  <Link href={listed ? "/vault?tab=listed" : "/vault"}>
                    <Button size="lg" variant={listed ? "secondary" : "primary"} className="w-full">
                      {listed ? null : <Tag size={16} />}
                      {listed ? "Manage listing" : "List it from your Vault"}
                    </Button>
                  </Link>
                </div>
              ) : listed ? (
                <Button
                  size="lg"
                  className="mt-4 w-full"
                  onClick={() => requireAuth(() => setOfferOpen(true)) && setOfferOpen(true)}
                >
                  <Gavel size={16} />
                  Make an offer
                </Button>
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
                <span className="text-[13px] text-muted">{onChainTokenId ? "Declared value (on-chain)" : "Market value"}</span>
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
          <Details listing={listing} />
        </div>
      </div>

      <OfferModal listing={listing} open={offerOpen} onClose={() => setOfferOpen(false)} />
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
  const sales = useMemo(() => salesFor(listing, grader, grade), [listing, grader, grade]);

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
            {sales.slice(0, 3).map((s) => (
              <li key={s.date} className="flex items-center justify-between py-2.5 text-[13px]">
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
          {sales.map((s) => (
            <li key={s.date} className="flex items-center justify-between py-3 text-[13px]">
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
