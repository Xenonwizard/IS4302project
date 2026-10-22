"use client";

import { CheckCircle2, Truck } from "lucide-react";
import { useState } from "react";
import { keccak256, toBytes } from "viem";
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
 *   SlabVault.markShipped(tokenId, carrier, tracking)           operator, after Grade10 releases it
 */
export function RedeemModal({ target, onClose }: { target: { entry: VaultItem; listing: Listing } | null; onClose: () => void }) {
  return (
    <Modal open={Boolean(target)} onClose={onClose} title="Withdraw to your address" width="max-w-lg">
      {target ? <Redeem key={target.listing.id} listingId={target.listing.id} listing={target.listing} onClose={onClose} /> : null}
    </Modal>
  );
}

function Redeem({ listingId, listing, onClose }: { listingId: string; listing: Listing; onClose: () => void }) {
  const { vault, withdrawSlab, pushToast } = useStore();
  const { submit, redeem } = useSlabChain();
  const entry = vault.find((v) => v.listingId === listingId);
  const [shipTo, setShipTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ carrier: string; trackingNumber: string } | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const hash = shipTo.trim() ? keccak256(toBytes(shipTo.trim())) : null;

  const tokenise = async () => {
    setBusy(true);
    try {
      await submit(listing.grader, listing.certNumber);
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
        carrier: out.carrier,
        trackingNumber: out.trackingNumber,
        shipTx: out.tx.hash,
      });
      setDone({ carrier: out.carrier, trackingNumber: out.trackingNumber });
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
            {done.carrier} · tracking <span className="font-mono text-white">{done.trackingNumber}</span>. It&apos;s now in your
            Vault&apos;s Withdrawn tab. Confirm delivery there, or report it lost if it never arrives.
          </p>
          <Button onClick={onClose}>Done</Button>
        </div>
      ) : !entry?.token ? (
        <>
          {submitted ? (
            <PendingSubmissions />
          ) : (
            <>
              <OnChainNote title="Tokenise it first">
                This slab is in your vault but has no token on-chain yet, so there is nothing to lock or trace.
                Submitting it runs the usual onboarding: <Fn>requestSubmission</Fn>, then the Grade10 + Solana
                check, then <Fn>mintSlab</Fn>. After that you can withdraw it.
              </OnChainNote>
              <Button className="w-full" onClick={tokenise} disabled={busy}>
                {busy ? "Confirm in your wallet…" : "Tokenise this slab"}
              </Button>
            </>
          )}
        </>
      ) : (
        <>
          <Field label="Ship to" hint="Stays in this browser. Only its keccak256 hash goes on-chain.">
            <textarea
              className={`${inputClass} h-20 py-2.5`}
              value={shipTo}
              onChange={(e) => setShipTo(e.target.value)}
              placeholder={"Ash Ketchum\n1 Pallet Town Road, Kanto 000001"}
            />
          </Field>
          {hash ? <p className="break-all font-mono text-[11px] text-dim">shippingHash = {hash}</p> : null}
          <OnChainNote>
            1. <Fn>SlabVault.requestRedemption(tokenId, shippingHash)</Fn> moves custody to{" "}
            <b className="text-white">Redemption requested</b>. The token is <b className="text-white">locked</b>:{" "}
            <Fn>_update</Fn> now refuses transfers, and it drops out of <Fn>vaultedCount</Fn>.
            <br />
            2. Grade10 releases the slab (its Solana NFT leaves the vault wallet). The operator then calls{" "}
            <Fn>markShipped(tokenId, carrier, tracking)</Fn>.
            <br />
            The token is <b className="text-white">never burned</b>. It stays in your wallet with its full custody
            trail, so if the parcel goes missing you can call <Fn>reportLost</Fn> and the claim can be checked
            against the chain. The listing comes off the marketplace and open offers are declined.
          </OnChainNote>
          <Button className="w-full" size="lg" onClick={withdraw} disabled={busy || !shipTo.trim()}>
            <Truck size={16} />
            {busy ? "Working…" : "Withdraw and ship to me"}
          </Button>
        </>
      )}
    </div>
  );
}
