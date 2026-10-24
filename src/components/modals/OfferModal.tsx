"use client";

import { useRouter } from "next/navigation";
import { ArrowLeftRight } from "lucide-react";
import { marketValueOf } from "@/lib/chain/slabValue";
import { useHandleAddress } from "@/lib/chain/trades";
import { usd } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { Listing } from "@/lib/types";
import { DealBuilder } from "../offers/DealBuilder";
import { Button, Modal } from "../ui/primitives";

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
  const { makeOffer, openChat, user } = useStore();
  const router = useRouter();
  // A slab held by another wallet account is traded for in a chat, with slabs from both vaults.
  const { data: ownerAddress } = useHandleAddress(listing.owner);
  const collectorTrade = Boolean(user?.address && ownerAddress && ownerAddress.toLowerCase() !== user.address.toLowerCase());

  if (collectorTrade) {
    return (
      <Modal open={open} onClose={onClose} title="Trade with this collector">
        <div className="space-y-4 p-5">
          <p className="text-[13px] leading-relaxed text-muted">
            <span className="font-semibold text-white">{listing.owner}</span> is a collector on Pokechain. Offers to them are made in a private
            chat: pick slabs from both vaults, add cash either way, and count each slab at its market value or the value its owner stated. You see
            the balance before you send anything.
          </p>
          <dl className="grid grid-cols-2 gap-2 text-center text-[12px]">
            <Fact label="Asking / stated" value={usd(listing.price, { cents: true })} />
            <Fact label="Market value" value={usd(marketValueOf({ grader: listing.grader, certNumber: listing.certNumber, declaredValueCents: listing.price * 100 }), { cents: true })} />
          </dl>
          <Button
            size="lg"
            className="w-full"
            onClick={() => {
              const id = openChat(listing);
              if (!id) return;
              onClose();
              router.push(`/trades/${id}?trade=1`);
            }}
          >
            <ArrowLeftRight size={16} />
            Open chat and build a trade
          </Button>
        </div>
      </Modal>
    );
  }

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
