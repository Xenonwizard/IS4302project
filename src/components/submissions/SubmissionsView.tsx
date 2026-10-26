"use client";

import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import Image from "next/image";
import Link from "next/link";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Copy,
  FileText,
  PackageCheck,
  PackageSearch,
  Plus,
  TriangleAlert,
  Truck,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { certPreview, getListing } from "@/lib/catalog";
import { OPEN_SUBMISSION } from "@/lib/chain/config";
import { type SubmissionRequest, useSubmissions } from "@/lib/chain/useSubmissions";
import { useStore } from "@/lib/store";
import type { Listing, VaultItem } from "@/lib/types";
import { WithdrawnList } from "../chain/WithdrawnList";
import { TimeAgo } from "../ui/primitives";
import { Empty, LoginPrompt } from "../vault/shared";

type Filter = "all" | "progress" | "vaulted" | "withdrawals" | "attention";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "progress", label: "In progress" },
  { value: "vaulted", label: "Vaulted" },
  { value: "withdrawals", label: "Withdrawals" },
  { value: "attention", label: "Needs attention" },
];

export const SUBMISSION_STAGE: Record<number, string> = {
  1: "Awaiting receipt at Pokechain",
  2: "Received at Pokechain",
  3: "With Collector Crypt",
  4: "Vaulted",
  5: "Rejected",
};

const TIMELINE_STEPS = ["Submitted", "Received", "At custodian", "Vaulted"];

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
  const { user, ready, vault, resolve } = useStore();
  const { data: requests = [], isPending, isError, refetch } = useSubmissions();
  const params = useSearchParams();
  const [filter, setFilter] = useState<Filter>(() => FILTERS.find((f) => f.value === params.get("tab"))?.value ?? "all");
  const [openId, setOpenId] = useState<string | null>(null);

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

  const visible = filter === "withdrawals" ? [] : requests.filter((request) => {
    if (filter === "progress") return OPEN_SUBMISSION.has(request.status);
    if (filter === "vaulted") return request.status === 4;
    if (filter === "attention") return request.status === 5;
    return true;
  });
  const visibleLocal = filter === "all" || filter === "vaulted" ? localRequests : [];
  const visibleWithdrawals = filter === "all" || filter === "withdrawals" ? withdrawals : [];
  const total = requests.length + localRequests.length + withdrawals.length;
  const inProgress = requests.filter((request) => OPEN_SUBMISSION.has(request.status)).length;
  const awaitingVault = requests.filter((request) => request.status === 2 || request.status === 3).length;
  const vaulted = requests.filter((request) => request.status === 4).length + localRequests.length;
  const counts: Record<Filter, number> = {
    all: total,
    progress: inProgress,
    vaulted,
    withdrawals: withdrawals.length,
    attention: requests.filter((request) => request.status === 5).length,
  };

  if (!ready) return <SubmissionsSkeleton />;
  if (!user) {
    return (
      <LoginPrompt
        icon={<PackageSearch size={26} />}
        title="Submissions"
        body="Log in to add slabs and follow every request from submission to vaulting."
      />
    );
  }

  return (
    <div className="px-4 py-5 lg:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-bold">Submissions</h1>
          <p className="mt-1 max-w-2xl text-[13px] text-muted">
            Add slabs and track every request here. Select a request to review the form you submitted.
          </p>
        </div>
        <AddSlabLink label="Add a slab" />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={<FileText size={15} />} label="All requests" value={total} />
        <Stat icon={<Clock3 size={15} />} label="In progress" value={inProgress} />
        <Stat icon={<PackageSearch size={15} />} label="Awaiting vault" value={awaitingVault} />
        <Stat icon={<PackageCheck size={15} />} label="Vaulted" value={vaulted} />
      </div>

      <div className="no-scrollbar mt-6 flex gap-1 overflow-x-auto border-b border-hairline">
        {FILTERS.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => setFilter(item.value)}
            className={clsx(
              "relative shrink-0 px-4 py-3 text-[13px] font-bold transition",
              filter === item.value ? "text-white" : "text-muted hover:text-white",
            )}
          >
            {item.label}
            <span className="ml-1.5 rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px]">{counts[item.value]}</span>
            {filter === item.value ? <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-accent" /> : null}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {user.address && isPending ? (
          <div className="space-y-2">{[0, 1, 2].map((item) => <div key={item} className="skeleton h-24 rounded-card" />)}</div>
        ) : user.address && isError ? (
          <div className="rounded-card border border-bad/30 bg-bad/5 px-5 py-8 text-center">
            <TriangleAlert size={22} className="mx-auto text-bad" />
            <p className="mt-2 text-sm font-semibold">Your submissions could not be loaded.</p>
            <button type="button" onClick={() => void refetch()} className="mt-3 text-[13px] font-semibold text-accent hover:underline">
              Try again
            </button>
          </div>
        ) : visible.length || visibleLocal.length || visibleWithdrawals.length ? (
          <div className="space-y-6">
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
              <h2 className="mb-1 flex items-center gap-2 text-[15px] font-bold"><Truck size={15} /> Withdraw requests</h2>
              <p className="mb-3 text-[12px] text-muted">
                Slabs you asked to ship out of the vault. Confirm delivery when it arrives, or report it lost if it never does.
              </p>
              <WithdrawnList items={visibleWithdrawals} />
            </section>
          ) : null}
          </div>
        ) : total ? (
          <Empty
            icon={filter === "attention" ? <CheckCircle2 size={24} /> : <PackageSearch size={24} />}
            title={filter === "attention" ? "No requests need attention" : "No requests in this view"}
            body="Choose another filter to see your slab requests."
          />
        ) : (
          <Empty
            icon={<PackageSearch size={24} />}
            title="No slab submissions yet"
            body="Start a request for each graded slab you want Pokechain and Collector Crypt to vault. You can submit as many slabs as you need."
            cta={{ href: "/submit", label: "Add your first slab" }}
          />
        )}
      </div>

      {total ? <div className="mt-5 flex justify-center"><AddSlabLink label="Add another slab" /></div> : null}
    </div>
  );
}

