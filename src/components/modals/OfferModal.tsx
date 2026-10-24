"use client";

import { useRouter } from "next/navigation";
import { usd } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { Listing } from "@/lib/types";
import { DealBuilder } from "../offers/DealBuilder";
import { Modal } from "../ui/primitives";

/**
 * Make or edit an offer. Sending it opens (or continues) the buyer's one-to-one
 * chat with the seller, where the seller accepts or declines.
 */
export function OfferModal({
  listing,
  open,
  onClose,
  editing = false,
}: {
  listing: Listing;
  open: boolean;
  onClose: () => void;
  /** already in the chat, so stay there instead of navigating */
  editing?: boolean;
}) {
  const { makeOffer } = useStore();
  const router = useRouter();

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Edit your offer" : "Make an offer"}>
      <div className="p-5">
        <p className="mb-4 text-[13px] leading-relaxed text-muted">
          Offer full cash, or trade slabs from your vault with a cash top-up. Your offer goes to{" "}
          <span className="font-semibold text-white">{listing.owner}</span> in a private chat, where
          they can accept or decline it.
          {editing ? " Your new offer replaces the old one." : ""}
        </p>

        <dl className="mb-4 grid grid-cols-2 gap-2 text-center text-[12px]">
          <Fact label="Asking" value={usd(listing.price, { cents: true })} />
          <Fact label="Market value" value={usd(listing.fmv, { cents: true })} />
        </dl>

        <DealBuilder
          listing={listing}
          presets={[
            { label: "Asking", value: listing.price },
            { label: "Market", value: listing.fmv },
          ]}
          submitLabel={(value) => `${editing ? "Send new offer" : "Send offer"} · ${usd(value, { cents: true })}`}
          onSubmit={(bid, available) => {
            const id = makeOffer(listing.id, bid, available);
            if (!id) return false;
            onClose();
            if (!editing) router.push(`/trades/${id}`);
            return true;
          }}
        />
      </div>
    </Modal>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface p-2.5">
      <dt className="text-muted">{label}</dt>
      <dd className="mt-0.5 font-bold">{value}</dd>
    </div>
  );
}
