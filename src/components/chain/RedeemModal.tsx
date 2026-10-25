"use client";

import Link from "next/link";
import { CheckCircle2, Route, Truck } from "lucide-react";
import { useState } from "react";
import { useSlabChain } from "@/lib/chain/useSlabChain";
import { useStore } from "@/lib/store";
import type { Listing, VaultItem } from "@/lib/types";
import { Slab } from "../slab/Slab";
import { Button, Field, Modal, inputClass } from "../ui/primitives";
import { PendingSubmissions } from "./PendingSubmissions";
import { Fn, OnChainNote } from "./ui";

/**
 * Slab offboarding: the slab leaves the vault, the token stays.
 *   (tokenise first if it was never minted)
 *   SlabVault.requestRedemption(tokenId, keccak256(address))   wallet: token locked
 *   Collector Crypt POST /redemptions (as holder of CC's NFT)   operator: CC ships to the owner
 *   SlabVault.markShipped(tokenId, ccRedemptionId, carrier, tracking)   operator
 */
export function RedeemModal({ target, onClose }: { target: { entry: VaultItem; listing: Listing } | null; onClose: () => void }) {
  return (
    <Modal open={Boolean(target)} onClose={onClose} title="Withdraw to your address" width="max-w-lg">
      {target ? <Redeem key={target.listing.id} listingId={target.listing.id} listing={target.listing} onClose={onClose} /> : null}
    </Modal>
  );
}

function Redeem({ listingId, listing, onClose }: { listingId: string; listing: Listing; onClose: () => void }) {
  const { user, vault, withdrawSlab, pushToast } = useStore();
  const { uploadEvidence, submit, redeem } = useSlabChain();
  const entry = vault.find((v) => v.listingId === listingId);
  const [shipTo, setShipTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ carrier: string; trackingNumber: string; redemptionRef: string } | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const tokenise = async () => {
    setBusy(true);
    try {
      // Pokechain already holds this slab, so there are no new photos: the evidence records that.
      const form = new FormData();
      form.set(
        "meta",
        JSON.stringify({
          grader: listing.grader,
          certNumber: listing.certNumber,
          condition: { caseCracked: false, caseScratched: false, labelDamaged: false, notes: "Already held by Pokechain" },
          shipping: { method: "dropoff", carrier: "", tracking: "" },
          declarations: { owner: true, authentic: true, terms: true },
          submittedBy: user?.address ?? "",
          source: "already-vaulted",
        }),
      );
      const evidenceHash = await uploadEvidence(form);
      await submit({
        grader: listing.grader,
        certNumber: listing.certNumber,
        evidenceHash,
        inboundCarrier: "Already at Pokechain",
        inboundTracking: "",
      });
      setSubmitted(true);
    } catch (e) {
      pushToast({ title: "Could not submit", body: (e as Error).message, tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async () => {
    if (!entry?.token || !shipTo.trim()) return;
    setBusy(true);
    try {
      const out = await redeem(entry.token.tokenId, shipTo);
      withdrawSlab(listingId, {
        requestedAt: new Date().toISOString(),
        requestTx: out.requestTx,
        shippingHash: out.shippingHash,
        shipTo: shipTo.trim(),
        redemptionRef: out.redemptionRef,
        carrier: out.carrier,
        trackingNumber: out.trackingNumber,
        shipTx: out.tx.hash,
      });
      setDone({ carrier: out.carrier, trackingNumber: out.trackingNumber, redemptionRef: out.redemptionRef });
    } catch (e) {
      pushToast({ title: "Withdrawal failed", body: (e as Error).message, tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 p-5">
      <div className="flex gap-4">
        <div className="w-16 shrink-0">
          <Slab listing={listing} flat />
        </div>
        <div className="min-w-0 text-[13px]">
          <p className="font-semibold leading-snug">{listing.title}</p>
          <p className="mt-1 text-[12px] text-muted">
            {listing.grader} cert {listing.certNumber}
            {entry?.token ? ` · token #${entry.token.tokenId}` : " · not tokenised yet"}
          </p>
        </div>
      </div>

      {done ? (
        <div className="space-y-3 text-center">
          <CheckCircle2 size={36} className="mx-auto text-good" />
          <p className="text-[15px] font-bold">On its way</p>
          <p className="text-[13px] text-muted">
            Collector Crypt redemption <span className="font-mono text-white">{done.redemptionRef}</span> · {done.carrier}{" "}
            <span className="font-mono text-white">{done.trackingNumber}</span>. It&apos;s now in your Vault&apos;s Withdrawn
            tab. Confirm delivery there, or report it lost if it never arrives.
          </p>
          <div className="flex justify-center gap-2">
            <Link href={`/trace/${entry?.token?.tokenId}`} onClick={onClose}>
              <Button variant="secondary">
                <Route size={15} /> Trace it
              </Button>
            </Link>
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      ) : !entry?.token ? (
        <>
          {submitted ? (
            <PendingSubmissions />
          ) : (
            <>
              <OnChainNote
                title="Tokenise it first"
                tech={<><Fn>requestSubmission</Fn> → <Fn>markReceived</Fn> → <Fn>markForwarded</Fn> → Solana check → <Fn>confirmVaulted</Fn>.</>}
              >
                This slab is in your vault but has no token on the chain yet, so there is nothing to lock or trace. Submit it
                first: it gets a token, Pokechain receives it and passes it to Collector Crypt, and once Collector Crypt has
                vaulted it you can withdraw it.
              </OnChainNote>
              <Button className="w-full" onClick={tokenise} disabled={busy}>
                {busy ? "Confirm in your wallet…" : "Tokenise this slab"}
              </Button>
            </>
          )}
        </>
      ) : (
        <>
          <Field label="Ship to">
            <textarea
              className={`${inputClass} h-20 py-2.5`}
              value={shipTo}
              onChange={(e) => setShipTo(e.target.value)}
              placeholder={"Ash Ketchum\n1 Pallet Town Road, Kanto 000001"}
            />
          </Field>
          <Button className="w-full" size="lg" onClick={withdraw} disabled={busy || !shipTo.trim()}>
            <Truck size={16} />
            {busy ? "Working…" : "Withdraw and ship to me"}
          </Button>
        </>
      )}
    </div>
  );
}
