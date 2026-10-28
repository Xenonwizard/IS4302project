"use client";

import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import Link from "next/link";
import {
  Check,
  ChevronDown,
  Clock3,
  Copy,
  FileText,
  PackageSearch,
  Plus,
  TriangleAlert,
  Truck,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { certPreview, getListing, makeSubmittedListing } from "@/lib/catalog";
import { IS_DEPLOYED, OPEN_SUBMISSION } from "@/lib/chain/config";
import { useFoundCases, useLostReport } from "@/lib/chain/useLostSlabRecovery";
import { type SubmissionRequest, useSubmissions } from "@/lib/chain/useSubmissions";
import { useLostSlabs, useStore } from "@/lib/store";
import type { Listing, VaultItem, VaultLossReport } from "@/lib/types";
import { WithdrawnList } from "../chain/WithdrawnList";
import { FoundCaseList } from "../lost/FoundCaseList";
import { Slab } from "../slab/Slab";
import { Button, Field, Modal, TimeAgo, inputClass } from "../ui/primitives";
import { Empty, LoginPrompt } from "../vault/shared";

type Category = "submissions" | "withdrawals" | "bounties" | "recovery";
type StatusFilter = "all" | "progress" | "awaiting" | "vaulted" | "action" | "completed" | "bounty";

const CATEGORIES: { value: Category; label: string }[] = [
  { value: "submissions", label: "Slab submissions" },
  { value: "withdrawals", label: "Withdrawn" },
  { value: "bounties", label: "Bounty claims" },
  { value: "recovery", label: "Recovery & insurance" },
];

const CATEGORY_FILTERS: Record<Category, { value: StatusFilter; label: string }[]> = {
  submissions: [
    { value: "all", label: "All" },
    { value: "progress", label: "In progress" },
    { value: "awaiting", label: "Awaiting vault" },
    { value: "vaulted", label: "Vaulted" },
  ],
  withdrawals: [
    { value: "all", label: "All" },
    { value: "progress", label: "In progress" },
  ],
  bounties: [
    { value: "all", label: "All" },
    { value: "progress", label: "In progress" },
    { value: "action", label: "Action needed" },
    { value: "completed", label: "Completed" },
  ],
  recovery: [
    { value: "all", label: "All" },
    { value: "progress", label: "Under review" },
    { value: "action", label: "Action needed" },
    { value: "bounty", label: "Bounty active" },
  ],
};

export const SUBMISSION_STAGE: Record<number, string> = {
  1: "Awaiting receipt at Pokechain",
  2: "Received at Pokechain",
  3: "With Collector Crypt",
  4: "Vaulted",
  5: "Rejected",
};

const TIMELINE_STEPS = ["Sent", "At Pokechain", "At Vault", "Vaulted"];

/** recovery: reported lost, being searched for. insurance: written off for insurance, NFT burned. */
type RecoveryState = "recovery" | "insurance";
const RECOVERY_LABEL: Record<RecoveryState, string> = {
  recovery: "In recovery & insurance",
  insurance: "Insurance claimed · NFT burned",
};

interface EvidenceResponse {
  found?: boolean;
  error?: string;
  manifest?: {
    condition: { caseCracked: boolean; caseScratched: boolean; labelDamaged: boolean; notes: string };
    shipping: { method: "courier" | "dropoff"; carrier: string; tracking: string };
    declarations: { owner: boolean; authentic: boolean; terms: boolean };
    photos: { slot: string; fileName: string; bytes: number }[];
  };
  verified?: { all: boolean };
}

export function SubmissionsView() {
  const { user, ready, vault, resolve, vaultLosses, pendingLossDecisions, setVaultBounty, resolveLossDecision, pushToast } = useStore();
  const lost = useLostReport();
  const publicLostSlabs = useLostSlabs();
  const { data: submissionRequests = [], isPending, isError, refetch } = useSubmissions();
  const params = useSearchParams();
  const [category, setCategory] = useState<Category>(() => {
    const tab = params.get("tab");
    return tab === "withdrawals" || tab === "withdrawn" ? "withdrawals" : tab === "found" ? "bounties" : "submissions";
  });
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [decisionTarget, setDecisionTarget] = useState<{ entry: VaultItem; listing: Listing; decisionId: string } | null>(null);
  const [decisionChoice, setDecisionChoice] = useState<"insurance" | "bounty" | null>(null);
  const [decisionBounty, setDecisionBounty] = useState("");

  const localRequests = useMemo(
    () =>
      vault.flatMap((entry) => {
        if (entry.via !== "Submission" || entry.token) return [];
        const listing = getListing(entry.listingId);
        return listing ? [{ entry, listing: resolve(listing) }] : [];
      }),
    [resolve, vault],
  );
  // Withdraw requests from the Vault: tracked here too, so a slab that never arrives can be reported lost.
  const withdrawals = useMemo(
    () =>
      vault.flatMap((entry) => {
        if (entry.status !== "Withdrawn" || !entry.token) return [];
        const listing = getListing(entry.listingId);
        return listing ? [{ entry, listing: resolve(listing) }] : [];
      }),
    [resolve, vault],
  );
  // A submission that never reached the vault but is now a withdrawal (a found slab delivered to its
  // owner) has left the vaulting pipeline: it shows under Slab withdrawals only.
  const requests = useMemo(() => {
    const withdrawnTokens = new Set(withdrawals.map(({ entry }) => entry.token?.tokenId));
    return submissionRequests.filter((request) => request.status === 4 || !withdrawnTokens.has(request.tokenId));
  }, [submissionRequests, withdrawals]);

  // A found-slab case belongs to different workflows depending on this collector's role.
  const { data: allCases = [] } = useFoundCases();
  const me = user?.address?.toLowerCase();
  const ownerCases = allCases.filter((c) => me && c.owner.toLowerCase() === me);
  const bountyClaimCases = allCases.filter((c) => me && c.finder.toLowerCase() === me && c.owner.toLowerCase() !== me);
  const recoveryReports = useMemo(() =>
    vault.flatMap((entry) => {
      const listing = getListing(entry.listingId);
      const publicLoss = entry.token
        ? publicLostSlabs.find((item) => item.listing.tokenId === entry.token?.tokenId && (!item.owner || item.owner.toLowerCase() === user?.address?.toLowerCase()))
        : undefined;
      const loss = publicLoss?.loss ?? vaultLosses[entry.listingId] ?? (listing ? vaultLosses[listing.tokenId] ?? vaultLosses[`token-${listing.tokenId}`] : undefined);
      return listing && loss ? [{ entry, listing: resolve(listing), loss }] : [];
    }),
  [publicLostSlabs, resolve, user?.address, vault, vaultLosses]);
  const caseListingsByToken = useMemo(() => {
    const listings: Record<string, Listing> = {};
    publicLostSlabs.forEach((item) => { listings[item.listing.tokenId] = item.listing; });
    vault.forEach((entry) => {
      if (!entry.token) return;
      const listing = getListing(entry.listingId);
      if (listing) listings[entry.token.tokenId] = resolve(listing);
    });
    return listings;
  }, [publicLostSlabs, resolve, vault]);
  // Once someone files a found-card claim, that live recovery case replaces the owner's generic lost report row.
  const trackedRecoveryReports = recoveryReports.filter(({ entry, listing }) =>
    !ownerCases.some((c) => c.tokenId === entry.token?.tokenId || c.tokenId === listing.tokenId),
  );
  // A submission that was reported lost now lives under Recovery & insurance, not the vaulting pipeline.
  const recoveryByToken = useMemo(() => {
    const map = new Map<string, RecoveryState>();
    for (const { entry, listing, loss } of recoveryReports) {
      const tokenId = entry.token?.tokenId ?? listing.tokenId;
      if (tokenId) map.set(tokenId, loss.resolution === "insurance" ? "insurance" : "recovery");
    }
    return map;
  }, [recoveryReports]);
  const inPipeline = (request: SubmissionRequest) => !recoveryByToken.has(request.tokenId);

  const visible = category === "submissions" ? requests.filter((request) => {
    if (filter === "progress") return OPEN_SUBMISSION.has(request.status) && inPipeline(request);
    if (filter === "awaiting") return (request.status === 2 || request.status === 3) && inPipeline(request);
    if (filter === "vaulted") return request.status === 4;
    return true;
  }) : [];
  const visibleLocal = category === "submissions" && (filter === "all" || filter === "vaulted") ? localRequests : [];
  const visibleWithdrawals = category === "withdrawals" ? withdrawals : [];
  const visibleBountyClaims = category === "bounties" ? bountyClaimCases.filter((c) => {
    if (filter === "progress") return c.status >= 1 && c.status <= 4;
    if (filter === "action") return c.status === 4;
    if (filter === "completed") return c.status === 5 || c.status === 6;
    return true;
  }) : [];
  const visibleOwnerRecoveries = category === "recovery" ? ownerCases.filter((c) => {
    const actionNeeded = c.status === 2 || (c.status === 4 && c.returnTo === 2 && c.custody === "Shipped");
    if (filter === "progress") return c.status >= 1 && c.status <= 4;
    if (filter === "action") return actionNeeded;
    if (filter === "bounty") return c.bounty > 0 && c.status < 5;
    return true;
  }) : [];
  const visibleRecovery = category === "recovery" ? trackedRecoveryReports.filter(({ listing, loss }) => {
    const needsDecision = Boolean(pendingLossDecisions[listing.id] ?? pendingLossDecisions[listing.tokenId] ?? pendingLossDecisions[`token-${listing.tokenId}`]);
    if (filter === "progress") return !needsDecision && !loss.published && !loss.resolution;
    if (filter === "action") return needsDecision;
    if (filter === "bounty") return Boolean(loss.bounty);
    return true;
  }) : [];
  const total = requests.length + localRequests.length + withdrawals.length + bountyClaimCases.length + ownerCases.length + trackedRecoveryReports.length;
  const inProgress = requests.filter((request) => OPEN_SUBMISSION.has(request.status) && inPipeline(request)).length;
  const awaitingVault = requests.filter((request) => (request.status === 2 || request.status === 3) && inPipeline(request)).length;
  const vaulted = requests.filter((request) => request.status === 4).length + localRequests.length;
  const categoryCounts: Record<Category, number> = {
    submissions: requests.length + localRequests.length,
    withdrawals: withdrawals.length,
    bounties: bountyClaimCases.length,
    recovery: ownerCases.length + trackedRecoveryReports.length,
  };
  const filterCounts: Record<StatusFilter, number> = {
    all: categoryCounts[category],
    progress: category === "submissions" ? inProgress : category === "withdrawals" ? withdrawals.length : category === "bounties" ? bountyClaimCases.filter((c) => c.status >= 1 && c.status <= 4).length : ownerCases.filter((c) => c.status >= 1 && c.status <= 4).length + trackedRecoveryReports.filter(({ listing, loss }) => !loss.published && !loss.resolution && !pendingLossDecisions[listing.id] && !pendingLossDecisions[listing.tokenId] && !pendingLossDecisions[`token-${listing.tokenId}`]).length,
    awaiting: awaitingVault,
    vaulted,
    action: category === "bounties" ? bountyClaimCases.filter((c) => c.status === 4).length : ownerCases.filter((c) => c.status === 2 || (c.status === 4 && c.returnTo === 2 && c.custody === "Shipped")).length + trackedRecoveryReports.filter(({ listing }) => Boolean(pendingLossDecisions[listing.id] ?? pendingLossDecisions[listing.tokenId] ?? pendingLossDecisions[`token-${listing.tokenId}`])).length,
    completed: bountyClaimCases.filter((c) => c.status === 5 || c.status === 6).length,
    bounty: ownerCases.filter((c) => c.bounty > 0 && c.status < 5).length + trackedRecoveryReports.filter(({ loss }) => Boolean(loss.bounty)).length,
  };

  const submitLossDecision = async () => {
    if (!decisionTarget || !decisionChoice) return;
    const { entry, listing, decisionId } = decisionTarget;
    if (decisionChoice === "insurance") {
      // Insurance pays out instead of vaulting, so the slab's NFT is burned on-chain (writeOff toasts).
      try {
        await lost.writeOff(listing.id, entry.token?.tokenId, vaultLosses[decisionId]?.details);
      } catch (err) {
        pushToast({ title: "Could not claim insurance", body: (err as Error).message, tone: "error" });
        return;
      }
    }
    if (decisionChoice === "bounty") {
      const amount = Number(decisionBounty);
      const tokenId = entry.token?.tokenId;
      if (IS_DEPLOYED && tokenId) {
        try {
          await lost.report(listing.id, tokenId, vaultLosses[decisionId]?.details ?? "Lost on its way to the vault", { inTransit: true, bounty: amount });
        } catch (err) {
          pushToast({ title: "Could not publish the lost report", body: (err as Error).message, tone: "error" });
          return;
        }
      } else if (Number.isFinite(amount) && amount > 0) {
        setVaultBounty(decisionId, amount);
      }
    }
    resolveLossDecision(decisionId, decisionChoice === "insurance" ? "insurance" : undefined);
    setDecisionTarget(null);
    setDecisionChoice(null);
    setDecisionBounty("");
    if (decisionChoice === "bounty") {
      pushToast({ title: "Lost-card bounty published", body: "Your card is now visible on the Lost page.", tone: "success" });
    }
  };

  if (!ready) return <SubmissionsSkeleton />;
  if (!user) {
    return (
      <LoginPrompt
        icon={<PackageSearch size={26} />}
        title="Status Center"
        body="Log in to add slabs and follow every request from submission to vaulting."
      />
    );
  }

  return (
    <div className="px-4 py-5 lg:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-bold">Status Center</h1>
          <p className="mt-1 max-w-2xl text-[13px] text-muted">
            Add slabs and track every request here. Select a request to review the form you submitted.
          </p>
        </div>
        {category === "submissions" ? <AddSlabLink label="Add a slab" /> : null}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={<FileText size={15} />} label="Slab submissions" value={categoryCounts.submissions} />
        <Stat icon={<Clock3 size={15} />} label="In progress" value={inProgress} />
        <Stat icon={<Truck size={15} />} label="Withdrawn" value={categoryCounts.withdrawals} />
        <Stat icon={<PackageSearch size={15} />} label="Bounty & recovery" value={categoryCounts.bounties + categoryCounts.recovery} />
      </div>

      <div className="no-scrollbar mt-6 flex gap-1 overflow-x-auto border-b border-hairline">
        {CATEGORIES.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => { setCategory(item.value); setFilter("all"); }}
            className={clsx(
              "relative shrink-0 px-4 py-3 text-[13px] font-bold transition",
              category === item.value ? "text-white" : "text-muted hover:text-white",
            )}
          >
            {item.label}
            <span className="ml-1.5 rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px]">{categoryCounts[item.value]}</span>
            {category === item.value ? <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-accent" /> : null}
          </button>
        ))}
      </div>

      <div className="no-scrollbar mt-4 flex gap-2 overflow-x-auto">
        {CATEGORY_FILTERS[category].map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => setFilter(item.value)}
            className={clsx(
              "shrink-0 rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition",
              filter === item.value ? "border-accent bg-accent text-white" : "border-hairline bg-surface text-muted hover:border-white/25 hover:text-white",
            )}
          >
            {item.label}
            <span className="ml-1.5 opacity-75">{filterCounts[item.value]}</span>
          </button>
        ))}
      </div>

      <div className="mt-5">
        {category === "submissions" && user.address && isPending ? (
          <div className="space-y-2">{[0, 1, 2].map((item) => <div key={item} className="skeleton h-24 rounded-card" />)}</div>
        ) : category === "submissions" && user.address && isError ? (
          <div className="rounded-card border border-bad/30 bg-bad/5 px-5 py-8 text-center">
            <TriangleAlert size={22} className="mx-auto text-bad" />
            <p className="mt-2 text-sm font-semibold">Your submissions could not be loaded.</p>
            <button type="button" onClick={() => void refetch()} className="mt-3 text-[13px] font-semibold text-accent hover:underline">
              Try again
            </button>
          </div>
        ) : visible.length || visibleLocal.length || visibleWithdrawals.length || visibleBountyClaims.length || visibleOwnerRecoveries.length || visibleRecovery.length ? (
          <div className="space-y-6">
          {visibleBountyClaims.length ? (
            <section data-testid="bounty-claims">
              <h2 className="mb-1 flex items-center gap-2 text-[15px] font-bold"><PackageSearch size={15} /> Bounty claims</h2>
              <p className="mb-3 text-[12px] text-muted">
                Lost slabs you found and submitted to Pokechain. Follow verification, return, and bounty payment here.
              </p>
              <FoundCaseList cases={visibleBountyClaims} me={me ?? ""} listingsByToken={caseListingsByToken} />
            </section>
          ) : null}
          {visible.length || visibleLocal.length ? (
          <div className="overflow-hidden rounded-card border border-hairline bg-surface">
            <div className="hidden grid-cols-[minmax(240px,1.25fr)_minmax(210px,1fr)_150px_28px] gap-4 border-b border-hairline px-4 py-2.5 text-[10px] font-bold uppercase tracking-wide text-dim md:grid">
              <span>Slab request</span>
              <span>Progress</span>
              <span>Submitted</span>
              <span />
            </div>
            <ul className="divide-y divide-[rgba(255,255,255,0.08)]">
              {visible.map((request) => (
                <RequestAccordion
                  key={request.submissionId}
                  request={request}
                  recovery={request.tokenId !== "0" ? recoveryByToken.get(request.tokenId) : undefined}
                  onOpenRecovery={() => { setCategory("recovery"); setFilter("all"); }}
                  open={openId === request.submissionId}
                  onToggle={() => setOpenId((current) => current === request.submissionId ? null : request.submissionId)}
                />
              ))}
              {visibleLocal.map(({ entry, listing }) => (
                <LocalRequestAccordion
                  key={listing.id}
                  entry={entry}
                  listing={listing}
                  open={openId === listing.id}
                  onToggle={() => setOpenId((current) => current === listing.id ? null : listing.id)}
                />
              ))}
            </ul>
          </div>
          ) : null}
          {visibleWithdrawals.length ? (
            <section data-testid="withdraw-requests">
              <h2 className="mb-1 flex items-center gap-2 text-[15px] font-bold"><Truck size={15} /> Withdrawn</h2>
              <p className="mb-3 text-[12px] text-muted">
                Slabs you asked to ship home. Their NFTs lock when you ask and burn once Collector Crypt is notified to ship them.
                Confirm delivery when it arrives.
              </p>
              <WithdrawnList items={visibleWithdrawals} showNftAction />
            </section>
          ) : null}
          {visibleOwnerRecoveries.length || visibleRecovery.length ? (
            <section data-testid="recovery-statuses">
              <h2 className="mb-1 flex items-center gap-2 text-[15px] font-bold"><PackageSearch size={15} /> Recovery & insurance</h2>
              <p className="mb-3 text-[12px] text-muted">Track every lost-card report from investigation and bounty publication through recovery, return, or insurance.</p>
              <div className="space-y-3">
                {visibleOwnerRecoveries.length ? <FoundCaseList cases={visibleOwnerRecoveries} me={me ?? ""} listingsByToken={caseListingsByToken} /> : null}
                {visibleRecovery.length ? (
                  <ul className="space-y-3">
                    {visibleRecovery.map(({ entry, listing, loss }) => (
                      <RecoveryRow
                        key={listing.id}
                        entry={entry}
                        listing={listing}
                        loss={loss}
                        actionNeeded={Boolean(pendingLossDecisions[listing.id] ?? pendingLossDecisions[listing.tokenId] ?? pendingLossDecisions[`token-${listing.tokenId}`])}
                        onReview={() => {
                          const decisionId = Object.keys(pendingLossDecisions).find(
                            (id) => id === listing.id || id === listing.tokenId || id === `token-${listing.tokenId}`,
                          ) ?? listing.id;
                          setDecisionTarget({ entry, listing, decisionId });
                        }}
                      />
                    ))}
                  </ul>
                ) : null}
              </div>
            </section>
          ) : null}
          </div>
        ) : categoryCounts[category] ? (
          <Empty
            icon={<PackageSearch size={24} />}
            title="No updates in this view"
            body="Choose another filter to see a different stage of this workflow."
          />
        ) : (
          <Empty
            icon={<PackageSearch size={24} />}
            title={category === "submissions" ? "No slab submissions yet" : `No ${CATEGORIES.find((item) => item.value === category)?.label.toLowerCase()} yet`}
            body={category === "submissions" ? "Start a request for each graded slab you want Pokechain and Collector Crypt to vault. You can submit as many slabs as you need." : "Updates will appear here when you start this workflow."}
            cta={category === "submissions" ? { href: "/submit", label: "Add your first slab" } : undefined}
          />
        )}
      </div>

      <Modal
        open={Boolean(decisionTarget)}
        onClose={() => { setDecisionTarget(null); setDecisionChoice(null); setDecisionBounty(""); }}
        title="Investigation complete"
        width="max-w-sm"
      >
        {decisionTarget ? (
          <div className="space-y-4 p-5">
            <p className="text-[13px] leading-relaxed text-muted">
              The vault team confirmed that <span className="font-semibold text-white">{decisionTarget.listing.title}</span> was lost while being processed. How would you like to proceed?
            </p>
            <div className="grid gap-2">
              <button className={clsx("rounded-xl border p-3 text-left", decisionChoice === "insurance" ? "border-accent bg-accent/10" : "border-hairline")} onClick={() => setDecisionChoice("insurance")}>
                <p className="text-[13px] font-bold">Claim vault-service insurance</p>
                <p className="mt-1 text-[11px] text-muted">Request settlement directly from the service provider.</p>
              </button>
              <button className={clsx("rounded-xl border p-3 text-left", decisionChoice === "bounty" ? "border-accent bg-accent/10" : "border-hairline")} onClick={() => setDecisionChoice("bounty")}>
                <p className="text-[13px] font-bold">Publish a lost-card bounty</p>
                <p className="mt-1 text-[11px] text-muted">Keep searching and offer USDC if someone returns it.</p>
              </button>
            </div>
            {decisionChoice === "bounty" ? (
              <Field label="Recovery bounty (USDC)" hint="Optional">
                <input className={inputClass} inputMode="decimal" value={decisionBounty} onChange={(event) => setDecisionBounty(event.target.value.replace(/[^\d.]/g, ""))} placeholder="e.g. 150" />
              </Field>
            ) : null}
            <Button className="w-full" onClick={() => void submitLossDecision()} disabled={!decisionChoice}>
              {decisionChoice === "insurance" ? "Submit insurance claim" : decisionChoice === "bounty" ? "Publish lost card" : "Choose an outcome"}
            </Button>
          </div>
        ) : null}
      </Modal>

      {category === "submissions" && total ? <div className="mt-5 flex justify-center"><AddSlabLink label="Add another slab" /></div> : null}
    </div>
  );
}

