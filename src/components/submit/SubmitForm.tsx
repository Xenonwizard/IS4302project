"use client";

import Link from "next/link";
import { Check, ShieldCheck, Truck, Wallet } from "lucide-react";
import { useState } from "react";
import { BRAND } from "@/lib/brand";
import { CATEGORIES, GRADERS, GRADE_STEPS } from "@/lib/pools";
import { useStore } from "@/lib/store";
import { Button, Field, inputClass } from "../ui/primitives";

export function SubmitForm() {
  const { user, pushToast } = useStore();
  const [done, setDone] = useState<string | null>(null);
  const [form, setForm] = useState({
    category: CATEGORIES[0] as string,
    grader: GRADERS[0] as string,
    grade: "10",
    cert: "",
    description: "",
    value: "",
    email: user?.email ?? "",
  });

  const set =
    (key: keyof typeof form) =>
    (
      e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
    ) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (form.cert.trim().length < 4) {
      pushToast({ title: "Add the certification number", tone: "error" });
      return;
    }
    setDone(`SUB-${Math.random().toString(36).slice(2, 8).toUpperCase()}`);
  };

  if (done) {
    return (
      <div className="mx-auto max-w-lg py-10 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-good-bg text-good">
          <Check size={28} />
        </span>
        <h1 className="mt-4 text-[24px] font-bold">Submission received</h1>
        <p className="mt-2 text-sm text-muted">
          Reference <span className="font-mono font-bold text-white">{done}</span>. We emailed a
          prepaid, insured shipping label to {form.email || "your inbox"}.
        </p>
        <ol className="mt-8 space-y-4 text-left">
          {[
            {
              icon: <Truck size={17} />,
              title: "Ship it in",
              body: "Drop the slab at any courier point using the label we sent.",
            },
            {
              icon: <ShieldCheck size={17} />,
              title: "We verify and vault it",
              body: `Cert number is checked against the ${form.grader} registry, then the slab enters the ${BRAND.vaultCity} vault.`,
            },
            {
              icon: <Wallet size={17} />,
              title: "Mint and list",
              body: `An ERC-721 token is minted to your wallet on ${BRAND.chain}. List it whenever you like.`,
            },
          ].map((s) => (
            <li
              key={s.title}
              className="flex gap-3.5 rounded-card border border-hairline bg-surface p-4"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent/15 text-accent">
                {s.icon}
              </span>
              <div>
                <p className="text-[13px] font-bold">{s.title}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-muted">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-6 flex justify-center gap-2">
          <Button variant="secondary" onClick={() => setDone(null)}>
            Submit another
          </Button>
          <Link href="/vault">
            <Button>Go to my vault</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-[24px] font-bold">Submit my collectibles</h1>
      <p className="mt-1.5 text-[14px] text-muted">
        Send us a graded slab and we will vault, insure and tokenise it for free. You keep the
        right to ship it back to yourself at any time.
      </p>

      <form onSubmit={submit} className="mt-6 space-y-4">
        <Field label="Category">
          <select className={inputClass} value={form.category} onChange={set("category")}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Grader">
            <select className={inputClass} value={form.grader} onChange={set("grader")}>
              {GRADERS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Grade">
            <select className={inputClass} value={form.grade} onChange={set("grade")}>
              {[...GRADE_STEPS].reverse().map((g) => (
                <option key={g} value={String(g)}>
                  {g}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Certification number" hint="Printed on the grading label.">
          <input
            className={inputClass}
            value={form.cert}
            onChange={set("cert")}
            placeholder="605965812"
            inputMode="numeric"
          />
        </Field>

        <Field label="What is it?">
          <textarea
            className={`${inputClass} h-24 resize-none py-2.5`}
            value={form.description}
            onChange={set("description")}
            placeholder="1999 Base Set Charizard, shadowless, holo"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Your estimated value">
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted">
                $
              </span>
              <input
                className={`${inputClass} pl-7`}
                value={form.value}
                onChange={set("value")}
                inputMode="decimal"
                placeholder="1200"
              />
            </div>
          </Field>
          <Field label="Email">
            <input
              className={inputClass}
              value={form.email}
              onChange={set("email")}
              placeholder="you@example.com"
              type="email"
            />
          </Field>
        </div>

        <Button type="submit" size="lg" className="w-full">
          Request a shipping label
        </Button>
        <p className="text-center text-[11px] leading-relaxed text-dim">
          Demo form — nothing is submitted anywhere and no shipping label is actually created.
        </p>
      </form>
    </div>
  );
}