function RequestAccordion({
  request,
  open,
  onToggle,
}: {
  request: SubmissionRequest;
  open: boolean;
  onToggle: () => void;
}) {
  const preview = certPreview(request.grader, request.certNumber);

  return (
    <li data-testid={`request-${request.certNumber}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={`${request.grader} cert ${request.certNumber}, ${SUBMISSION_STAGE[request.status]}`}
        className="grid w-full grid-cols-1 gap-3 px-4 py-4 text-left transition hover:bg-white/[0.035] md:grid-cols-[minmax(240px,1.25fr)_minmax(210px,1fr)_150px_28px] md:items-center md:gap-4"
      >
        <div className="flex min-w-0 items-center gap-3">
          {preview ? (
            <span className="relative block h-14 w-10 shrink-0 overflow-hidden rounded-md bg-surface-2">
              <Image src={preview.thumb} alt="" fill sizes="40px" className="object-cover" />
            </span>
          ) : (
            <span className="grid h-14 w-10 shrink-0 place-items-center rounded-md bg-surface-2 text-dim"><FileText size={17} /></span>
          )}
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-bold">{request.grader} cert {request.certNumber}</span>
            <span className="mt-1 block text-[11.5px] text-dim">
              Request #{request.submissionId}{request.tokenId !== "0" ? ` · NFT #${request.tokenId}` : ""}
            </span>
            <span className="mt-2 block"><StatusBadge status={request.status} /></span>
          </span>
        </div>

        <ProgressTimeline status={request.status} />
        <span className="hidden text-[11.5px] text-muted md:block"><TimeAgo value={request.requestedAt * 1000} /></span>
        <ChevronDown size={17} className={clsx("justify-self-end text-dim transition", open && "rotate-180 text-white")} />
      </button>
      {open ? <SubmissionFormDetails request={request} /> : null}
    </li>
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
          <span className="relative block h-14 w-10 shrink-0 overflow-hidden rounded-md bg-surface-2">
            <Image src={listing.thumb} alt="" fill sizes="40px" className="object-cover" />
          </span>
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
    <ol className="flex min-w-0 items-center gap-1.5 pt-1 md:pt-0">
      {TIMELINE_STEPS.map((step, index) => {
        const done = index < completed;
        return (
          <li key={step} className="flex min-w-0 flex-1 items-center gap-1.5">
            <span className={clsx("grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[9px] font-bold", done ? "border-good/70 bg-good/10 text-good" : "border-hairline text-dim")}>
              {done ? <Check size={11} /> : index + 1}
            </span>
            {index < TIMELINE_STEPS.length - 1 ? <span className={clsx("h-px min-w-2 flex-1", index < completed - 1 ? "bg-good/60" : "bg-hairline")} /> : null}
            <span className="sr-only">{step}</span>
          </li>
        );
      })}
    </ol>
  );
}

function SubmissionFormDetails({ request }: { request: SubmissionRequest }) {
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
      {request.tokenId !== "0" && request.status !== 5 ? (
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <span className="mr-auto text-[11.5px] text-muted">
            {request.status === 4
              ? `NFT #${request.tokenId} is vaulted and unlocked in your Vault.`
              : `NFT #${request.tokenId} was minted when Pokechain received the slab. It waits in your Vault, locked, until Collector Crypt vaults it.`}
          </span>
          {/* One way in: while it is being vaulted, the Vault's Awaiting vault tab; once vaulted, the Vault. */}
          <Link
            href={request.status === 4 ? "/vault" : "/vault?tab=awaiting"}
            className="inline-flex h-9 items-center rounded-lg bg-accent px-3.5 text-[12px] font-semibold text-white transition hover:bg-accent-hover"
          >
            View Vaulted NFT
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function StatusBadge({ status }: { status: number }) {
  return (
    <span
      data-testid="request-stage"
      className={clsx(
        "inline-flex rounded-md px-2 py-1 text-[10.5px] font-bold",
        status === 5 ? "bg-bad/15 text-bad" : status === 4 ? "bg-good-bg text-good" : "bg-warn/15 text-warn",
      )}
    >
      {SUBMISSION_STAGE[status]}
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
