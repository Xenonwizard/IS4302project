"use client";

import Link from "next/link";
import { ArrowLeftRight } from "lucide-react";
import { useState } from "react";
import { getListing } from "@/lib/catalog";
import { usd } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { Listing } from "@/lib/types";
import { Slab } from "../slab/Slab";
import { Button, Modal, inputClass } from "../ui/primitives";

export function TradeModal({
  listing,
  open,
  onClose,
}: {
  listing: Listing;
  open: boolean;
  onClose: () => void;
}) {
  const { vault, pushToast } = useStore();
  const [picked, setPicked] = useState<string[]>([]);
  const [cash, setCash] = useState("0");

  const mine = vault
    .map((v) => getListing(v.listingId))
    .filter((l): l is Listing => Boolean(l));

  const offered = picked
    .map((id) => getListing(id))
    .filter((l): l is Listing => Boolean(l));
  const offeredValue = offered.reduce((sum, l) => sum + l.fmv, 0) + (Number(cash) || 0);
  const gap = Math.round((listing.fmv - offeredValue) * 100) / 100;

  return (
    <Modal open={open} onClose={onClose} title="Propose a trade" width="max-w-lg">
      <div className="p-5">
        <div className="flex items-center gap-4 rounded-2xl bg-surface p-4">
          <div className="w-16 shrink-0">
            <Slab listing={listing} flat />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold leading-snug">{listing.title}</p>
            <p className="mt-1 text-[12px] text-muted">
              Market value {usd(listing.fmv)} · owned by {listing.owner}
            </p>
          </div>
        </div>

        <div className="my-4 flex items-center justify-center gap-2 text-muted">
          <ArrowLeftRight size={16} />
          <span className="text-[12px] font-bold uppercase tracking-wide">You offer</span>
        </div>

        {mine.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-hairline p-6 text-center">
            <p className="text-[13px] text-muted">
              Your vault is empty, so there is nothing to trade yet.
            </p>
            <Link href="/packs" onClick={onClose}>
              <Button variant="secondary" size="sm" className="mt-3">
                Open a pack
              </Button>
            </Link>
          </div>
        ) : (
          <div className="cy-scroll grid max-h-64 grid-cols-3 gap-2 overflow-y-auto pr-1">
            {mine.map((l) => {
              const on = picked.includes(l.id);
              return (
                <button
                  key={l.id}
                  onClick={() =>
                    setPicked((prev) =>
                      prev.includes(l.id) ? prev.filter((x) => x !== l.id) : [...prev, l.id],
                    )
                  }
                  className={`rounded-xl border p-2 text-left transition ${
                    on ? "border-accent bg-accent/10" : "border-hairline bg-surface hover:bg-surface-2"
                  }`}
                >
                  <Slab listing={l} flat />
                  <p className="mt-1.5 truncate text-[11px] font-semibold">{l.shortName}</p>
                  <p className="text-[11px] text-muted">{usd(l.fmv)}</p>
                </button>
              );
            })}
          </div>
        )}

        <div className="mt-4">
          <p className="mb-2 text-[12px] font-bold uppercase tracking-wide text-muted">
            Cash adjustment
          </p>
          <div className="relative">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
            <input
              className={`${inputClass} pl-7`}
              inputMode="decimal"
              value={cash}
              onChange={(e) => setCash(e.target.value.replace(/[^\d.]/g, ""))}
            />
          </div>
        </div>

        <div className="mt-5 space-y-2.5 rounded-2xl bg-surface p-4 text-[13px]">
          <div className="flex justify-between">
            <span className="text-muted">You offer</span>
            <span className="font-semibold">{usd(offeredValue)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">They give up</span>
            <span className="font-semibold">{usd(listing.fmv)}</span>
          </div>
          <div className="h-px bg-hairline" />
          <div className="flex justify-between">
            <span className="text-muted">Gap</span>
            <span className={`font-semibold ${gap <= 0 ? "text-good" : "text-warn"}`}>
              {gap <= 0 ? `${usd(-gap)} in their favour` : `${usd(gap)} short`}
            </span>
          </div>
        </div>

        <Button
          size="lg"
          className="mt-5 w-full"
          disabled={!offered.length && Number(cash) <= 0}
          onClick={() => {
            pushToast({
              title: "Trade proposed",
              body: `${offered.length} slab${offered.length === 1 ? "" : "s"} plus ${usd(Number(cash) || 0)} sent to ${listing.owner}.`,
              tone: "success",
            });
            onClose();
          }}
        >
          Send trade proposal
        </Button>
      </div>
    </Modal>
  );
}
