"use client";

import clsx from "clsx";
import Image from "next/image";
import { useEffect, useRef } from "react";
import { hashString } from "@/lib/rng";
import type { Listing } from "@/lib/types";
import { CardBack } from "./CardBack";

/*
 * A graded slab built in CSS 3D. What makes it read as a physical object:
 *
 * 1. Thickness — a stack of translucent rims behind the face, so the acrylic edge
 *    shows when the slab turns instead of a paper-thin plane.
 * 2. Pointer-driven lighting — the pointer position becomes CSS variables that move
 *    a specular glare, a light streak across the case and (on holo cards) a
 *    rainbow foil layer blended with color-dodge, so light seems to come from a
 *    fixed source as the slab tilts.
 * 3. Spring easing — tilt chases the pointer through a damped lerp each frame, so
 *    the slab has weight instead of snapping.
 * 4. A contact shadow that slides opposite the tilt.
 */

const THICKNESS_LAYERS = 7;
/** depth of each rim layer, in container-width units */
const LAYER_DEPTH = 0.9;

export function Slab({
  listing,
  className,
  flat = false,
  fit = false,
  interactive = false,
  spinning = false,
  maxTilt = 14,
  sizes = "(min-width: 1024px) 240px, 45vw",
}: {
  listing: Listing;
  className?: string;
  /** flat drops depth and lighting — used for tiny thumbnails */
  flat?: boolean;
  /** fit sizes from the parent's height instead of its width */
  fit?: boolean;
  /** tilt toward the pointer with moving light */
  interactive?: boolean;
  /** slow turntable spin that shows the back */
  spinning?: boolean;
  maxTilt?: number;
  sizes?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const live = interactive && !flat && !spinning;
  useTilt(rootRef, bodyRef, live, maxTilt);

  return (
    <div
      ref={rootRef}
      className={clsx(
        "@container slab-root relative",
        fit ? "h-full w-full" : "aspect-[0.62] w-full",
        !flat && "[perspective:1200px]",
        className,
      )}
    >
      {!flat ? <div className="slab-shadow" aria-hidden /> : null}
      <div
        ref={bodyRef}
        className={clsx("slab-body relative h-full w-full", spinning && "spin-slab")}
      >
        {!flat
          ? Array.from({ length: THICKNESS_LAYERS }, (_, i) => (
              <div
                key={i}
                aria-hidden
                className="slab-rim"
                style={{ transform: `translateZ(${-(i + 1) * LAYER_DEPTH}cqw)` }}
              />
            ))
          : null}

        {/* back face */}
        {!flat ? (
          <div
            className="slab-face slab-back"
            style={{
              transform: `translateZ(${-(THICKNESS_LAYERS + 1) * LAYER_DEPTH}cqw) rotateY(180deg)`,
            }}
          >
            <SlabBack listing={listing} />
          </div>
        ) : null}

        {/* front face */}
        <div className="slab-face">
          <div
            className={clsx(
              "slab-case flex h-full w-full flex-col gap-[2.4cqw] p-[4.2cqw]",
              listing.grader === "SGC" && "slab-case-sgc",
            )}
          >
            <GradeLabel listing={listing} />
            <div className="slab-well relative min-h-0 flex-1">
              <div
                className="relative h-full w-full overflow-hidden rounded-[3.4cqw] bg-cover bg-center"
                // the small scan paints instantly while the hi-res one loads
                style={flat ? undefined : { backgroundImage: `url(${listing.thumb})` }}
              >
                <Image
                  src={flat ? listing.thumb : listing.image}
                  alt={`${listing.subject}, ${listing.set} ${listing.cardNumber}`}
                  fill
                  sizes={flat ? "64px" : sizes}
                  className="object-cover"
                  draggable={false}
                />
                {!flat && listing.holo ? <div className="slab-foil" aria-hidden /> : null}
                {!flat ? <div className="slab-card-glare" aria-hidden /> : null}
              </div>
            </div>
          </div>
          {!flat ? (
            <>
              <div className="slab-glare" aria-hidden />
              <div className="slab-streak" aria-hidden />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Writes --rx/--ry (tilt) and --px/--py/--hyp (light position and strength) on the
 * root element from a requestAnimationFrame loop. No React state, so a grid full of
 * slabs never re-renders while the pointer moves.
 */
function useTilt(
  rootRef: React.RefObject<HTMLDivElement | null>,
  bodyRef: React.RefObject<HTMLDivElement | null>,
  enabled: boolean,
  maxTilt: number,
) {
  useEffect(() => {
    const root = rootRef.current;
    const body = bodyRef.current;
    if (!root || !body) return;
    if (!enabled) {
      body.style.transform = "";
      return;
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;

    const cur = { x: 0.5, y: 0.5, a: 0 };
    const target = { x: 0.5, y: 0.5, a: 0 };
    let frame = 0;

    const paint = () => {
      cur.x += (target.x - cur.x) * 0.14;
      cur.y += (target.y - cur.y) * 0.14;
      cur.a += (target.a - cur.a) * 0.1;
      const rx = (0.5 - cur.y) * 2 * maxTilt * cur.a;
      const ry = (cur.x - 0.5) * 2 * maxTilt * cur.a;
      body.style.transform = `rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
      root.style.setProperty("--rx", rx.toFixed(2));
      root.style.setProperty("--ry", ry.toFixed(2));
      root.style.setProperty("--px", `${(cur.x * 100).toFixed(1)}%`);
      root.style.setProperty("--py", `${(cur.y * 100).toFixed(1)}%`);
      const dist = Math.min(1, Math.hypot(cur.x - 0.5, cur.y - 0.5) * 2);
      root.style.setProperty("--hyp", (cur.a * (0.35 + dist * 0.65)).toFixed(3));
      const settled =
        Math.abs(target.x - cur.x) < 0.001 &&
        Math.abs(target.y - cur.y) < 0.001 &&
        Math.abs(target.a - cur.a) < 0.002;
      frame = settled ? 0 : requestAnimationFrame(paint);
    };
    const kick = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };

    const onMove = (e: PointerEvent) => {
      const r = root.getBoundingClientRect();
      target.x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      target.y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      target.a = 1;
      kick();
    };
    const onLeave = () => {
      target.x = 0.5;
      target.y = 0.5;
      target.a = 0;
      kick();
    };

    root.addEventListener("pointermove", onMove);
    root.addEventListener("pointerleave", onLeave);
    return () => {
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerleave", onLeave);
      cancelAnimationFrame(frame);
    };
  }, [rootRef, bodyRef, enabled, maxTilt]);
}

/* ---------------- grading labels ---------------- */

function Barcode({ seed, className }: { seed: number; className?: string }) {
  // Bar widths from the cert so every label differs, like a real Code 128 strip.
  const bars: number[] = [];
  let s = seed;
  for (let i = 0; i < 26; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    bars.push(1 + (s % 3));
  }
  const xs = bars.reduce<number[]>((acc, w, i) => [...acc, i ? acc[i - 1] + bars[i - 1] * 1.25 : 0], []);
  return (
    <svg viewBox="0 0 100 10" preserveAspectRatio="none" className={className} aria-hidden>
      {bars.map((w, i) =>
        i % 2 === 0 ? <rect key={i} x={xs[i]} y="0" width={w * 0.9} height="10" fill="currentColor" /> : null,
      )}
    </svg>
  );
}

function labelLines(listing: Listing) {
  const number = listing.cardNumber.split("/")[0];
  return {
    line1: `${listing.year} POKEMON ${listing.set.toUpperCase()}`,
    line2: `#${number} ${listing.subject.toUpperCase()}`,
    line3: listing.variant.toUpperCase(),
  };
}

function GradeLabel({ listing }: { listing: Listing }) {
  const seed = hashString(listing.certNumber);
  const { line1, line2, line3 } = labelLines(listing);
  const grade = String(listing.grade);

  if (listing.grader === "PSA") {
    return (
      <div className="slab-label h-[22cqw] shrink-0 overflow-hidden rounded-[1.4cqw] bg-white p-[0.9cqw]">
        <div className="flex h-full rounded-[0.8cqw] border-[0.7cqw] border-[#c8102e] bg-white px-[2cqw] py-[1.5cqw] text-[#111]">
          <div className="min-w-0 flex-1 font-semibold uppercase leading-[1.32] tracking-[0.01em]">
            <p className="truncate text-[2.75cqw] font-bold">{line1}</p>
            <p className="truncate text-[2.75cqw] font-bold">{line2}</p>
            <p className="truncate text-[2.5cqw]">{line3}</p>
            <Barcode seed={seed} className="mt-[1.1cqw] h-[3.4cqw] w-[46%] text-black" />
          </div>
          <div className="flex shrink-0 flex-col items-end justify-between pl-[1.5cqw] text-right">
            <span className="text-[2.6cqw] font-bold uppercase leading-none">{listing.gradeLabel}</span>
            <span className="text-[8.4cqw] font-black leading-[0.9]">{grade}</span>
            <span className="flex items-center gap-[0.8cqw]">
              <span className="text-[2.1cqw] font-semibold tabular-nums">{listing.certNumber}</span>
              <span className="rounded-[0.5cqw] bg-[#c8102e] px-[1cqw] py-[0.3cqw] text-[2.6cqw] font-black italic leading-none text-white">
                PSA
              </span>
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (listing.grader === "CGC") {
    const pristine = listing.grade === 10;
    return (
      <div
        className="slab-label h-[22cqw] shrink-0 overflow-hidden flex rounded-[1.4cqw] px-[2.4cqw] py-[1.8cqw] text-white"
        style={{
          background: pristine
            ? "linear-gradient(135deg,#6b5418,#d9b25a 45%,#8a6a1f)"
            : "linear-gradient(135deg,#0f2f63,#1f5fb5 55%,#123e80)",
        }}
      >
        <div className="min-w-0 flex-1 uppercase leading-[1.32]">
          <p className="flex items-baseline gap-[1cqw]">
            <span className="text-[3.6cqw] font-black tracking-tight">CGC</span>
            <span className="text-[1.9cqw] font-bold tracking-[0.18em] opacity-80">CARDS</span>
          </p>
          <p className="truncate text-[2.5cqw] font-semibold">{line1}</p>
          <p className="truncate text-[2.5cqw] font-semibold">{line2}</p>
          <p className="truncate text-[2.2cqw] opacity-85">{line3}</p>
        </div>
        <div className="ml-[1.5cqw] flex w-[23%] shrink-0 flex-col items-center justify-center rounded-[1cqw] bg-white/95 py-[1cqw] text-[#0f2f63]">
          <span className="text-[1.9cqw] font-bold uppercase leading-none">{listing.gradeLabel}</span>
          <span className="text-[8cqw] font-black leading-[1]">{grade}</span>
          <span className="text-[1.7cqw] font-semibold tabular-nums leading-none">{listing.certNumber}</span>
        </div>
      </div>
    );
  }

  if (listing.grader === "BGS") {
    const black = listing.grade === 10;
    const gold = listing.grade === 9.5;
    const subs = ["Centering", "Corners", "Edges", "Surface"].map((name, i) => {
      const bump = ((seed >> (i * 3)) & 3) * 0.5;
      const v = Math.min(10, Math.max(listing.grade - 0.5, listing.grade - 0.5 + bump));
      return { name, v: black ? 10 : v };
    });
    return (
      <div
        className={clsx(
          "slab-label h-[22cqw] shrink-0 overflow-hidden flex rounded-[1.4cqw] px-[2.2cqw] py-[1.6cqw]",
          black ? "text-[#e9d38f]" : "text-[#1b1b1f]",
        )}
        style={{
          background: black
            ? "linear-gradient(135deg,#050505,#2b2b2e 50%,#0b0b0c)"
            : gold
              ? "linear-gradient(135deg,#a37b26,#f3d98a 40%,#c9a24a 60%,#8c6720)"
              : "linear-gradient(135deg,#8d9097,#eef0f3 42%,#b5b9c0 62%,#7e828a)",
        }}
      >
        <div className="min-w-0 flex-1 uppercase leading-[1.3]">
          <p className="text-[3.2cqw] font-black tracking-[0.06em]">BECKETT</p>
          <p className="truncate text-[2.3cqw] font-bold">{line1}</p>
          <p className="truncate text-[2.3cqw] font-bold">{line2}</p>
          <div className="mt-[0.6cqw] grid grid-cols-4 gap-[0.6cqw] text-[1.7cqw] font-semibold">
            {subs.map((s) => (
              <span key={s.name} className="truncate">
                {s.name.slice(0, 4)} <b className="font-black">{s.v}</b>
              </span>
            ))}
          </div>
        </div>
        <div className="ml-[1.2cqw] flex shrink-0 flex-col items-center justify-center">
          <span className="text-[8.4cqw] font-black leading-[0.95]">{grade}</span>
          <span className="text-[1.9cqw] font-bold uppercase leading-none">{listing.gradeLabel}</span>
          <span className="mt-[0.6cqw] text-[1.6cqw] font-semibold tabular-nums opacity-80">
            {listing.certNumber}
          </span>
        </div>
      </div>
    );
  }

  // SGC: white type on the black "tuxedo" insert
  return (
    <div className="slab-label h-[22cqw] shrink-0 overflow-hidden flex rounded-[1.2cqw] border-[0.4cqw] border-white/25 bg-[#0b0b0b] px-[2.2cqw] py-[1.6cqw] text-white">
      <div className="min-w-0 flex-1 uppercase leading-[1.32]">
        <p className="text-[3.4cqw] font-black tracking-[0.1em] text-[#d8b45a]">SGC</p>
        <p className="truncate text-[2.4cqw] font-semibold">{line1}</p>
        <p className="truncate text-[2.4cqw] font-semibold">{line2}</p>
        <p className="truncate text-[2.1cqw] opacity-75">{line3}</p>
      </div>
      <div className="ml-[1.4cqw] flex w-[22%] shrink-0 flex-col items-center justify-center rounded-[0.8cqw] bg-white py-[0.8cqw] text-black">
        <span className="text-[7.6cqw] font-black leading-[1]">{grade}</span>
        <span className="text-[1.9cqw] font-bold uppercase leading-none">{listing.gradeLabel}</span>
      </div>
    </div>
  );
}

function SlabBack({ listing }: { listing: Listing }) {
  const seed = hashString(listing.certNumber + "b");
  return (
    <div
      className={clsx(
        "slab-case flex h-full w-full flex-col gap-[2.4cqw] p-[4.2cqw]",
        listing.grader === "SGC" && "slab-case-sgc",
      )}
    >
      <div className="slab-label h-[22cqw] shrink-0 overflow-hidden flex items-center justify-between rounded-[1.4cqw] bg-white/92 px-[2.4cqw] py-[1.8cqw] text-[#111]">
        <div>
          <p className="text-[3.6cqw] font-black">{listing.grader}</p>
          <p className="text-[1.9cqw] font-semibold uppercase tracking-[0.12em] text-black/60">
            Cert {listing.certNumber}
          </p>
          <Barcode seed={seed} className="mt-[1cqw] h-[3.6cqw] w-[38cqw] text-black" />
        </div>
        {/* tamper-evident hologram */}
        <div className="slab-hologram h-[11cqw] w-[11cqw] rounded-full" />
      </div>
      <div className="slab-well relative min-h-0 flex-1">
        <div className="h-full w-full overflow-hidden rounded-[3.4cqw]">
          <CardBack />
        </div>
      </div>
    </div>
  );
}

/** Detail-page presentation: the slab under a soft spotlight. */
export function SlabStage({
  listing,
  spinning = false,
}: {
  listing: Listing;
  spinning?: boolean;
}) {
  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(55% 55% at 50% 40%, hsl(${listing.hue} 60% 45% / 0.22), transparent 70%), radial-gradient(40% 18% at 50% 92%, rgba(255,255,255,0.05), transparent 70%)`,
        }}
      />
      <div className="relative aspect-[0.62] h-[84%] max-h-[480px]">
        <Slab
          listing={listing}
          fit
          interactive
          spinning={spinning}
          maxTilt={18}
          sizes="(min-width: 1280px) 420px, 70vw"
        />
      </div>
    </div>
  );
}

