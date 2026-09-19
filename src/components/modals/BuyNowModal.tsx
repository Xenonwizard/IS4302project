"use client";

import Link from "next/link";
import { Check, CreditCard, Loader2, Wallet } from "lucide-react";
import { useState } from "react";
import { BRAND } from "@/lib/brand";
import { truncMiddle, usd } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { Listing, Order } from "@/lib/types";
import { Slab } from "../slab/Slab";
import { Button, Modal } from "../ui/primitives";

export function BuyNowModal({
  listing,
  open,
  onClose,
}: {
  listing: Listing;
  open: boolean;
  onClose: () => void;
}) {
  const { buyNow, user, topUp } = useStore();
  const [method, setMethod] = useState<"card" | "usdc">("card");
  const [stage, setStage] = useState<"review" | "processing" | "done">("review");
  const [order, setOrder] = useState<Order | null>(null);

  const fee = Math.round(listing.price * 0.02 * 100) / 100;
  const total = Math.round((listing.price + fee) * 100) / 100;
  const shortBalance = (user?.balance ?? 0) < total;

  const confirm = () => {
    setStage("processing");
    window.setTimeout(() => {
      const result = buyNow(listing.id, method);
      setOrder(result);
      setStage("done");
    }, 1500);
  };

  const close = () => {
    onClose();
    window.setTimeout(() => {
      setStage("review");
      setOrder(null);
    }, 250);
  };

  return (
    <Modal open={open} onClose={close} title={stage === "done" ? "Purchase complete" : "Buy now"}>
      {stage === "review" ? (
        <div className="p-5">
          <div className="flex gap-4">
            <div className="w-20 shrink-0">
              <Slab listing={listing} flat />
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold leading-snug">{listing.title}</p>
              <p className="mt-1.5 text-[12px] text-muted">
                Cert {listing.certNumber} · FMV {usd(listing.fmv)}
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-2.5 rounded-2xl bg-surface p-4">
            <Row label="Item price" value={usd(listing.price)} />
            <Row label="Marketplace fee (2%)" value={usd(fee)} />
            <div className="h-px bg-hairline" />
            <Row label="Total" value={usd(total)} strong />
          </div>

          <p className="mt-5 mb-2 text-[12px] font-bold uppercase tracking-wide text-muted">
            Payment method
          </p>
          <div className="space-y-2">
            <MethodRow
              active={method === "card"}
              onClick={() => setMethod("card")}
              icon={<CreditCard size={17} />}
              title="Vault balance / card"
              subtitle={user ? `Balance ${usd(user.balance)}` : "Card on file"}
            />
            <MethodRow
              active={method === "usdc"}
              onClick={() => setMethod("usdc")}
              icon={<Wallet size={17} />}
              title={`USDC on ${BRAND.chain}`}
              subtitle="Settles in one transaction, gas covered"
            />
          </div>

          {method === "card" && shortBalance ? (
            <div className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-warn/10 p-3.5">
              <p className="text-[12px] text-warn">
                Balance is short by {usd(total - (user?.balance ?? 0))}.
              </p>
              <Button size="sm" variant="secondary" onClick={() => topUp(5000)}>
                Add $5,000
              </Button>
            </div>
          ) : null}

          <Button
            size="lg"
            className="mt-5 w-full"
            onClick={confirm}
            disabled={method === "card" && shortBalance}
          >
            Confirm purchase · {usd(total)}
          </Button>
          <p className="mt-3 text-center text-[11px] leading-relaxed text-dim">
            The slab stays in the {BRAND.vaultCity} vault and the ERC-721 token transfers to your
            wallet. Request shipping any time from your vault.
          </p>
        </div>
      ) : null}

      {stage === "processing" ? (
        <div className="flex flex-col items-center gap-4 p-10 text-center">
          <Loader2 size={34} className="animate-spin text-accent" />
          <p className="text-sm font-semibold">Submitting transaction…</p>
          <p className="text-[12px] text-muted">Writing the transfer to {BRAND.chain}.</p>
        </div>
      ) : null}

      {stage === "done" && order ? (
        <div className="p-5">
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-good-bg text-good">
              <Check size={24} />
            </span>
            <p className="text-base font-bold">It&apos;s yours</p>
            <p className="max-w-xs text-[13px] text-muted">
              {listing.shortName} is now in your vault, insured at full market value.
            </p>
          </div>
          <div className="space-y-2.5 rounded-2xl bg-surface p-4">
            <Row label="Order" value={order.id} />
            <Row label="Paid" value={usd(order.total)} />
            <Row label="Transaction" value={truncMiddle(order.txHash, 10, 6)} />
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={close}>
              Keep browsing
            </Button>
            <Link href="/vault" onClick={close}>
              <Button className="w-full">View in vault</Button>
            </Link>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

function MethodRow({
  active,
  onClick,
  icon,
  title,
  subtitle,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-xl border p-3.5 text-left transition ${
        active ? "border-accent bg-accent/10" : "border-hairline bg-surface hover:bg-surface-2"
      }`}
    >
      <span className={active ? "text-accent" : "text-muted"}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold">{title}</span>
        <span className="block text-[12px] text-muted">{subtitle}</span>
      </span>
      <span
        className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border ${
          active ? "border-accent" : "border-white/25"
        }`}
      >
        {active ? <span className="h-2 w-2 rounded-full bg-accent" /> : null}
      </span>
    </button>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[13px]">
      <span className="text-muted">{label}</span>
      <span className={strong ? "text-base font-bold" : "font-semibold"}>{value}</span>
    </div>
  );
}
