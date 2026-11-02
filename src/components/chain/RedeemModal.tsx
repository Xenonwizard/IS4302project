"use client";

import { CheckCircle2, Truck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useSlabChain } from "@/lib/chain/useSlabChain";
import { useStore } from "@/lib/store";
import type { Listing, VaultItem } from "@/lib/types";
import { Slab } from "../slab/Slab";
import { Button, Field, Modal, inputClass } from "../ui/primitives";

/**
 * Slab offboarding: the slab leaves the vault; its title NFT locks at the request and burns at dispatch.
 *   (tokenise first if it was never minted)
 *   SlabVault.requestRedemption(tokenId, keccak256(address))   wallet: token locked, redeemerOf = owner
 *   /outtake: Collector Crypt POST /redemptions (as holder of CC's NFT)   operator: CC ships to the owner
 *   SlabVault.markShipped(tokenId, ccRedemptionId, carrier, tracking)   operator: token burned
 *   SlabVault.confirmDelivery(tokenId)   redeemer: custody Delivered
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
  const [done, setDone] = useState(false);
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
      });
      setDone(true);
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
          <p className="text-[15px] font-bold">Withdrawal requested</p>
          <p className="text-[13px] text-muted">
            Pokechain now notifies Collector Crypt to release and ship the card. Track it under Status Center → Withdrawn and confirm delivery there when it
            arrives.
          </p>
          <div className="flex justify-center gap-2">
            <Link href="/submissions?tab=withdrawals" onClick={onClose}>
              <Button variant="outline">View withdraw request</Button>
            </Link>
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      ) : !entry?.token ? (
        <>
          {submitted ? (
            <p className="text-[13px] text-muted">The intake request is waiting for Pokechain to receive the slab before an NFT is minted.</p>
          ) : (
            <>
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
          <p className="text-[12px] text-muted">
            Shipping it home locks this slab. It can&apos;t be listed or traded again. Once it&apos;s in the post, Collector Crypt and the
            carrier are responsible for it.
          </p>
          <Button className="w-full" size="lg" onClick={withdraw} disabled={busy || !shipTo.trim()}>
            <Truck size={16} />
            {busy ? "Working…" : "Withdraw and ship to me"}
          </Button>
        </>
      )}
    </div>
  );
}
