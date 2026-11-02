"use client";

import clsx from "clsx";
import Link from "next/link";
import { Check, Coins, Home, PackageCheck, Route, Truck } from "lucide-react";
import { useState } from "react";
import { CLAIM_STATUS } from "@/lib/chain/config";
import { type FoundCase, useLostSlabRecovery } from "@/lib/chain/useLostSlabRecovery";
import { useSlabChain } from "@/lib/chain/useSlabChain";
import { usd } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { Listing } from "@/lib/types";
import { Slab } from "../slab/Slab";
import { Badge, Button, inputClass } from "../ui/primitives";
import { CopyText } from "../chain/ChainConsole";

const TRAIL = ["Claim filed", "Authenticated at Pokechain", "Owner chose return", "Returned", "Bounty paid"];

/** Found-slab claims the signed-in collector is part of, as the finder or as the owner. */
export function FoundCaseList({ cases, me, listingsByToken = {} }: { cases: FoundCase[]; me: string; listingsByToken?: Record<string, Listing> }) {
  return (
    <ul className="space-y-3">
      {cases.map((c) => (
        <CaseRow key={c.claimId} c={c} role={c.owner.toLowerCase() === me ? "owner" : "finder"} listing={listingsByToken[c.tokenId]} />
      ))}
    </ul>
  );
}

/** What this person has to do next, if anything. Drives the ring and the button. */
function nextAction(c: FoundCase, role: "owner" | "finder") {
  if (role === "owner" && c.status === 2) return "choose";
  if (role === "owner" && c.status === 4 && c.returnTo === 2 && c.custody === "Shipped") return "confirm";
  if (role === "finder" && c.status === 4) return "claim";
  return null;
}

