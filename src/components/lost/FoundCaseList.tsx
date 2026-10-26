"use client";

import clsx from "clsx";
import Link from "next/link";
import { Coins, Home, PackageCheck, Route, Truck } from "lucide-react";
import { useState } from "react";
import { CLAIM_STATUS } from "@/lib/chain/config";
import { type FoundCase, useLostAndFound } from "@/lib/chain/useLostAndFound";
import { useSlabChain } from "@/lib/chain/useSlabChain";
import { usd } from "@/lib/format";
import { useStore } from "@/lib/store";
import { Badge, Button, inputClass } from "../ui/primitives";
import { CopyText } from "../chain/ChainConsole";
import { Fn } from "../chain/ui";

const TRAIL = ["Claim filed", "Authenticated at Pokechain", "Owner chose return", "Returned", "Bounty paid"];

/** Found-slab claims the signed-in collector is part of, as the finder or as the owner. */
export function FoundCaseList({ cases, me }: { cases: FoundCase[]; me: string }) {
  return (
    <ul className="space-y-3">
      {cases.map((c) => (
        <CaseRow key={c.claimId} c={c} role={c.owner.toLowerCase() === me ? "owner" : "finder"} />
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

function CaseRow({ c, role }: { c: FoundCase; role: "owner" | "finder" }) {
  const { chooseReturn, claimBounty } = useLostAndFound();
  const { confirmDelivery } = useSlabChain();
  const { pushToast } = useStore();
  const [busy, setBusy] = useState(false);
  const [deliverOpen, setDeliverOpen] = useState(false);
  const [shipTo, setShipTo] = useState("");
  const action = nextAction(c, role);
  // The contract pays only once SlabVault shows the slab where the owner chose.
  const payable = c.returnTo === 1 ? c.custody === "Vaulted" : c.custody === "Delivered";
  const step = c.status === 6 ? -1 : c.status - 1;

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
      <div className="flex flex-wrap gap-4">
        {c.image ? <img src={c.image} alt="" className="h-20 w-14 shrink-0 rounded-md object-cover" /> : null}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="line-clamp-1 text-[13px] font-semibold">{c.title}</p>
            <Badge tone={role === "owner" ? "warn" : "accent"}>{role === "owner" ? "Your lost slab" : "You found it"}</Badge>
            <Badge tone={c.status === 5 ? "good" : c.status === 6 ? "warn" : "neutral"}>{CLAIM_STATUS[c.status]}</Badge>
          </div>
          <p className="mt-1 text-[12px] text-muted">
            Case #{c.claimId} · PSA cert #{c.certNumber} · token #{c.tokenId} ·{" "}
            <span className="font-semibold text-good">
              {c.status === 5 ? `${usd(c.paid, { cents: true })} paid to the finder` : `${usd(c.bounty, { cents: true })} bounty in escrow`}
            </span>
          </p>

          <ol className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
            {TRAIL.map((name, i) => (
              <li key={name} className={clsx("rounded-md px-2 py-1", i <= step ? "bg-good-bg text-good" : "bg-surface-2 text-dim")}>
                {i === 2 && c.returnTo ? (c.returnTo === 1 ? "Owner chose: vault" : "Owner chose: delivery") : name}
              </li>
            ))}
            {c.status === 6 ? <li className="rounded-md bg-bad/15 px-2 py-1 text-bad">Rejected by Pokechain</li> : null}
          </ol>

          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-dim">
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

        <div className="flex flex-col gap-2">
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
              onClick={() => act(() => claimBounty(c.claimId), "Bounty claimed", `${usd(c.bounty, { cents: true })} moved from LostAndFound to your Pokechain balance.`)}
            >
              <Coins size={13} /> {c.bounty > 0 ? `Claim ${usd(c.bounty, { cents: true })} bounty` : "Close case"}
            </Button>
          ) : null}
        </div>
      </div>

      {deliverOpen && action === "choose" ? (
        <div className="mt-3 space-y-2 rounded-xl bg-[#101014] p-3">
          <p className="text-[12px] text-muted">
            Calls <Fn>LostAndFound.chooseReturn(claimId, false, keccak256(address))</Fn>. Only the hash goes on-chain; Pokechain gets the address itself.
          </p>
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
        : "Case update: Pokechain authenticated the slab you found. Waiting for the owner to choose vault or delivery.";
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

