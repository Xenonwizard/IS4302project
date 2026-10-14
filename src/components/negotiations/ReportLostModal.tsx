"use client";

import clsx from "clsx";
import { Check } from "lucide-react";
import { useState } from "react";
import { getListing } from "@/lib/catalog";
import { useStore } from "@/lib/store";
import type { LostItem, LostReport, Negotiation } from "@/lib/types";
import { Button, Field, Modal, inputClass } from "../ui/primitives";

const ITEMS: { value: LostItem; label: string; hint: string }[] = [
  {
    value: "slab-received",
    label: "A slab I should have received",
    hint: "The deal went through but the slab never showed up in your vault, or never arrived after shipping.",
  },
  {
    value: "slab-sent",
    label: "A slab I sent",
    hint: "A slab you put into an offer left your vault but the deal did not complete.",
  },
  {
    value: "payment",
    label: "A payment",
    hint: "Cash from the deal was taken or promised but never reached the other side.",
  },
];

export function reportItemLabel(item: LostItem): string {
  return ITEMS.find((i) => i.value === item)?.label ?? item;
}

export function ReportLostModal({
  negotiation,
  open,
  onClose,
}: {
  negotiation: Negotiation;
  open: boolean;
  onClose: () => void;
}) {
  const { fileLostReport } = useStore();
  const [item, setItem] = useState<LostItem>("slab-received");
  const [tracking, setTracking] = useState("");
  const [details, setDetails] = useState("");
  const [error, setError] = useState("");
  const [filed, setFiled] = useState<LostReport | null>(null);
  const listing = getListing(negotiation.listingId);

  const close = () => {
    onClose();
    setFiled(null);
    setTracking("");
    setDetails("");
    setError("");
  };

  return (
    <Modal open={open} onClose={close} title="Report a lost item" width="max-w-lg">
      {filed ? (
        <div className="p-6 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-good-bg text-good">
            <Check size={24} />
          </span>
          <p className="mt-3 text-base font-bold">Report {filed.id} filed</p>
          <p className="mt-2 text-[13px] leading-relaxed text-muted">
            The vault team will compare the on-chain transfer with the custody log for this deal
            and email you within 48 hours. The report also shows in this chat.
          </p>
          <Button className="mt-5" onClick={close}>
            Back to the chat
          </Button>
        </div>
      ) : (
        <form
          className="space-y-4 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (details.trim().length < 10) {
              setError("Tell us a bit more so the vault team can trace it (10+ characters).");
              return;
            }
            setFiled(fileLostReport(negotiation.id, item, tracking.trim(), details.trim()));
          }}
        >
          <p className="text-[13px] leading-relaxed text-muted">
            Deal for{" "}
            <span className="font-semibold text-white">{listing?.title ?? negotiation.listingId}</span>
          </p>

          <div>
            <p className="mb-2 text-[12px] font-bold uppercase tracking-wide text-muted">What is missing?</p>
            <div className="space-y-2">
              {ITEMS.map((i) => (
                <label
                  key={i.value}
                  className={clsx(
                    "flex cursor-pointer gap-3 rounded-xl border p-3 transition",
                    item === i.value ? "border-accent bg-accent/10" : "border-hairline hover:bg-white/5",
                  )}
                >
                  <input
                    type="radio"
                    name="lost-item"
                    className="mt-0.5 accent-[#2f5bf9]"
                    checked={item === i.value}
                    onChange={() => setItem(i.value)}
                  />
                  <span>
                    <span className="block text-[13px] font-semibold">{i.label}</span>
                    <span className="mt-0.5 block text-[12px] text-muted">{i.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <Field label="Tracking number or transaction hash" hint="Optional, but it speeds things up.">
            <input
              className={inputClass}
              value={tracking}
              onChange={(e) => setTracking(e.target.value)}
              placeholder="0x… or courier tracking number"
            />
          </Field>

          <Field label="What happened?">
            <textarea
              className={`${inputClass} h-28 resize-none py-2.5`}
              value={details}
              onChange={(e) => {
                setDetails(e.target.value);
                setError("");
              }}
              placeholder="The deal went through yesterday but the slab is not in my vault…"
            />
          </Field>

          {error ? <p className="text-[13px] font-medium text-bad">{error}</p> : null}

          <Button type="submit" size="lg" variant="danger" className="w-full">
            File lost item report
          </Button>
          <p className="text-center text-[11px] text-dim">
            Demo build: the report is stored in your browser only.
          </p>
        </form>
      )}
    </Modal>
  );
}
