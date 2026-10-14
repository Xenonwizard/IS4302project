"use client";

import clsx from "clsx";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { GRAILS } from "@/lib/catalog";
import { Slab } from "../slab/Slab";
import { Button } from "../ui/primitives";

const SLIDES = [
  {
    title: "Make an offer, chat 1-to-1",
    body: "Offer full cash or trade your slabs plus cash, then negotiate privately with the seller.",
    cta: "Browse the marketplace",
    href: "/marketplace",
    hueA: 224,
    hueB: 268,
  },
  {
    title: "Real cards, real grades",
    body: "PSA, CGC, BGS and SGC slabs, from Base Set holos to Prismatic Evolutions.",
    cta: "Browse the marketplace",
    href: "/marketplace",
    hueA: 12,
    hueB: 352,
  },
];

export function HeroCarousel() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const t = window.setInterval(() => setIndex((i) => (i + 1) % SLIDES.length), 6500);
    return () => window.clearInterval(t);
  }, []);

  const slide = SLIDES[index];
  const picks = [GRAILS[index % GRAILS.length], GRAILS[(index + 4) % GRAILS.length], GRAILS[(index + 8) % GRAILS.length]];

  return (
    <section className="relative overflow-hidden rounded-card border border-hairline">
      <div
        className="relative flex min-h-[260px] flex-col justify-between gap-6 p-6 sm:min-h-[320px] sm:p-8 lg:flex-row lg:items-center"
        style={{
          background: `linear-gradient(120deg, hsl(${slide.hueA} 58% 16%), hsl(${slide.hueB} 62% 9%) 62%, #05050a)`,
        }}
      >
        <div key={slide.title} className="fade-up relative z-10 max-w-lg">
          <h1 className="text-[28px] font-bold leading-tight sm:text-[38px]">{slide.title}</h1>
          <p className="mt-2.5 text-[15px] text-white/70">{slide.body}</p>
          <Link href={slide.href}>
            <Button className="mt-5" size="lg">
              {slide.cta}
            </Button>
          </Link>
        </div>

        <div className="pointer-events-none absolute right-0 top-1/2 hidden w-[46%] max-w-[420px] -translate-y-1/2 items-center justify-center gap-3 pr-6 sm:flex">
          {picks.map((l, i) => (
            <div
              key={`${l.id}-${i}`}
              className={clsx(
                "w-[28%] max-w-[118px] transition-transform duration-500",
                i === 1 ? "-translate-y-4 scale-110" : i === 0 ? "rotate-[-8deg]" : "rotate-[8deg]",
              )}
            >
              <Slab listing={l} />
            </div>
          ))}
        </div>
      </div>

      <button
        onClick={() => setIndex((i) => (i - 1 + SLIDES.length) % SLIDES.length)}
        aria-label="Previous slide"
        className="absolute left-3 top-1/2 z-20 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white/80 backdrop-blur transition hover:bg-black/70 hover:text-white"
      >
        <ChevronLeft size={18} />
      </button>
      <button
        onClick={() => setIndex((i) => (i + 1) % SLIDES.length)}
        aria-label="Next slide"
        className="absolute right-3 top-1/2 z-20 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white/80 backdrop-blur transition hover:bg-black/70 hover:text-white"
      >
        <ChevronRight size={18} />
      </button>

      <div className="absolute bottom-3.5 left-1/2 z-20 flex -translate-x-1/2 gap-1.5">
        {SLIDES.map((s, i) => (
          <button
            key={s.title}
            onClick={() => setIndex(i)}
            aria-label={`Slide ${i + 1}`}
            className={clsx(
              "h-1.5 rounded-full transition-all",
              i === index ? "w-6 bg-white" : "w-1.5 bg-white/40 hover:bg-white/70",
            )}
          />
        ))}
      </div>
    </section>
  );
}
