"use client";

import clsx from "clsx";
import Image from "next/image";
import { BadgeCheck, Camera, Dices, ImagePlus, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { keccak256 } from "viem";
import { usePublicClient } from "wagmi";
import { certPreview } from "@/lib/catalog";
import { contracts, shortHash } from "@/lib/chain/config";
import { useSlabChain } from "@/lib/chain/useSlabChain";
import { GRADERS } from "@/lib/pools";
import { useStore } from "@/lib/store";
import type { Grader } from "@/lib/types";
import { Button, Field, inputClass } from "../ui/primitives";

type Slot = "front" | "back" | "label" | "extra";

const PHOTO_SLOTS: { slot: Slot; title: string; hint: string; required: boolean }[] = [
  { slot: "front", title: "Front of slab", hint: "Whole slab, straight on, no glare", required: true },
  { slot: "back", title: "Back of slab", hint: "Whole slab, straight on", required: true },
  { slot: "label", title: "Grading label", hint: "Close-up: cert number readable", required: true },
  { slot: "extra", title: "Anything else", hint: "Edges, corners, a crack in the case", required: false },
];

const CARRIERS = ["SingPost", "DHL Express", "FedEx", "UPS", "Ninja Van"];
const POKECHAIN_INTAKE = "Pokechain Intake, 13 Computing Drive, Singapore 117417";

interface Photo {
  file: File;
  url: string;
  hash: `0x${string}`;
}

/**
 * The intake form for a wallet account: everything Pokechain and Collector Crypt need to accept a
 * slab, and exactly what of it goes on-chain. Photos and declarations are stored off-chain and
 * fingerprinted; SlabVault.requestSubmission records the fingerprint (evidenceHash) and the
 * inbound tracking number.
 */
export function SlabIntakeForm() {
  const { user, pushToast } = useStore();
  const { uploadEvidence, submit } = useSlabChain();
  const client = usePublicClient();
  const [grader, setGrader] = useState<Grader>("PSA");
  const [cert, setCert] = useState("");
  const [photos, setPhotos] = useState<Partial<Record<Slot, Photo>>>({});
  const [condition, setCondition] = useState({ caseCracked: false, caseScratched: false, labelDamaged: false, notes: "" });
  const [method, setMethod] = useState<"courier" | "dropoff">("courier");
  const [carrier, setCarrier] = useState(CARRIERS[0]);
  const [tracking, setTracking] = useState("");
  const [declared, setDeclared] = useState({ owner: false, authentic: false, terms: false });
  const [stage, setStage] = useState<"idle" | "uploading" | "signing">("idle");

  const preview = certPreview(grader, cert);

  // Revoke preview URLs when photos change or the form unmounts.
  useEffect(() => () => Object.values(photos).forEach((p) => p && URL.revokeObjectURL(p.url)), [photos]);

  const setPhoto = async (slot: Slot, file: File | null) => {
    if (!file) {
      setPhotos((prev) => ({ ...prev, [slot]: undefined }));
      return;
    }
    if (!file.type.startsWith("image/") || file.size > 8 * 1024 * 1024) {
      pushToast({ title: "Photos must be images under 8 MB", tone: "error" });
      return;
    }
    const hash = keccak256(new Uint8Array(await file.arrayBuffer()));
    setPhotos((prev) => ({ ...prev, [slot]: { file, url: URL.createObjectURL(file), hash } }));
  };

  const fillSamples = async () => {
    for (const { slot, title } of PHOTO_SLOTS.filter((s) => s.required)) {
      await setPhoto(slot, await samplePhoto(`${title} · ${grader} ${cert || "cert"}`, slot));
    }
  };

  /**
   * Demo helper: a random 8-digit cert that SlabVault hasn't seen, so the flow can be run again and
   * again (each physical cert has one live token: tokenOfCert).
   */
  const randomCert = async () => {
    for (let i = 0; i < 20; i++) {
      const candidate = String(10_000_000 + Math.floor(Math.random() * 90_000_000));
      const key = await client!.readContract({ ...contracts.slabVault, functionName: "certKey", args: [grader, candidate] });
      const token = await client!.readContract({ ...contracts.slabVault, functionName: "tokenOfCert", args: [key] });
      if (token === BigInt(0)) {
        setCert(candidate);
        return;
      }
    }
    pushToast({ title: "Couldn't find an unused cert, try again", tone: "error" });
  };

  const missing = [
    !preview && "a cert number the grader recognises",
    ...PHOTO_SLOTS.filter((s) => s.required && !photos[s.slot]).map((s) => `a photo: ${s.title.toLowerCase()}`),
    method === "courier" && !tracking.trim() && "the courier tracking number",
    !(declared.owner && declared.authentic && declared.terms) && "all three declarations",
  ].filter(Boolean) as string[];

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (missing.length || !user?.address) return;
    try {
      setStage("uploading");
      const form = new FormData();
      form.set(
        "meta",
        JSON.stringify({
          grader,
          certNumber: cert.trim(),
          condition,
          shipping: { method, carrier: method === "courier" ? carrier : "", tracking: method === "courier" ? tracking.trim() : "" },
          declarations: declared,
          submittedBy: user.address,
          source: "new",
        }),
      );
      for (const [slot, p] of Object.entries(photos)) if (p) form.set(slot, p.file);
      const evidenceHash = await uploadEvidence(form);

      setStage("signing");
      await submit({
        grader,
        certNumber: cert.trim(),
        evidenceHash,
        inboundCarrier: method === "courier" ? carrier : "Drop-off",
        inboundTracking: method === "courier" ? tracking.trim() : "",
      });
      pushToast({ title: "Submitted", body: "Ship the slab to Pokechain. Its tracker is above the form.", tone: "success" });
      setCert("");
      setPhotos({});
      setTracking("");
      setCondition({ caseCracked: false, caseScratched: false, labelDamaged: false, notes: "" });
      setDeclared({ owner: false, authentic: false, terms: false });
    } catch (err) {
      pushToast({ title: "Submission failed", body: (err as Error).message, tone: "error" });
    } finally {
      setStage("idle");
    }
  };

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-6">
      {/* 1. the slab */}
      <Section
        n={1}
        title="The slab"
        aside={
          <button type="button" onClick={() => void randomCert()} className="flex items-center gap-1 text-[12px] font-semibold text-accent hover:underline">
            <Dices size={13} /> Random unused cert (demo)
          </button>
        }
      >
        <div className="grid grid-cols-[140px_1fr] gap-3">
          <Field label="Grader">
            <select className={inputClass} value={grader} onChange={(e) => setGrader(e.target.value as Grader)}>
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
              value={cert}
              onChange={(e) => setCert(e.target.value.replace(/\D/g, "").slice(0, 10))}
              placeholder="72862688"
              inputMode="numeric"
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
                <BadgeCheck size={13} /> Found in the {grader} registry
              </p>
              <p className="mt-1 text-[13px] font-semibold leading-snug">{preview.title}</p>
            </div>
          </div>
        ) : cert ? (
          <p className="text-[12px] text-dim">Keep typing: cert numbers are 6 to 10 digits.</p>
        ) : null}
      </Section>

      {/* 2. photos */}
      <Section
        n={2}
        title="Photos"
        aside={
          <button type="button" onClick={() => void fillSamples()} className="text-[12px] font-semibold text-accent hover:underline">
            Use sample photos (demo)
          </button>
        }
      >
        <p className="-mt-1 text-[12.5px] text-muted">
          Pokechain and Collector Crypt compare these with the slab when it arrives. Each photo is hashed, and only the hashes
          are fingerprinted on-chain.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {PHOTO_SLOTS.map((s) => (
            <PhotoTile key={s.slot} {...s} photo={photos[s.slot]} onPick={(f) => void setPhoto(s.slot, f)} />
          ))}
        </div>
      </Section>

      {/* 3. condition */}
      <Section n={3} title="Condition">
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-[13px]">
          {(
            [
              ["caseCracked", "Case is cracked"],
              ["caseScratched", "Case is scratched"],
              ["labelDamaged", "Label is damaged"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2">
              <input
                type="checkbox"
                className="accent-[#2f5bf9]"
                checked={condition[key]}
                onChange={(e) => setCondition((c) => ({ ...c, [key]: e.target.checked }))}
              />
              {label}
            </label>
          ))}
        </div>
        <Field label="Condition notes (optional)">
          <textarea
            className={clsx(inputClass, "h-20 py-2.5")}
            value={condition.notes}
            onChange={(e) => setCondition((c) => ({ ...c, notes: e.target.value }))}
            placeholder="e.g. light scuff on the top-left of the case"
          />
        </Field>
      </Section>

      {/* 4. shipping */}
      <Section n={4} title="Getting it to Pokechain">
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ["courier", "Ship it by courier", "Insured, tracked parcel to Pokechain"],
              ["dropoff", "Drop it off", "At the Pokechain intake desk"],
            ] as const
          ).map(([m, title, body]) => (
            <label
              key={m}
              className={clsx(
                "flex cursor-pointer gap-3 rounded-xl border p-3 text-[13px]",
                method === m ? "border-accent/60 bg-accent/5" : "border-hairline",
              )}
            >
              <input type="radio" name="method" className="mt-0.5 accent-[#2f5bf9]" checked={method === m} onChange={() => setMethod(m)} />
              <span>
                <span className="block font-semibold">{title}</span>
                <span className="text-muted">{body}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="text-[12px] text-muted">Address: {POKECHAIN_INTAKE}</p>
        {method === "courier" ? (
          <div className="grid grid-cols-[160px_1fr] gap-3">
            <Field label="Carrier">
              <select className={inputClass} value={carrier} onChange={(e) => setCarrier(e.target.value)}>
                {CARRIERS.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Tracking number">
              <input className={inputClass} value={tracking} onChange={(e) => setTracking(e.target.value.trim())} placeholder="RR123456789SG" />
            </Field>
          </div>
        ) : null}
      </Section>

      {/* 5. declarations */}
      <Section n={5} title="Declarations">
        {(
          [
            ["owner", "I own this slab and have the right to vault and sell it."],
            ["authentic", "The slab is authentic and the case has not been opened or altered."],
            ["terms", "I agree to Pokechain's vault, insurance and Collector Crypt storage terms."],
          ] as const
        ).map(([key, text]) => (
          <label key={key} className="flex items-start gap-2 text-[13px]">
            <input
              type="checkbox"
              className="mt-0.5 accent-[#2f5bf9]"
              checked={declared[key]}
              onChange={(e) => setDeclared((d) => ({ ...d, [key]: e.target.checked }))}
            />
            {text}
          </label>
        ))}
      </Section>

      {missing.length ? <p className="text-[12.5px] text-muted">Still needed: {missing.join(", ")}.</p> : null}
      <Button type="submit" size="lg" className="w-full" disabled={missing.length > 0 || stage !== "idle"}>
        {stage === "uploading" ? (
          <>
            <Loader2 size={17} className="animate-spin" /> Hashing and uploading photos…
          </>
        ) : stage === "signing" ? (
          <>
            <Loader2 size={17} className="animate-spin" /> Confirm in your wallet…
          </>
        ) : (
          "Upload evidence and submit on-chain"
        )}
      </Button>
    </form>
  );
}

function Section({ n, title, aside, children }: { n: number; title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-card border border-hairline bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[14px] font-bold">
          <span className="grid h-6 w-6 place-items-center rounded-full bg-accent/15 text-[12px] text-accent">{n}</span>
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function PhotoTile({
  slot,
  title,
  hint,
  required,
  photo,
  onPick,
}: {
  slot: Slot;
  title: string;
  hint: string;
  required: boolean;
  photo?: Photo;
  onPick: (file: File | null) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="relative aspect-[3/4] overflow-hidden rounded-xl border border-dashed border-hairline bg-[#101014]">
        {photo ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- a local blob: preview, not an optimisable URL */}
            <img src={photo.url} alt={title} className="h-full w-full object-cover" />
            <button
              type="button"
              onClick={() => onPick(null)}
              aria-label={`Remove ${title}`}
              className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-black/70 text-white"
            >
              <X size={13} />
            </button>
          </>
        ) : (
          <label className="flex h-full cursor-pointer flex-col items-center justify-center gap-1.5 p-2 text-center text-[11px] text-dim hover:text-muted">
            {slot === "extra" ? <ImagePlus size={20} /> : <Camera size={20} />}
            {hint}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
          </label>
        )}
      </div>
      <p className="text-[12px] font-semibold">
        {title}
        {required ? <span className="text-bad"> *</span> : <span className="font-normal text-dim"> (optional)</span>}
      </p>
      {photo ? <p className="font-mono text-[10.5px] text-dim">keccak {shortHash(photo.hash)}</p> : null}
    </div>
  );
}

/** A placeholder JPEG for demos, so the form can be run without real photos to hand. */
async function samplePhoto(text: string, slot: Slot): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = 600;
  canvas.height = 800;
  const ctx = canvas.getContext("2d")!;
  const hue = { front: 220, back: 280, label: 30, extra: 150 }[slot];
  const g = ctx.createLinearGradient(0, 0, 600, 800);
  g.addColorStop(0, `hsl(${hue} 50% 35%)`);
  g.addColorStop(1, `hsl(${(hue + 40) % 360} 50% 15%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 600, 800);
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 6;
  ctx.strokeRect(60, 60, 480, 680);
  ctx.fillStyle = "white";
  ctx.font = "bold 34px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("SAMPLE PHOTO", 300, 360);
  ctx.font = "22px sans-serif";
  ctx.fillText(text, 300, 410);
  ctx.fillText(new Date().toLocaleString(), 300, 450);
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.85));
  return new File([blob], `${slot}-sample.jpg`, { type: "image/jpeg" });
}