function RecoveryRow({
  entry,
  listing,
  loss,
  actionNeeded,
  onReview,
}: {
  entry: VaultItem;
  listing: Listing;
  loss: VaultLossReport;
  actionNeeded: boolean;
  onReview: () => void;
}) {
  const state = actionNeeded
    ? "Pokechain has completed its review — choose insurance or publish a lost-card bounty."
    : loss.resolution === "insurance"
      ? "Insurance claim sent to the vault-service provider for off-chain review. The slab's NFT was burned, so it won't be vaulted."
    : loss.published
      ? loss.bounty
        ? "Public lost-card bounty is active. You can edit the bounty or withdraw it from Vault."
        : "Public lost-card report is active. You can add a bounty or withdraw it from Vault."
      : "Your vaulting-delay report is under review by Pokechain.";

  return (
    <li className="rounded-card border border-hairline bg-surface p-4">
      <div className="flex flex-wrap items-start gap-3">
        <Link href={`/asset/${listing.id}`} className="w-10 shrink-0">
          <span className="block h-14 w-10 overflow-hidden rounded-md bg-surface-2">
            <Slab listing={listing} flat />
          </span>
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/asset/${listing.id}`} className="line-clamp-1 text-[13px] font-semibold hover:underline">{listing.title}</Link>
            <span className={clsx("rounded-md px-2 py-1 text-[11px] font-semibold", actionNeeded ? "bg-warn/15 text-warn" : loss.resolution === "insurance" ? "bg-good-bg text-good" : loss.published ? "bg-accent/15 text-accent" : "bg-surface-2 text-muted")}>
              {actionNeeded ? "Action needed" : loss.resolution === "insurance" ? "Insurance claimed · NFT burned" : loss.published ? "Lost-card report active" : "Under review"}
            </span>
          </div>
          <p className="mt-1 text-[12px] text-muted">{state}</p>
          <p className="mt-2 text-[11px] text-dim">Reported <TimeAgo value={loss.reportedAt} /> · Token #{entry.token?.tokenId ?? listing.tokenId}</p>
          {loss.details ? <p className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-[12px] text-muted">{loss.details}</p> : null}
        </div>
        {actionNeeded ? (
          <Button size="sm" onClick={onReview}>Review reply</Button>
        ) : loss.published ? (
          <Link href="/vault?tab=lost" className="rounded-lg border border-hairline px-3 py-2 text-[12px] font-semibold text-white transition hover:border-white/30 hover:bg-surface-2">
            Manage in Vault
          </Link>
        ) : null}
      </div>
    </li>
  );
}

function RequestAccordion({
  request,
  recovery,
  onOpenRecovery,
  open,
  onToggle,
}: {
  request: SubmissionRequest;
  recovery?: RecoveryState;
  onOpenRecovery: () => void;
  open: boolean;
  onToggle: () => void;
}) {
  const preview = certPreview(request.grader, request.certNumber);
  const previewListing = makeSubmittedListing({
    grader: request.grader,
    certNumber: request.certNumber,
    owner: request.owner,
    nowMs: request.requestedAt * 1000,
  });

  return (
    <li data-testid={`request-${request.certNumber}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={`${request.grader} cert ${request.certNumber}, ${recovery ? RECOVERY_LABEL[recovery] : SUBMISSION_STAGE[request.status]}`}
        className="grid w-full grid-cols-1 gap-3 px-4 py-4 text-left transition hover:bg-white/[0.035] md:grid-cols-[minmax(240px,1.25fr)_minmax(210px,1fr)_150px_28px] md:items-center md:gap-4"
      >
        <div className="flex min-w-0 items-center gap-3">
          <SubmissionThumbnail listing={previewListing} hasPreview={Boolean(preview)} />
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-bold">{request.grader} cert {request.certNumber}</span>
            <span className="mt-1 block text-[11.5px] text-dim">
              Request #{request.submissionId}{request.tokenId !== "0" ? ` · NFT #${request.tokenId}` : ""}
            </span>
            <span className="mt-2 block"><StatusBadge status={request.status} recovery={recovery} /></span>
          </span>
        </div>

        <ProgressTimeline status={request.status} />
        <span className="hidden text-[11.5px] text-muted md:block"><TimeAgo value={request.requestedAt * 1000} /></span>
        <ChevronDown size={17} className={clsx("justify-self-end text-dim transition", open && "rotate-180 text-white")} />
      </button>
      {open ? <SubmissionFormDetails request={request} recovery={recovery} onOpenRecovery={onOpenRecovery} /> : null}
    </li>
  );
}

