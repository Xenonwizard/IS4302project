"use client";

import clsx from "clsx";
import Image from "next/image";
import Link from "next/link";
import { Archive, BadgeCheck, Check, ShieldCheck, Tag } from "lucide-react";
import { useState } from "react";
import { BRAND } from "@/lib/brand";
import { certPreview } from "@/lib/catalog";
import { GRADERS } from "@/lib/pools";
import { useStore } from "@/lib/store";
import type { Grader, Listing } from "@/lib/types";
import { PendingSubmissions } from "../chain/PendingSubmissions";
import { Slab } from "../slab/Slab";
import { Button, Field, inputClass } from "../ui/primitives";
import { ListForSaleForm } from "../vault/ListForSaleForm";
import { SlabIntakeForm } from "./SlabIntakeForm";

export function SubmitForm() {
  const { user, requireAuth, submitSlab, pushToast, vault } = useStore();
  const [vaulted, setVaulted] = useState<Listing | null>(null);
  const [choice, setChoice] = useState<"sell" | "keep" | "listed" | null>(null);
  const [form, setForm] = useState({ grader: "PSA" as Grader, cert: "" });
  const preview = certPreview(form.grader, form.cert);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!preview) {
      pushToast({ title: "Enter the 6 to 10 digit cert number", tone: "error" });
      return;
    }
    // Signing in re-renders the form, so the user sends again rather than replaying a stale callback.
    if (!requireAuth()) return;
    const listing = submitSlab({ grader: form.grader, certNumber: form.cert.trim() });
    if (listing) {
      setVaulted(listing);
      setChoice(null);
    }
  };

  const reset = () => {
    setVaulted(null);
    setChoice(null);
    setForm((prev) => ({ ...prev, cert: "" }));
  };

  if (vaulted) {
    return (
      <div className="mx-auto max-w-lg py-4">
        <div className="text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-good-bg text-good">
            <Check size={28} />
          </span>
          <h1 className="mt-4 text-[24px] font-bold">
            {choice === "listed" ? "Listed on the marketplace" : "It's in your vault"}
          </h1>
          <p className="mt-2 text-sm text-muted">
            {vaulted.grader} cert <span className="font-mono font-bold text-white">{vaulted.certNumber}</span>{" "}
            checked out. Collector Crypt holds the slab, and its token was minted to your wallet on{" "}
            {BRAND.chain}
            {vault.find((v) => v.listingId === vaulted.id)?.token
              ? ` as token #${vault.find((v) => v.listingId === vaulted.id)!.token!.tokenId}`
              : ""}
            .
          </p>
        </div>

        <div className="mt-6 flex gap-4 rounded-card border border-hairline bg-surface p-4">
          <div className="w-20 shrink-0">
            <Slab listing={vaulted} flat />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold leading-snug">{vaulted.title}</p>
            <p className="mt-1.5 text-[12px] text-muted">
              {vaulted.grader} {vaulted.grade} · Ready to list or trade
            </p>
          </div>
        </div>

        {choice === null ? (
          <>
            <p className="mt-6 text-[13px] font-bold">What would you like to do with it?</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <ChoiceCard
                icon={<Tag size={17} />}
                title="Put it up for sale"
                body="Set an asking price. It goes on the marketplace and its negotiation room opens."
                onClick={() => setChoice("sell")}
              />
              <ChoiceCard
                icon={<Archive size={17} />}
                title="Keep it"
                body="Hold it in the vault, insured. You can list it or ship it home any time."
                onClick={() => setChoice("keep")}
              />
            </div>
          </>
        ) : null}

        {choice === "sell" ? (
          <div className="mt-6 rounded-card border border-hairline bg-surface p-4">
            <ListForSaleForm listing={vaulted} onListed={() => setChoice("listed")} />
            <button
              onClick={() => setChoice(null)}
              className="mt-3 w-full text-center text-[12px] font-semibold text-muted hover:text-white"
            >
              Back
            </button>
          </div>
        ) : null}

        {choice === "keep" || choice === "listed" ? (
          <div className="mt-6 flex justify-center gap-2">
            <Button variant="secondary" onClick={reset}>
              Vault another
            </Button>
            <Link href={choice === "listed" ? `/trades?listing=${vaulted.id}` : "/vault"}>
              <Button>{choice === "listed" ? "See its negotiation rooms" : "Go to Vault"}</Button>
            </Link>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-[24px] font-bold">Vault a graded slab</h1>
      <p className="mt-1.5 text-[14px] text-muted">
        Tell us the grader and the cert number on the label, then ship the slab to Pokechain. We forward it
        to Collector Crypt&apos;s vault, where it is recorded as a Solana NFT held by Pokechain&apos;s escrow. Once
        we&apos;ve verified that NFT, your
        Pokechain token is minted on {BRAND.chain} and the slab shows up in your Vault.
      </p>

      {user?.address ? (
        <div className="mt-5">
          <PendingSubmissions
            onMinted={(listing) => {
              if (listing) {
                setVaulted(listing);
                setChoice(null);
              }
            }}
          />
        </div>
      ) : null}

      {user?.address ? (
        <SlabIntakeForm />
      ) : (
      <form onSubmit={submit} className="mt-6 space-y-4">
        <div className="grid grid-cols-[140px_1fr] gap-3">
          <Field label="Grader">
            <select
              className={inputClass}
              value={form.grader}
              onChange={(e) => setForm((prev) => ({ ...prev, grader: e.target.value as Grader }))}
            >
              {GRADERS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Certification number" hint="Printed on the grading label.">
            <input
              className={inputClass}
              value={form.cert}
              onChange={(e) => setForm((prev) => ({ ...prev, cert: e.target.value.replace(/\D/g, "").slice(0, 10) }))}
              placeholder="72862688"
              inputMode="numeric"
              autoFocus
            />
          </Field>
        </div>

        {preview ? (
          <div className="flex items-center gap-3 rounded-card border border-good/30 bg-good-bg/40 p-3">
            <span className="relative block aspect-[63/88] w-12 shrink-0 overflow-hidden rounded">
              <Image src={preview.thumb} alt="" fill sizes="48px" className="object-cover" />
            </span>
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-good">
                <BadgeCheck size={13} /> Found in the {form.grader} registry
              </p>
              <p className="mt-1 text-[13px] font-semibold leading-snug">{preview.title}</p>
            </div>
          </div>
        ) : form.cert ? (
          <p className="text-[12px] text-dim">Keep typing: cert numbers are 6 to 10 digits.</p>
        ) : null}

        <Button type="submit" size="lg" className="w-full" disabled={!preview}>
          <ShieldCheck size={17} />
          {user ? "Send to the vault" : "Log in and send to the vault"}
        </Button>
        <p className="text-center text-[11px] leading-relaxed text-dim">
          Off-chain demo account: the slab is vaulted the moment you submit. Open an on-chain account to mint a real token.
        </p>
      </form>
      )}
    </div>
  );
}

function ChoiceCard({
  icon,
  title,
  body,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "flex flex-col gap-2 rounded-card border border-hairline bg-surface p-4 text-left transition",
        "hover:border-accent/60 hover:bg-accent/5",
      )}
    >
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent/15 text-accent">{icon}</span>
      <span className="text-[13px] font-bold">{title}</span>
      <span className="text-[12px] leading-relaxed text-muted">{body}</span>
    </button>
  );
}
