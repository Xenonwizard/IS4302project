"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { BadgeCheck, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { BRAND } from "@/lib/brand";
import { certPreview } from "@/lib/catalog";
import { GRADERS } from "@/lib/pools";
import { useStore } from "@/lib/store";
import type { Grader } from "@/lib/types";
import { Button, Field, inputClass } from "../ui/primitives";
import { SlabIntakeForm } from "./SlabIntakeForm";

export function SubmitForm() {
  const router = useRouter();
  const { user, requireAuth, submitSlab, pushToast } = useStore();
  const [form, setForm] = useState({ grader: "PSA" as Grader, cert: "" });
  const preview = certPreview(form.grader, form.cert);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!preview) {
      pushToast({ title: "Enter the 6 to 10 digit cert number", tone: "error" });
      return;
    }
    // Signing in re-renders the form, so the user sends again rather than replaying a stale callback.
    if (!requireAuth()) return;
    const listing = submitSlab({ grader: form.grader, certNumber: form.cert.trim() });
    if (listing) router.push("/submissions");
  };

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-[24px] font-bold">Add a slab</h1>
      <p className="mt-1.5 text-[14px] text-muted">
        Create one request for each graded slab. After you submit, you will return to Status Center where you can track it
        and immediately add another. Wallet requests keep their status and evidence fingerprint on {BRAND.chain}.
      </p>

      {user?.address ? (
        <SlabIntakeForm />
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div className="grid grid-cols-[140px_1fr] gap-3">
            <Field label="Grader">
              <select
                className={inputClass}
                value={form.grader}
                onChange={(event) => setForm((previous) => ({ ...previous, grader: event.target.value as Grader }))}
              >
                {GRADERS.map((grader) => <option key={grader} value={grader}>{grader}</option>)}
              </select>
            </Field>
            <Field label="Certification number" hint="Printed on the grading label.">
              <input
                className={inputClass}
                value={form.cert}
                onChange={(event) => setForm((previous) => ({ ...previous, cert: event.target.value.replace(/\D/g, "").slice(0, 10) }))}
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
            {user ? "Add slab" : "Log in and add slab"}
          </Button>
          <p className="text-center text-[11px] leading-relaxed text-dim">
            Demo accounts vault immediately. Open an on-chain account to submit photos, shipping details and a tracked custody request.
          </p>
        </form>
      )}
    </div>
  );
}