/** Show the same graded slab treatment used throughout Vault, at thumbnail scale. */
function SubmissionThumbnail({ listing, hasPreview }: { listing: Listing | null; hasPreview: boolean }) {
  if (!listing || !hasPreview) {
    return <span className="grid h-14 w-10 shrink-0 place-items-center rounded-md bg-surface-2 text-dim"><FileText size={17} /></span>;
  }
  return (
    <span className="block h-14 w-10 shrink-0 overflow-hidden rounded-md bg-surface-2">
      <Slab listing={listing} flat />
    </span>
  );
}

function LocalRequestAccordion({
  entry,
  listing,
  open,
  onToggle,
}: {
  entry: VaultItem;
  listing: Listing;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={`${listing.grader} cert ${listing.certNumber}, Vaulted`}
        className="grid w-full grid-cols-1 gap-3 px-4 py-4 text-left transition hover:bg-white/[0.035] md:grid-cols-[minmax(240px,1.25fr)_minmax(210px,1fr)_150px_28px] md:items-center md:gap-4"
      >
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden
            className="block h-14 w-10 shrink-0 rounded-md bg-surface-2 bg-cover bg-center"
            style={{ backgroundImage: `url(${listing.thumb})` }}
          />
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-bold">{listing.grader} cert {listing.certNumber}</span>
            <span className="mt-1 block text-[11.5px] text-dim">Demo submission</span>
            <span className="mt-2 block"><StatusBadge status={4} /></span>
          </span>
        </div>
        <ProgressTimeline status={4} />
        <span className="hidden text-[11.5px] text-muted md:block"><TimeAgo value={entry.acquiredAt} /></span>
        <ChevronDown size={17} className={clsx("justify-self-end text-dim transition", open && "rotate-180 text-white")} />
      </button>
      {open ? (
        <div className="border-t border-hairline bg-black/15 px-4 py-4">
          <FormGrid>
            <FormField label="Grader" value={listing.grader} />
            <FormField label="Certification number" value={listing.certNumber} mono />
            <FormField label="Intake form" value="This demo submission did not collect photos, condition or delivery details." />
          </FormGrid>
        </div>
      ) : null}
    </li>
  );
}

