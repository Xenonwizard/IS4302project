"use client";

import clsx from "clsx";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Blocks, Grid2x2, Grid3x3, Lock, MessagesSquare, Package, Route, ShieldCheck, Tag, Truck } from "lucide-react";
import type { Address } from "viem";
import { useMemo, useState } from "react";
import { BRAND } from "@/lib/brand";
import { getListing } from "@/lib/catalog";
import { usd } from "@/lib/format";
import { bidValue, pendingOffer } from "@/lib/negotiation";
import { useEscrowedByMe } from "@/lib/chain/trades";
import { useLostSlabs, useStore } from "@/lib/store";
import { IS_DEPLOYED } from "@/lib/chain/config";
import { useMarketChain } from "@/lib/chain/useMarketChain";
import { useLostReport } from "@/lib/chain/useLostSlabRecovery";
import type { Listing, VaultItem, VaultLossReport } from "@/lib/types";
import { RedeemModal } from "../chain/RedeemModal";
import { Slab } from "../slab/Slab";
import { Badge, Button, Field, Modal, TimeAgo, inputClass } from "../ui/primitives";
import { ListForSaleForm } from "./ListForSaleForm";
import { Empty, LoginPrompt } from "./shared";

type Tab = "all" | "awaiting" | "listed" | "unlisted" | "lost";

