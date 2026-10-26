"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Loader2, Truck } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { keccak256, toBytes } from "viem";
import { usePublicClient } from "wagmi";
import { CUSTODY, IS_DEPLOYED, contracts } from "@/lib/chain/config";
import { useLostSlabs, useStore } from "@/lib/store";
import { Button, inputClass } from "../ui/primitives";

interface OuttakeRecord {
  tokenId: string;
  custody: number;
  custodianRef: string;
  trackingNumber: string;
  shippingHash: string;
  owner: string | null;
}

/**
 * The operator-side companion to /intake. A redemption request is the owner's signed instruction;
 * this screen makes Pokechain's server-to-Collector-Crypt release and shipping hand-off visible.
 */
export function OuttakeSimulator() {
  const client = usePublicClient();
  const queryClient = useQueryClient();
  const params = useSearchParams();
  const { pushToast, verifyFoundSlab, rejectFoundSlab } = useStore();
  const lostSlabs = useLostSlabs();
  const [certNumber, setCertNumber] = useState(() => params.get("certNumber") ?? "");
  const [shipTo, setShipTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const valid = /^\d{1,10}$/.test(certNumber) && BigInt(certNumber || "0") > BigInt(0);
  const origin = typeof window === "undefined" ? "http://localhost:3000" : window.location.origin;

  const { data: record, error, refetch } = useQuery({
    queryKey: ["outtake-cert", certNumber],
    enabled: Boolean(client && valid),
    retry: false,
    refetchInterval: 1_500,
    queryFn: async (): Promise<OuttakeRecord> => {
      const submission = await client!.readContract({ ...contracts.slabVault, functionName: "submissionOf", args: [BigInt(certNumber)] });
      if (submission.certNumber !== certNumber || submission.tokenId === BigInt(0)) {
        throw new Error("This PSA cert does not have a minted SlabVault token.");
      }
      const [slab, owner] = await Promise.all([
        client!.readContract({ ...contracts.slabVault, functionName: "slabOf", args: [submission.tokenId] }),
        // Reverts once the owner confirmed receipt and the token was burned.
        client!.readContract({ ...contracts.slabVault, functionName: "ownerOf", args: [submission.tokenId] }).catch(() => null),
      ]);
      return {
        tokenId: submission.tokenId.toString(),
        custody: slab.custody,
        custodianRef: slab.custodianRef,
        trackingNumber: slab.trackingNumber,
        shippingHash: slab.shippingHash,
        owner,
      };
    },
  });

  const awaitingDispatch = record && CUSTODY[record.custody] === "Redemption requested";

  // The address the owner gave Pokechain when withdrawing; it fills the form below.
  const { data: savedAddress } = useQuery({
    queryKey: ["outtake-address", certNumber, record?.custody],
    enabled: Boolean(awaitingDispatch),
    retry: false,
    queryFn: async () => {
      const response = await fetch(`/api/chain/outtake/address?certNumber=${certNumber}`);
      return response.ok ? (((await response.json()) as { shipTo: string | null }).shipTo ?? "") : "";
    },
  });
  const [filledFor, setFilledFor] = useState("");
  if (savedAddress && filledFor !== certNumber) {
    setFilledFor(certNumber);
    setShipTo(savedAddress);
  }
  const curl = `curl -X POST ${origin}/api/chain/outtake -H 'content-type: application/json' -d '{"certNumber":"${certNumber || "1234567"}"}'`;

  const copy = async () => {
    await navigator.clipboard?.writeText(curl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  const dispatch = async () => {
    if (!awaitingDispatch || !shipTo.trim()) return;
    // Same check the operator makes before calling Collector Crypt: the address must hash to what the owner signed.
    if (keccak256(toBytes(shipTo.trim())) !== record.shippingHash) {
      pushToast({ title: "Address mismatch", body: "That address doesn't match the shippingHash the owner signed on-chain.", tone: "error" });
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/chain/outtake", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ certNumber, shipTo: shipTo.trim() }),
      });
      const result = (await response.json()) as { error?: string; redemptionRef?: string; carrier?: string; trackingNumber?: string; owner?: string };
      if (!response.ok) throw new Error(result.error ?? "Collector Crypt did not accept the outtake request");
      pushToast({
        title: "Collector Crypt notified",
        body: `${result.redemptionRef}: ${result.carrier} ${result.trackingNumber} to ${shortAddress(result.owner)}.`,
        tone: "success",
      });
      await Promise.all([
        refetch(),
        queryClient.invalidateQueries({ queryKey: ["owned-slabs"] }),
      ]);
    } catch (err) {
      pushToast({ title: "Outtake notification failed", body: (err as Error).message, tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const verifyRecovery = async (listingId: string, tokenId: string, trackingNumber: string, inTransit: boolean) => {
    // Lost in the post: ship it back to the owner on-chain. Lost inside CC's vault: it goes back on the shelf.
    const carrier = inTransit ? "Pokechain Secure" : "Back to Collector Crypt vault";
    setBusy(true);
    try {
      if (IS_DEPLOYED && tokenId && inTransit) {
        const response = await fetch("/api/chain/recover-lost", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tokenId, carrier, trackingNumber }),
        });
        const body = (await response.json()) as { error?: string };
        if (!response.ok) throw new Error(body.error ?? "The recovered slab could not be returned");
      }
      verifyFoundSlab(listingId, carrier, trackingNumber);
    } catch (err) {
      pushToast({ title: "Recovery verification failed", body: (err as Error).message, tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-[26px] font-bold">Card outtake simulator</h1>
      <p className="mt-2 text-[14px] text-muted">
        Enter the PSA cert number. Pokechain resolves its SlabVault token internally, then once its owner has requested withdrawal, notifies Collector Crypt&apos;s vault to release the physical card and ship it to that latest owner.
      </p>

      <label className="mt-7 block text-[13px] font-bold">
        PSA cert number
        <input
          className={`${inputClass} mt-2`}
          value={certNumber}
          onChange={(event) => setCertNumber(event.target.value.replace(/\D/g, "").slice(0, 10))}
          placeholder="1234567"
          inputMode="numeric"
          autoFocus
        />
      </label>

      {valid ? (
        <div className="mt-3 text-[13px] text-muted">
          {error ? (error as Error).message : record ? (
            <>
              SlabVault token #{record.tokenId} · current status: <span className="font-semibold text-white">{CUSTODY[record.custody]}</span> · {record.owner ? <>latest owner <span className="font-mono text-white">{shortAddress(record.owner)}</span></> : "token burned after the owner confirmed receipt"}
            </>
          ) : "Reading custody record…"}
        </div>
      ) : certNumber ? <p className="mt-3 text-[13px] text-bad">Enter a numeric PSA cert number.</p> : null}

      <section className="mt-7 rounded-card border border-hairline bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[15px] font-bold">Notify Collector Crypt and dispatch</p>
            <p className="mt-1 text-[12px] leading-relaxed text-muted">
              Pokechain verifies the owner&apos;s signed shipping-address hash, calls Collector Crypt&apos;s redemption API as escrow NFT holder, then writes CC&apos;s tracking reference back to SlabVault.
            </p>
            {record ? (
              <p className={`mt-2 text-[11px] font-bold ${awaitingDispatch ? "text-good" : "text-dim"}`}>
                {awaitingDispatch ? "Ready: the latest owner requested redemption." : record.trackingNumber ? `Already dispatched: ${record.trackingNumber}` : "Available after the owner requests withdrawal."}
              </p>
            ) : null}
          </div>
        </div>

        <label className="mt-4 block text-[12px] font-bold uppercase tracking-wide text-muted">
          Owner&apos;s delivery address
          <textarea
            className={`${inputClass} mt-2 h-20 py-2.5 normal-case tracking-normal`}
            value={shipTo}
            onChange={(event) => setShipTo(event.target.value)}
            placeholder={"Ash Ketchum\n1 Pallet Town Road, Kanto 000001"}
            disabled={!awaitingDispatch || busy}
          />
        </label>
        <Button className="mt-3 w-full" disabled={!awaitingDispatch || !shipTo.trim() || busy} onClick={() => void dispatch()}>
          {busy ? <><Loader2 size={15} className="animate-spin" /> Notifying Collector Crypt…</> : <><Truck size={15} /> Notify Collector Crypt and ship</>}
        </Button>

        <div className="mt-3 flex items-start gap-2 rounded-lg bg-black/25 p-3">
          <code className="min-w-0 flex-1 break-all text-[11px] text-dim">{curl}</code>
          <button onClick={() => void copy()} className="shrink-0 text-muted hover:text-white" title="Copy curl command">
            {copied ? <Check size={15} className="text-good" /> : <Copy size={15} />}
          </button>
        </div>
      </section>

      <section className="mt-7 rounded-card border border-hairline bg-surface p-4">
        <p className="text-[15px] font-bold">Found-slab verification queue</p>
        <p className="mt-1 text-[12px] leading-relaxed text-muted">
          Pokechain/Collector Crypt verifies the physical evidence and slab. Approval creates the return shipment; the owner must confirm receipt before any bounty is released.
        </p>
        <div className="mt-4 space-y-3">
          {lostSlabs.filter((item) => item.recovery?.status === "Submitted").map((item) => {
            const recovery = item.recovery!;
            const returnTracking = `PCR-${recovery.id.slice(4)}-${item.listing.certNumber.slice(-4)}`;
            return (
              <div key={item.listing.id} className="rounded-xl border border-hairline bg-black/20 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-[13px] font-bold">{item.listing.title}</p>
                    <p className="mt-1 text-[11px] text-muted">PSA cert #{item.listing.certNumber} · {recovery.id} · finder @{recovery.finder}</p>
                    <p className="mt-2 text-[11px] text-dim">Inbound: {recovery.inboundCarrier} {recovery.inboundTracking}</p>
                  </div>
                  <span className="rounded-md bg-warn/15 px-2 py-1 text-[10px] font-bold text-warn">Awaiting verification</span>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-muted">{recovery.evidence}</p>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" className="flex-1" disabled={busy} onClick={() => void verifyRecovery(item.listing.id, item.listing.tokenId, returnTracking, item.source === "transit")}>
                    <PackageCheckIcon /> {item.source === "transit" ? "Verify & return to owner" : "Verify & return to vault"}
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => rejectFoundSlab(item.listing.id)}>Reject</Button>
                </div>
              </div>
            );
          })}
          {!lostSlabs.some((item) => item.recovery?.status === "Submitted") ? (
            <p className="rounded-xl border border-dashed border-hairline py-6 text-center text-[12px] text-dim">No found-slab claims are waiting for verification.</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function PackageCheckIcon() {
  return <Check size={15} />;
}

function shortAddress(address?: string) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "owner";
}