function ProgressTimeline({ status }: { status: number }) {
  const completed = status === 5 ? 0 : Math.min(status, TIMELINE_STEPS.length);
  return (
    <ol className="grid min-w-0 grid-cols-4 pt-1 md:pt-0">
      {TIMELINE_STEPS.map((step, index) => {
        const done = index < completed;
        return (
          <li key={step} className="relative flex min-w-0 flex-col items-center gap-1 text-center">
            {index < TIMELINE_STEPS.length - 1 ? (
              <span
                aria-hidden
                className={clsx("absolute top-[9.5px] h-px", index < completed - 1 ? "bg-good/60" : "bg-hairline")}
                style={{ left: "calc(50% + 10px)", width: "calc(100% - 20px)" }}
              />
            ) : null}
            <span className={clsx("relative z-10 grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[9px] font-bold", done ? "border-good/70 bg-good/10 text-good" : "border-hairline bg-surface text-dim")}>
              {done ? <Check size={11} /> : index + 1}
            </span>
            <span className={clsx("whitespace-nowrap text-[10px] font-semibold leading-none", done ? "text-good" : "text-dim")}>{step}</span>
          </li>
        );
      })}
    </ol>
  );
}

function SubmissionFormDetails({
  request,
  recovery,
  onOpenRecovery,
}: {
  request: SubmissionRequest;
  recovery?: RecoveryState;
  onOpenRecovery: () => void;
}) {
  const evidence = useQuery({
    queryKey: ["submission-evidence", request.evidenceHash],
    queryFn: async (): Promise<EvidenceResponse> => {
      const response = await fetch(`/api/evidence/${request.evidenceHash}`);
      const body = (await response.json()) as EvidenceResponse;
      if (!response.ok) throw new Error(body.error ?? "Evidence could not be loaded");
      return body;
    },
  });
  const manifest = evidence.data?.manifest;
  const conditionFlags = [
    manifest?.condition.caseCracked && "Case cracked",
    manifest?.condition.caseScratched && "Case scratched",
    manifest?.condition.labelDamaged && "Label damaged",
  ].filter(Boolean) as string[];

  return (
    <div className="border-t border-hairline bg-black/15 px-4 py-4">
      {evidence.isPending ? (
        <p className="text-[12.5px] text-muted">Loading submitted form…</p>
      ) : (
        <FormGrid>
          <div>
            <FormField label="Grader" value={request.grader} />
            <FormField label="Certification number" value={request.certNumber} mono />
          </div>
          <div>
            <FormField label="Delivery method" value={manifest?.shipping.method === "dropoff" || request.inboundCarrier === "Drop-off" ? "Drop-off" : "Courier"} />
            <FormField label="Carrier" value={request.inboundCarrier || "Drop-off"} />
            <FormField label="Tracking number" value={request.inboundTracking || "Not required for drop-off"} mono={Boolean(request.inboundTracking)} />
          </div>
          <div>
            {manifest ? (
              <>
                <FormField label="Condition" value={conditionFlags.length ? conditionFlags.join(", ") : "No damage declared"} />
                <FormField label="Notes" value={manifest.condition.notes || "No condition notes"} />
                <div className="mt-3 space-y-1.5">
                  {[
                    [manifest.declarations.owner, "Ownership confirmed"],
                    [manifest.declarations.authentic, "Authenticity confirmed"],
                    [manifest.declarations.terms, "Vault terms accepted"],
                  ].map(([checked, label]) => (
                    <p key={String(label)} className="flex items-center gap-1.5 text-[12px] text-muted">
                      <Check size={12} className={checked ? "text-good" : "text-bad"} /> {label}
                    </p>
                  ))}
                </div>
                <p className="mt-3 text-[11px] text-dim">
                  {manifest.photos.length} intake photo{manifest.photos.length === 1 ? "" : "s"} attached{evidence.data?.verified?.all ? " · verified" : ""}.
                </p>
              </>
            ) : (
              <p className="text-[12.5px] text-muted">
                {evidence.isError ? "The submitted form could not be loaded." : "No off-chain form details are available."}
              </p>
            )}
          </div>
        </FormGrid>
      )}
      {recovery ? (
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <span className="mr-auto text-[11.5px] text-muted">
            {recovery === "insurance"
              ? `You claimed insurance for this slab, so NFT #${request.tokenId} was burned (SlabVault.writeOffLost) and it will not be vaulted.`
              : `This slab was reported lost. NFT #${request.tokenId} is tracked under Recovery & insurance until it is found or you claim insurance.`}
          </span>
          <button
            type="button"
            onClick={onOpenRecovery}
            className="inline-flex h-9 items-center rounded-lg bg-accent px-3.5 text-[12px] font-semibold text-white transition hover:bg-accent-hover"
          >
            View in Recovery & insurance
          </button>
        </div>
      ) : request.tokenId !== "0" && request.status !== 5 ? (
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <span className="mr-auto text-[11.5px] text-muted">
            {request.status === 4
              ? `NFT #${request.tokenId} is vaulted and unlocked in your Vault.`
              : `NFT #${request.tokenId} was minted when Pokechain received the slab. It waits in your Vault, locked, until Collector Crypt vaults it.`}
          </span>
          {/* Route to the Vault section that reflects the slab's current custody state. */}
          <Link
            href={request.status === 4 ? "/vault" : "/vault?tab=awaiting"}
            className="inline-flex h-9 items-center rounded-lg bg-accent px-3.5 text-[12px] font-semibold text-white transition hover:bg-accent-hover"
          >
            {request.status === 4 ? "View Vaulted NFT" : "View Pending NFT"}
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function StatusBadge({ status, recovery }: { status: number; recovery?: RecoveryState }) {
  return (
    <span
      data-testid="request-stage"
      className={clsx(
        "inline-flex rounded-md px-2 py-1 text-[10.5px] font-bold",
        recovery === "recovery"
          ? "bg-bad/15 text-bad"
          : recovery === "insurance"
            ? "bg-surface-3 text-muted"
            : status === 5 ? "bg-bad/15 text-bad" : status === 4 ? "bg-good-bg text-good" : "bg-warn/15 text-warn",
      )}
    >
      {recovery ? RECOVERY_LABEL[recovery] : SUBMISSION_STAGE[status]}
    </span>
  );
}

function FormGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-5 md:grid-cols-3">{children}</div>;
}

function FormField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <div className="mb-3 last:mb-0">
      <p className="text-[10px] font-bold uppercase tracking-wide text-dim">{label}</p>
      <div className="mt-1 flex items-start gap-2">
        <p className={clsx("min-w-0 break-words text-[12.5px] text-white", mono && "font-mono")}>{value}</p>
        <button
          type="button"
          onClick={copy}
          aria-label={`Copy ${label}`}
          title={copied ? "Copied" : `Copy ${label}`}
          className="mt-px shrink-0 rounded p-0.5 text-dim transition hover:text-white"
        >
          {copied ? <Check size={13} className="text-good" /> : <Copy size={13} />}
        </button>
      </div>
    </div>
  );
}

function AddSlabLink({ label }: { label: string }) {
  return (
    <Link
      href="/submit"
      className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-[13px] font-semibold text-white transition hover:bg-accent-hover active:scale-[0.99]"
    >
      <Plus size={15} /> {label}
    </Link>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-card border border-hairline bg-surface p-4">
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-dim">{icon}{label}</p>
      <p className="mt-1.5 text-lg font-bold">{value}</p>
    </div>
  );
}

function SubmissionsSkeleton() {
  return (
    <div className="space-y-5 px-4 py-5 lg:px-6">
      <div className="skeleton h-16 max-w-2xl rounded-xl" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((item) => <div key={item} className="skeleton h-20 rounded-card" />)}</div>
      <div className="skeleton h-64 rounded-card" />
    </div>
  );
}