const TABS: { value: Tab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "awaiting", label: "Awaiting vault" },
  { value: "listed", label: "Listed" },
  { value: "unlisted", label: "Unlisted" },
  { value: "lost", label: "Lost" },
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
    vaultLosses,
    reportVaultLost,
    pendingLossDecisions,
    pushToast,
  } = useStore();
  const { cancelListing } = useMarketChain();
  const lost = useLostReport();
  const lostSlabs = useLostSlabs();
  // A slab reported lost on-chain: its report comes from SlabVault, not this browser.
  const chainLoss = (entry: VaultItem) =>
    entry.token ? lostSlabs.find((item) => item.listing.tokenId === entry.token!.tokenId) : undefined;
  const lossFor = (entry: VaultItem, listing: Listing) => chainLoss(entry)?.loss ?? vaultLosses[listing.id];
  const lostTokenId = (entry: VaultItem) => (chainLoss(entry) ? entry.token!.tokenId : undefined);
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
  const [missingTarget, setMissingTarget] = useState<{ entry: VaultItem; listing: Listing } | null>(null);
  const [bountyTarget, setBountyTarget] = useState<{ entry: VaultItem; listing: Listing } | null>(null);
  const [missingDetails, setMissingDetails] = useState("");
  const [awaitingReportTarget, setAwaitingReportTarget] = useState<{ entry: VaultItem; listing: Listing } | null>(null);
  const [awaitingReportDetails, setAwaitingReportDetails] = useState("");
  const [reportingAwaiting, setReportingAwaiting] = useState(false);
  const [reportingMissing, setReportingMissing] = useState(false);
  const [insuranceWithdrawTarget, setInsuranceWithdrawTarget] = useState<{ entry: VaultItem; listing: Listing } | null>(null);
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
  const hasPendingDecision = (listing: Listing) => Object.keys(pendingLossDecisions).some(
    (id) => id === listing.id || id === listing.tokenId || id === `token-${listing.tokenId}`,
  );
  // Insurance-claimed slabs had their NFT burned: they're tracked in Status Center, not the Vault.
  const items = allItems.filter(
    (i) => i.entry.status !== "Withdrawn" && lossFor(i.entry, i.listing)?.resolution !== "insurance",
  );
  const lostItems = items.filter((i) => lossFor(i.entry, i.listing)?.published);
  const awaiting = items.filter((i) => {
    if (i.entry.status !== "Awaiting vaulting") return false;
    const loss = lossFor(i.entry, i.listing);
    return !hasPendingDecision(i.listing) && !loss?.published && !loss?.resolution;
  });

  const totalValue = items.reduce((sum, i) => sum + (i.entry.status === "Listed" ? i.entry.listedPrice ?? i.listing.price : 0), 0);
  const listed = items.filter((i) => i.entry.status === "Listed" && !lossFor(i.entry, i.listing)?.published);
  const unlisted = items.filter((i) => i.entry.status === "Vaulted" && !lossFor(i.entry, i.listing)?.published);
  const counts: Record<Tab, number> = {
    all: items.length,
    awaiting: awaiting.length,
    listed: listed.length,
    unlisted: unlisted.length,
    lost: lostItems.length,
  };

  const handleReportLost = async (listingId: string, certNumber: string, details: string) => {
    setReportingAwaiting(true);
    try {
      const reportDetails = details.trim() || "Card has been awaiting vaulting longer than expected";
      reportVaultLost(listingId, reportDetails, false, certNumber);
      pushToast({ title: "Vaulting delay reported", body: "The NFT remains visible while the vault team investigates.", tone: "success" });
      setAwaitingReportTarget(null);
      setAwaitingReportDetails("");
    } catch (err) {
      pushToast({ title: "Could not report slab", body: (err as Error).message, tone: "error" });
    } finally {
      setReportingAwaiting(false);
    }
  };

  const reportMissingFromVault = async () => {
    if (!missingTarget) return;
    setReportingMissing(true);
    try {
      const { entry, listing } = missingTarget;
      if (entry.status === "Listed" && user?.address && entry.token?.tokenId) {
        await cancelListing(entry.token.tokenId);
      }
      const inTransit = entry.status === "Awaiting vaulting";
      await lost.report(
        listing.id,
        entry.token?.tokenId,
        missingDetails.trim() || (inTransit ? "Reported lost while in transit to the vault" : "Reported missing from the vault"),
        { inTransit },
      );
      setMissingTarget(null);
      setMissingDetails("");
    } catch (err) {
      pushToast({ title: "Could not report card missing", body: (err as Error).message, tone: "error" });
    } finally {
      setReportingMissing(false);
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
          ? "Stored by Collector Crypt."
          : `Held in the ${BRAND.vaultCity} vault, insured.`}
        {" "}
        <Link href="/submissions" className="font-semibold text-accent hover:underline">Track inbound requests in Status Center.</Link>
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
        {tab === "all" || tab === "awaiting" || tab === "listed" || tab === "unlisted" || tab === "lost" ? (
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
                      inOffer={entry.token ? escrowed[entry.token.tokenId] : undefined}
                      // A slab not yet vaulted starts with a private delay report for Pokechain to investigate;
                      // only a vaulted one goes straight to an on-chain lost report.
                      onReportLost={
                        entry.status === "Awaiting vaulting"
                          ? () => setAwaitingReportTarget({ entry, listing })
                          : entry.token?.tokenId
                            ? () => setMissingTarget({ entry, listing })
                            : undefined
                      }
                      investigationComplete={hasPendingDecision(listing)}
                      loss={lossFor(entry, listing)}
                      onAddBounty={() => setBountyTarget({ entry, listing })}
                      onWithdrawInsurance={() => setInsuranceWithdrawTarget({ entry, listing })}
                    />
                  </div>
                );
              })}
            </div>
          ) : tab === "all" ? (
            <Empty
              icon={<Package size={24} />}
              title="No slabs yet"
              body="Add a graded slab, or win one with an offer in a negotiation room. Vaulted slabs land here; inbound requests stay in Status Center."
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
                <AwaitingSlabCard
                  key={listing.id}
                  entry={entry}
                  listing={listing}
                  loss={lossFor(entry, listing)}
                  investigationComplete={hasPendingDecision(listing)}
                  onReportLost={() => setAwaitingReportTarget({ entry, listing })}
                  onManageBounty={() => setBountyTarget({ entry, listing })}
                  onWithdrawInsurance={() => setInsuranceWithdrawTarget({ entry, listing })}
                />
              ))}
            </div>
          ) : (
            <Empty icon={<Package size={24} />} title="Nothing awaiting vaulting" body="Newly received slabs will appear here until Collector Crypt completes vaulting." />
          )
        ) : null}

        {tab === "lost" ? (
          lostItems.length ? (
            <div className={clsx(
              "grid gap-3",
              gridSize === "small" ? "grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-9" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-7",
            )}>
              {lostItems.map(({ entry, listing }, index) => (
                <div
                  key={listing.id}
                  className={clsx("min-w-0", index < 12 && "fade-up motion-reduce:animate-none")}
                  style={index < 12 ? { animationDelay: `${index * 22}ms` } : undefined}
                >
                  <SlabCard
                    entry={entry}
                    listing={listing}
                    size={gridSize}
                    onManage={() => setTab("listed")}
                    onSell={() => setSellTarget({ ...listing, tokenId: entry.token?.tokenId ?? listing.tokenId })}
                    onShip={() => (user.address ? setRedeemTarget({ entry, listing }) : requestShipping(listing.id))}
                    loss={lossFor(entry, listing)}
                    onAddBounty={() => setBountyTarget({ entry, listing })}
                    onWithdrawInsurance={() => setInsuranceWithdrawTarget({ entry, listing })}
                  />
                </div>
              ))}
            </div>
          ) : (
            <Empty icon={<Package size={24} />} title="No lost cards" body="Cards you publish to Lost Cards will be stored here while their report or bounty remains active." />
          )
        ) : null}


        {tab === "listed" ? (
          listed.length ? (
            <div className={clsx(
              "grid gap-3",
              gridSize === "small"
                ? "grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-9"
                : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-7",
            )}>
              {listed.map(({ entry, listing }, index) => {
                const chats = Object.values(negotiations).filter(
                  (n) => n.listingId === listing.id && n.seller === user.username && n.status === "open",
                );
                const offers = chats.map(pendingOffer).filter((m) => m?.offer);
                const best = Math.max(0, ...offers.map((m) => bidValue(m!.offer!)));
                return (
                  <div
                    key={listing.id}
                    className={clsx("min-w-0", index < 12 && "fade-up motion-reduce:animate-none")}
                    style={index < 12 ? { animationDelay: `${index * 22}ms` } : undefined}
                  >
                    <ListedSlabCard
                      entry={entry}
                      listing={listing}
                      size={gridSize}
                      chats={chats.length}
                      offers={offers.length}
                      bestOffer={best}
                      delisting={delistingId === listing.id}
                      onDelist={() => handleDelist(listing.id, entry.token?.tokenId ?? listing.tokenId)}
                    />
                  </div>
                );
              })}
            </div>
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

      <Modal open={Boolean(insuranceWithdrawTarget)} onClose={() => setInsuranceWithdrawTarget(null)} title="Withdraw lost-card listing" width="max-w-sm">
        {insuranceWithdrawTarget ? (
          <div className="space-y-4 p-5">
            <p className="text-[13px] leading-relaxed text-muted">
              Are you sure you want to withdraw <span className="font-semibold text-white">{insuranceWithdrawTarget.listing.title}</span> from the Lost registry and your active Vault?
            </p>
            <div className="rounded-xl border border-warn/25 bg-warn/10 p-3 text-[12px] leading-relaxed text-muted">
              Any bounty is refunded to your balance and the slab will never be vaulted. Your insurance claim then goes to the vault provider.
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setInsuranceWithdrawTarget(null)}>Keep card</Button>
              <Button
                variant="danger"
                className="flex-1"
                onClick={() => {
                  const { entry, listing } = insuranceWithdrawTarget;
                  setInsuranceWithdrawTarget(null);
                  void lost.writeOff(listing.id, entry.token?.tokenId, lossFor(entry, listing)?.details).catch((err: Error) =>
                    pushToast({ title: "Could not claim insurance", body: err.message, tone: "error" }),
                  );
                }}
              >
                Withdraw and claim insurance
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(awaitingReportTarget)}
        onClose={() => {
          if (reportingAwaiting) return;
          setAwaitingReportTarget(null);
          setAwaitingReportDetails("");
        }}
        title="Report vaulting delay"
        width="max-w-sm"
      >
        {awaitingReportTarget ? (
          <div className="space-y-4 p-5">
            <p className="text-[13px] leading-relaxed text-muted">
              Tell us what happened with <span className="font-semibold text-white">{awaitingReportTarget.listing.title}</span>. Use this when the card has been awaiting vaulting longer than expected.
            </p>
            <p className="text-[12px] text-dim">Submitted <TimeAgo value={awaitingReportTarget.entry.acquiredAt} /></p>
            <Field label="What happened?">
              <textarea
                className={`${inputClass} h-24 resize-none py-2.5`}
                value={awaitingReportDetails}
                onChange={(event) => setAwaitingReportDetails(event.target.value)}
                placeholder="The card has not been vaulted yet…"
                disabled={reportingAwaiting}
              />
            </Field>
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setAwaitingReportTarget(null)} disabled={reportingAwaiting}>Cancel</Button>
              <Button
                variant="danger"
                className="flex-1"
                onClick={() => void handleReportLost(awaitingReportTarget.listing.id, awaitingReportTarget.listing.certNumber, awaitingReportDetails)}
                disabled={reportingAwaiting}
              >
                {reportingAwaiting ? "Reporting..." : "Submit report"}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(missingTarget)}
        onClose={() => {
          if (reportingMissing) return;
          setMissingTarget(null);
          setMissingDetails("");
        }}
        title={missingTarget?.entry.status === "Awaiting vaulting" ? "Report card lost in transit" : "Report card lost in vault"}
        width="max-w-sm"
      >
        {missingTarget ? (
          <div className="space-y-4 p-5">
            <p className="text-[13px] leading-relaxed text-muted">
              Mark <span className="font-semibold text-white">{missingTarget.listing.title}</span> as lost {missingTarget.entry.status === "Awaiting vaulting" ? "while travelling to Pokechain or Collector Crypt" : "in the vault"}. It will be removed from sale until you cancel this report.
            </p>
            <Field label="What happened?">
              <textarea
                className={`${inputClass} h-24 resize-none py-2.5`}
                value={missingDetails}
                onChange={(event) => setMissingDetails(event.target.value)}
                placeholder="Last seen during inventory check…"
                disabled={reportingMissing}
              />
            </Field>
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setMissingTarget(null)} disabled={reportingMissing}>Cancel</Button>
              <Button variant="danger" className="flex-1" onClick={() => void reportMissingFromVault()} disabled={reportingMissing}>
                {reportingMissing ? "Reporting..." : "Report lost"}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <BountyModal
        key={bountyTarget?.listing.id ?? "no-bounty-target"}
        target={bountyTarget}
        existing={bountyTarget ? lossFor(bountyTarget.entry, bountyTarget.listing)?.bounty?.amount : undefined}
        onClose={() => setBountyTarget(null)}
        onSave={async (amount) => {
          if (!bountyTarget) return;
          try {
            await lost.setBounty(bountyTarget.listing.id, amount, lostTokenId(bountyTarget.entry));
            setBountyTarget(null);
          } catch (err) {
            pushToast({ title: "Could not set bounty", body: (err as Error).message, tone: "error" });
          }
        }}
      />

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

function BountyModal({
  target,
  existing,
  onClose,
  onSave,
}: {
  target: { entry: VaultItem; listing: Listing } | null;
  existing?: number;
  onClose: () => void;
  onSave: (amount: number) => void;
}) {
  const [amount, setAmount] = useState(existing ? String(existing) : "");
  const value = Number(amount);
  // An existing bounty can go to $0, which refunds it (there's no separate cancel button).
  const valid = amount !== "" && Number.isFinite(value) && (existing ? value >= 0 : value > 0);

  return (
    <Modal open={Boolean(target)} onClose={onClose} title={existing ? "Edit bounty" : "Attach a bounty"} width="max-w-sm">
      {target ? (
        <form
          className="space-y-4 p-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) onSave(value);
          }}
        >
          <p className="text-[13px] leading-relaxed text-muted">
            Offer a reward to help locate <span className="font-semibold text-white">{target.listing.title}</span>.
          </p>
          <Field label="Bounty amount (USDC)" hint={existing ? "Set it to 0 to remove the bounty and get it refunded." : "Held in escrow until someone returns the slab."}>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
              <input
                autoFocus
                className={`${inputClass} pl-7 font-semibold`}
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ""))}
                placeholder="100"
              />
            </div>
          </Field>
          {!valid && amount ? <p className="text-[12px] font-medium text-bad">{existing ? "Enter $0 or more." : "Enter a bounty above $0."}</p> : null}
          <div className="flex gap-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="flex-1" disabled={!valid}>{existing ? "Update bounty" : "Attach bounty"}</Button>
          </div>
        </form>
      ) : null}
    </Modal>
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

/** A marketplace listing presented with the same slab-card layout as the rest of the Vault. */
function ListedSlabCard({
  entry,
  listing,
  size,
  chats,
  offers,
  bestOffer,
  delisting,
  onDelist,
}: {
  entry: VaultItem;
  listing: Listing;
  size: "medium" | "small";
  chats: number;
  offers: number;
  bestOffer: number;
  delisting: boolean;
  onDelist: () => void;
}) {
  const small = size === "small";
  const activity = offers
    ? `${offers} offer${offers === 1 ? "" : "s"} to review · best ${usd(bestOffer, { cents: true })}`
    : chats
      ? `${chats} open chat${chats === 1 ? "" : "s"}`
      : "No offers yet";

  return (
    <div className="overflow-hidden rounded-card border border-hairline bg-surface">
      <Link href={`/asset/${listing.id}`} className={clsx("block bg-[#101014]", small ? "p-2" : "p-4")}>
        <Slab listing={listing} interactive maxTilt={9} />
      </Link>
      <div className={small ? "p-2" : "p-3.5"}>
        <Link
          href={`/asset/${listing.id}`}
          className={clsx("line-clamp-2 font-semibold leading-snug hover:underline", small ? "text-[10.5px]" : "text-[12px]")}
        >
          {listing.title}
        </Link>
        <div className={clsx("mt-2", small ? "space-y-1.5" : "flex items-center justify-between gap-2")}>
          <span className={clsx("font-bold", small ? "text-[11px]" : "text-[13px]")}>Asking {usd(entry.listedPrice ?? listing.price, { cents: true })}</span>
          <Badge className={small ? "w-fit px-1.5 text-[9px]" : undefined} tone="accent">Listed</Badge>
        </div>
        <p className={clsx("mt-1.5 line-clamp-2 text-muted", small ? "text-[9.5px]" : "text-[11px]")}>{activity}</p>
        <p className={clsx("mt-1 text-dim", small ? "text-[9.5px]" : "text-[11px]")}>
          {entry.via} · <TimeAgo value={entry.acquiredAt} />
        </p>
        {entry.token ? (
          <Link
            href={`/trace/${entry.token.tokenId}`}
            className={clsx("mt-1 flex items-center gap-1 font-semibold text-accent hover:underline", small ? "text-[9.5px]" : "text-[11px]")}
          >
            <Blocks size={11} /> Token #{entry.token.tokenId} · <Route size={11} /> Trace
          </Link>
        ) : null}
        <div className={clsx("mt-3 grid", small ? "gap-1.5" : "gap-2")}>
          <Link href={`/trades?listing=${listing.id}`} className="block">
            <Button size="sm" className="w-full">
              <MessagesSquare size={13} />
              Negotiations{chats ? ` (${chats})` : ""}
            </Button>
          </Link>
          <Button size="sm" variant="secondary" className="w-full" disabled={delisting} onClick={onDelist}>
            {delisting ? "Delisting..." : "Delist"}
          </Button>
        </div>
      </div>
    </div>
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
  inOffer,
  onReportLost,
  investigationComplete,
  loss,
  onAddBounty,
  onWithdrawInsurance,
}: {
  entry: VaultItem;
  listing: Listing;
  size: "medium" | "small";
  onManage: () => void;
  onSell: () => void;
  onShip: () => void;
  /** the open trade offer that has this slab locked in escrow */
  inOffer?: { offerId: string; taker: string; room: string };
  /** A reversible report that this card cannot be located in the physical vault. */
  loss?: VaultLossReport;
  onAddBounty: () => void;
  onWithdrawInsurance: () => void;
  onReportLost?: () => void;
  investigationComplete?: boolean;
}) {
  const small = size === "small";
  // Every lost card looks and acts the same, however it was lost: edit the bounty or claim insurance.
  if (entry.status === "Awaiting vaulting" || loss?.published) {
    return <AwaitingSlabCard entry={entry} listing={listing} loss={loss} investigationComplete={investigationComplete} onReportLost={onReportLost} onManageBounty={onAddBounty} onWithdrawInsurance={onWithdrawInsurance} />;
  }
  if (inOffer) {
    return (
      <div className="overflow-hidden rounded-card border border-accent/50 bg-surface ring-1 ring-accent/30">
        <Link href={`/asset/${listing.id}`} className={clsx("block bg-[#101014] opacity-70", small ? "p-2" : "p-4")}>
          <Slab listing={listing} interactive maxTilt={9} />
        </Link>
        <div className={small ? "p-2" : "p-3.5"}>
          <p className={clsx("line-clamp-2 font-semibold leading-snug", small ? "text-[10.5px]" : "text-[12px]")}>{listing.title}</p>
          <div className="mt-2 flex items-center justify-between">
            <span className={clsx("font-bold", small ? "text-[11px]" : "text-[13px]")}>In trade</span>
            <Badge className={small ? "px-1.5 text-[9px]" : undefined} tone="accent"><Lock size={11} /> In offer #{inOffer.offerId}</Badge>
          </div>
          <p className={clsx("mt-1.5 text-dim", small ? "text-[9.5px]" : "text-[11px]")}>
            Held until the other collector answers, or you withdraw the offer in the chat.
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
        <Slab listing={listing} interactive maxTilt={9} />
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
          {loss ? (
            <Badge className={small ? "w-fit px-1.5 text-[9px]" : undefined} tone="warn">Lost in vault</Badge>
          ) : (
            <Badge className={small ? "w-fit px-1.5 text-[9px]" : undefined} tone={entry.status === "Listed" ? "accent" : entry.status === "Shipping requested" ? "warn" : "good"}>
              {entry.status}
            </Badge>
          )}
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
        {loss ? null : (
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
          </div>
        )}
      </div>
    </div>
  );
}

function AwaitingSlabCard({
  entry,
  listing,
  loss,
  investigationComplete,
  onReportLost,
  onManageBounty,
  onWithdrawInsurance,
}: {
  entry: VaultItem;
  listing: Listing;
  loss?: VaultLossReport;
  investigationComplete?: boolean;
  onReportLost?: () => void;
  onManageBounty?: () => void;
  onWithdrawInsurance?: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-card border border-hairline bg-surface">
      <div className="bg-[#101014] p-4">
        <Slab listing={listing} interactive maxTilt={9} />
      </div>
      <div className="space-y-2 p-3.5">
        <p className="line-clamp-2 text-[12px] font-semibold leading-snug">{listing.title}</p>
        <Badge tone={loss?.resolution === "insurance" ? "good" : "warn"}>
          {loss?.published
            ? "Reported lost"
            : loss?.resolution === "insurance"
              ? "Insurance submitted"
              : investigationComplete
                ? "Investigation complete"
                : loss
                  ? "Vaulting delay under review"
                  : "Awaiting Vaulting"}
        </Badge>
        <p className="text-[11px] text-muted">
          {loss?.published ? <>Reported <TimeAgo value={loss.reportedAt} /></> : <>Submitted <TimeAgo value={entry.acquiredAt} /></>}
        </p>
        {loss?.published ? (
          <p className="text-[11px] text-muted">
            Bounty: <span className="font-semibold text-white">{loss.bounty ? usd(loss.bounty.amount, { cents: true }) : "None"}</span>
          </p>
        ) : null}
        <p className="text-[11px] leading-relaxed text-dim">
          {loss?.published
            ? "Listed on the Lost Cards page so anyone who finds it can return it."
            : loss?.resolution === "insurance"
              ? "Your claim has been sent to the vault-service provider for off-chain review."
              : investigationComplete
                ? "Pokechain completed its investigation. Review the outcome in Status Center."
                : loss
                  ? "The vault team is investigating your delay report."
                  : "If vaulting is taking longer than expected, let the vault team know."}
        </p>
        {loss?.published ? (
          <div className="grid gap-1.5">
            <Button size="sm" variant="secondary" className="w-full" onClick={onManageBounty}>
              {loss.bounty ? "Edit bounty" : "Add bounty"}
            </Button>
            <Button size="sm" variant="outline" className="w-full" onClick={onWithdrawInsurance}>
              Withdraw & claim insurance
            </Button>
          </div>
        ) : !loss && !investigationComplete && onReportLost ? (
          <Button size="sm" variant="outline" className="w-full" onClick={onReportLost}>
            Report vaulting delay
          </Button>
        ) : null}
      </div>
    </div>
  );
}
