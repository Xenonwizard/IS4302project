"use client";

import Link from "next/link";
import { Check, ExternalLink } from "lucide-react";
import { BRAND } from "@/lib/brand";
import { getListing } from "@/lib/catalog";
import { shortDate, truncMiddle, usd } from "@/lib/format";
import { useStore } from "@/lib/store";
import { Slab } from "../slab/Slab";
import { Button } from "../ui/primitives";

export function SuccessView() {
  const { orders, ready } = useStore();
  const order = orders[0];

  if (!ready) {
    return <div className="p-6 text-sm text-muted">Loading order…</div>;
  }

  if (!order) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-xl font-bold">No recent order</h1>
        <Link href="/marketplace">
          <Button>Browse the marketplace</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 lg:px-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-good-bg text-good">
          <Check size={28} />
        </span>
        <h1 className="text-[24px] font-bold">Order confirmed</h1>
        <p className="max-w-md text-sm text-muted">
          {order.listingIds.length} slab{order.listingIds.length === 1 ? "" : "s"} transferred to
          your wallet and vaulted in {BRAND.vaultCity}.
        </p>
      </div>

      <div className="mt-8 overflow-hidden rounded-card border border-hairline bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-4 py-3">
          <div>
            <p className="text-[13px] font-bold">{order.id}</p>
            <p className="text-[12px] text-muted">{shortDate(order.createdAt)}</p>
          </div>
          <p className="text-base font-bold">{usd(order.total)}</p>
        </div>

        <ul className="divide-y divide-[rgba(255,255,255,0.08)]">
          {order.listingIds.map((id) => {
            const listing = getListing(id);
            if (!listing) return null;
            return (
              <li key={id} className="flex items-center gap-4 p-4">
                <Link href={`/asset/${id}`} className="w-14 shrink-0">
                  <Slab listing={listing} flat />
                </Link>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/asset/${id}`}
                    className="line-clamp-2 text-[13px] font-semibold leading-snug hover:underline"
                  >
                    {listing.title}
                  </Link>
                  <p className="mt-1 text-[12px] text-muted">Cert {listing.certNumber}</p>
                </div>
                <p className="shrink-0 text-sm font-bold">{usd(listing.price)}</p>
              </li>
            );
          })}
        </ul>

        <div className="space-y-2.5 border-t border-hairline p-4 text-[13px]">
          <div className="flex justify-between">
            <span className="text-muted">Subtotal</span>
            <span className="font-semibold">{usd(order.subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Fee</span>
            <span className="font-semibold">{usd(order.fee)}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted">Transaction</span>
            <span className="flex items-center gap-1.5 font-mono text-[12px]">
              {truncMiddle(order.txHash, 12, 8)}
              <ExternalLink size={12} className="text-dim" />
            </span>
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-2 sm:grid-cols-2">
        <Link href="/marketplace">
          <Button variant="secondary" className="w-full">
            Keep browsing
          </Button>
        </Link>
        <Link href="/vault">
          <Button className="w-full">Go to my vault</Button>
        </Link>
      </div>
    </div>
  );
}