function CaseRow({ c, role, listing }: { c: FoundCase; role: "owner" | "finder"; listing?: Listing }) {
  const { chooseReturn, claimBounty } = useLostSlabRecovery();
  const { confirmDelivery } = useSlabChain();
  const { pushToast } = useStore();
  const [busy, setBusy] = useState(false);
  const [deliverOpen, setDeliverOpen] = useState(false);
  const [shipTo, setShipTo] = useState("");
  const action = nextAction(c, role);
  // The contract pays only once SlabVault shows the slab where the owner chose.
  const payable = c.returnTo === 1 ? c.custody === "Vaulted" : c.custody === "Delivered";

  const act = async (fn: () => Promise<unknown>, title: string, body?: string) => {
    setBusy(true);
    try {
      await fn();
      pushToast({ title, body, tone: "success" });
      setDeliverOpen(false);
    } catch (e) {
      pushToast({ title: "Transaction failed", body: (e as Error).message, tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <li
      data-testid={`found-case-${c.claimId}`}
      className={clsx("rounded-card border bg-surface p-4", action ? "border-accent ring-2 ring-accent/40" : "border-hairline")}
    >
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(520px,0.9fr)]">
        <div className="flex min-w-0 items-start gap-3">
          {listing ? (
            <Link href={`/asset/${listing.id}?lost=1`} className="w-10 shrink-0">
              <span className="block h-14 w-10 overflow-hidden rounded-md bg-surface-2"><Slab listing={listing} flat /></span>
            </Link>
          ) : c.image ? (
            <span aria-hidden className="block h-14 w-10 shrink-0 rounded-md bg-surface-2 bg-cover bg-center" style={{ backgroundImage: `url(${c.image})` }} />
          ) : (
            <span className="grid h-14 w-10 shrink-0 place-items-center rounded-md bg-surface-2 text-[9px] font-bold text-dim">NFT</span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="line-clamp-1 text-[13px] font-semibold">{listing?.title ?? c.title}</p>
              <Badge tone={role === "owner" ? "warn" : "accent"}>{role === "owner" ? "Your lost slab" : "You found it"}</Badge>
              <Badge tone={c.status === 5 ? "good" : c.status === 6 ? "warn" : "neutral"}>{CLAIM_STATUS[c.status]}</Badge>
            </div>
            <p className="mt-1 text-[12px] text-muted">
              Case #{c.claimId} · PSA cert #{c.certNumber} · token #{c.tokenId} ·{" "}
              <span className="font-semibold text-good">
                {c.status === 5 ? `${usd(c.paid, { cents: true })} paid to the finder` : `${usd(c.bounty, { cents: true })} bounty in escrow`}
              </span>
            </p>

            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-dim">
              <span>evidenceHash <CopyText text={c.evidenceHash} /></span>
              <span>to Pokechain: {c.inboundCarrier} {c.inboundTracking}</span>
              {c.returnTo === 2 ? <span>shippingHash <CopyText text={c.shippingHash} /></span> : null}
              <span>slab custody: <b className="text-white">{c.custody}</b></span>
              <Link href={`/trace/${c.tokenId}`} className="inline-flex items-center gap-1 font-semibold text-accent hover:underline">
                <Route size={11} /> Full trace
              </Link>
            </div>

            <p className="mt-2 text-[12px] text-muted">{caseUpdate(c, role, payable)}</p>
          </div>
        </div>

        <div className="min-w-0 rounded-xl border border-hairline bg-black/10 p-3">
          <RecoveryTimeline c={c} />
          {c.status === 6 ? <p className="mt-2 text-[11px] font-semibold text-bad">Rejected by Pokechain (claim bond slashed to owner)</p> : null}
          <div className="mt-3 flex flex-wrap justify-end gap-2">
          {action === "choose" ? (
            <>
              <Button size="sm" disabled={busy} onClick={() => act(() => chooseReturn(c.claimId, true), "Returning to your vault", "Pokechain will put it back in the vault; the NFT stays yours.")}>
                <Home size={13} /> Return to my vault
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setDeliverOpen((v) => !v)}>
                <Truck size={13} /> Deliver to me
              </Button>
            </>
          ) : null}
          {action === "confirm" ? (
            <Button size="sm" disabled={busy} onClick={() => act(() => confirmDelivery(c.tokenId), "Delivery confirmed", "The finder can now claim the bounty.")}>
              <PackageCheck size={13} /> Confirm received
            </Button>
          ) : null}
          {action === "claim" ? (
            <Button
              size="sm"
              disabled={busy || !payable}
              title={payable ? undefined : "Paid once the slab is back in the vault or the owner confirms delivery"}
              onClick={() => act(() => claimBounty(c.claimId), "Bounty claimed", `${usd(c.bounty, { cents: true })} added to your Pokechain balance.`)}
            >
              <Coins size={13} /> {c.bounty > 0 ? `Claim ${usd(c.bounty, { cents: true })} bounty` : "Close case"}
            </Button>
          ) : null}
          </div>
        </div>
      </div>

      {deliverOpen && action === "choose" ? (
        <div className="mt-3 space-y-2 rounded-xl bg-[#101014] p-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <input className={inputClass} value={shipTo} onChange={(e) => setShipTo(e.target.value)} placeholder="Ash Ketchum, 1 Pallet Town Road" />
            <Button disabled={busy || !shipTo.trim()} onClick={() => act(() => chooseReturn(c.claimId, false, shipTo), "Delivery requested", "Pokechain will ship the slab to you.")}>
              Deliver here
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function RecoveryTimeline({ c }: { c: FoundCase }) {
  const completed = c.status === 6 ? 0 : Math.min(c.status, TRAIL.length);
  return (
    <div>
      <p className="mb-3 text-[10px] font-bold uppercase tracking-wide text-dim">Recovery progress</p>
      <div className="no-scrollbar overflow-x-auto pb-1">
        <ol className="grid min-w-[600px] grid-cols-5">
          {TRAIL.map((name, index) => {
            const done = index < completed;
            const label = index === 2 && c.returnTo ? (c.returnTo === 1 ? "Owner chose: vault" : "Owner chose: delivery") : name;
            return (
              <li key={name} className="relative flex min-w-0 flex-col items-center gap-1.5 text-center">
                {index < TRAIL.length - 1 ? (
                  <span
                    aria-hidden
                    className={clsx("absolute top-[9.5px] h-px", index < completed - 1 ? "bg-good/60" : "bg-hairline")}
                    style={{ left: "calc(50% + 10px)", width: "calc(100% - 20px)" }}
                  />
                ) : null}
                <span className={clsx("relative z-10 grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[9px] font-bold", done ? "border-good/70 bg-good/10 text-good" : "border-hairline bg-surface text-dim")}>
                  {done ? <Check size={11} /> : index + 1}
                </span>
                <span className={clsx("text-[10px] font-semibold leading-tight", done ? "text-good" : "text-dim")}>{label}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

/** One plain-English line on where the case stands, for whoever is looking. */
function caseUpdate(c: FoundCase, role: "owner" | "finder", payable: boolean) {
  const vault = c.returnTo === 1;
  switch (c.status) {
    case 1:
      return role === "finder"
        ? "Ship the slab to Pokechain Recovery Desk, 1 Vault Way, Singapore 018956. Pokechain checks it at intake."
        : "Someone found your slab and is sending it to Pokechain. You'll choose where it goes once it's authenticated.";
    case 2:
      return role === "owner"
        ? "Your slab was found and authenticated. Put it back in your vault, or have it delivered to you."
        : "Case update: Pokechain authenticated the slab you found and refunded your security bond. Waiting for the owner to choose vault or delivery.";
    case 3:
      return `The owner chose ${vault ? "the vault" : "delivery"}. Waiting for Pokechain to send it.`;
    case 4:
      if (role === "finder") {
        return payable
          ? "The slab is back. The bounty is yours to claim."
          : vault
            ? "The slab is back at Pokechain and finishing vaulting. The bounty unlocks once it's Vaulted."
            : "On its way to the owner. The bounty unlocks when they confirm they received it.";
      }
      return vault
        ? c.custody === "Vaulted" ? "Back in your vault. The NFT is tradeable again." : "Back at Pokechain, finishing vaulting."
        : c.custody === "Delivered" ? "Delivered. The finder can now claim the bounty." : "On its way to you. Confirm when it arrives so the finder is paid.";
    case 5:
      return `Closed. The finder was paid ${usd(c.paid, { cents: true })} from escrow.`;
    case 6:
      return "Pokechain could not match this slab to the lost token. The bounty stays posted.";
    default:
      return "";
  }
}

