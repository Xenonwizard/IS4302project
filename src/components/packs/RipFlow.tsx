"use client";

import Link from "next/link";
import { Loader2, PackageOpen, Sparkles } from "lucide-react";
import { useState } from "react";
import { discountPct } from "@/lib/catalog";
import { drawFromPack } from "@/lib/packRoll";
import { usd } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { Listing, Pack } from "@/lib/types";
import { Slab } from "../slab/Slab";
import { Badge, Button } from "../ui/primitives";
import { PackVisual } from "./PackVisual";

type Stage = "idle" | "ripping" | "revealed";

export function RipFlow({ pack }: { pack: Pack }) {
  const { requireAuth, user, addPull, topUp, listFromVault, pushToast } = useStore();
  const [stage, setStage] = useState<Stage>("idle");
  const [pull, setPull] = useState<Listing | null>(null);
  const [history, setHistory] = useState<Listing[]>([]);

  const short = (user?.balance ?? 0) < pack.price;

  const rip = () => {
    if (!requireAuth(() => rip())) return;
    if (short) {
      pushToast({
        title: "Not enough balance",
        body: `Top up to rip ${pack.name}.`,
        tone: "error",
      });
      return;
    }
    setStage("ripping");
    const result = drawFromPack(pack);
    window.setTimeout(() => {
      setPull(result);
      addPull(result, pack.name, pack.price);
      setHistory((prev) => [result, ...prev].slice(0, 12));
      setStage("revealed");
    }, 1900);
  };

  return (
    <div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* stage */}
        <div className="relative flex min-h-[420px] flex-col items-center justify-center overflow-hidden rounded-card border border-hairline bg-[#0b0b10] p-6">
          <div
            className="pointer-events-none absolute inset-0 opacity-50"
            style={{
              background: `radial-gradient(60% 50% at 50% 40%, hsl(${pack.hueA} 70% 30% / 0.55), transparent 70%)`,
            }}
          />

          {stage !== "revealed" ? (
            <div className="relative z-10 flex flex-col items-center gap-6">
              <div className={stage === "ripping" ? "rip-shake" : "transition-transform hover:scale-[1.03]"}>
                <PackVisual pack={pack} className="h-[300px] w-[210px]" torn={stage === "ripping"} />
              </div>
              {stage === "ripping" ? (
                <p className="flex items-center gap-2 text-sm font-semibold text-muted">
                  <Loader2 size={16} className="animate-spin" />
                  Selecting a slab from the vault…
                </p>
              ) : (
                <Button size="lg" onClick={rip} className="min-w-[220px]">
                  <PackageOpen size={18} />
                  Rip pack · {usd(pack.price)}
                </Button>
              )}
            </div>
          ) : pull ? (
            <div className="pop-in relative z-10 flex w-full flex-col items-center gap-5">
              <Badge tone="good" className="gap-1.5 px-3 py-1.5">
                <Sparkles size={13} />
                You pulled a {pull.grader} {pull.grade}
              </Badge>
              <div className="w-[190px]">
                <Slab listing={pull} />
              </div>
              <div className="text-center">
                <p className="text-sm font-bold leading-snug">{pull.title}</p>
                <p className="mt-1.5 text-[13px] text-muted">
                  Market value <span className="font-bold text-white">{usd(pull.fmv)}</span>
                  {pull.fmv > pack.price ? (
                    <span className="ml-2 text-good">
                      +{usd(pull.fmv - pack.price)} over pack price
                    </span>
                  ) : null}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    listFromVault(pull.id, Math.round(pull.fmv * 0.95 * 100) / 100);
                    setStage("idle");
                    setPull(null);
                  }}
                >
                  Relist for {usd(Math.round(pull.fmv * 0.95 * 100) / 100)}
                </Button>
                <Link href={`/asset/${pull.id}`}>
                  <Button variant="outline">View slab</Button>
                </Link>
                <Button
                  onClick={() => {
                    setStage("idle");
                    setPull(null);
                    rip();
                  }}
                >
                  Rip again · {usd(pack.price)}
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        {/* odds + detail */}
        <aside className="space-y-4">
          <section className="rounded-card border border-hairline bg-surface p-4">
            <h2 className="text-sm font-bold">Pack odds</h2>
            <p className="mt-1 text-[12px] text-muted">
              Published payout bands. Every pack returns exactly one graded slab.
            </p>
            <ul className="mt-4 space-y-3">
              {pack.odds.map((o) => (
                <li key={o.label}>
                  <div className="flex items-center justify-between text-[13px]">
                    <span className="text-muted">{o.label}</span>
                    <span className="font-semibold">{o.chance}%</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(2, o.chance)}%`,
                        background: `hsl(${pack.hueA} 70% 55%)`,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-card border border-hairline bg-surface p-4">
            <h2 className="text-sm font-bold">What is inside</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {pack.categories.map((c) => (
                <span
                  key={c}
                  className="rounded-lg bg-surface-2 px-2.5 py-1.5 text-[12px] font-semibold text-muted"
                >
                  {c}
                </span>
              ))}
            </div>
            <p className="mt-3 text-[12px] leading-relaxed text-muted">
              Pulls are drawn from live vault inventory. The slab is transferred to you as an
              ERC-721 token the moment the pack resolves.
            </p>
          </section>

          {user ? (
            <section className="rounded-card border border-hairline bg-surface p-4">
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-muted">Balance</span>
                <span className="text-sm font-bold">{usd(user.balance)}</span>
              </div>
              <Button variant="secondary" size="sm" className="mt-3 w-full" onClick={() => topUp(500)}>
                Add $500
              </Button>
            </section>
          ) : null}
        </aside>
      </div>

      {history.length ? (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-bold">Your pulls this session</h2>
          <div className="cy-scroll -mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
            {history.map((l, i) => (
              <Link
                key={`${l.id}-${i}`}
                href={`/asset/${l.id}`}
                className="w-[140px] shrink-0 rounded-card border border-hairline bg-surface p-2.5 transition hover:border-white/20"
              >
                <div className="rounded-lg bg-[#101014] p-2">
                  <Slab listing={l} />
                </div>
                <p className="mt-2 truncate text-[11px] font-semibold">{l.shortName}</p>
                <p className="text-[11px] text-muted">{usd(l.fmv)}</p>
                {discountPct(l) >= 5 ? (
                  <p className="text-[11px] text-good">{discountPct(l)}% under FMV</p>
                ) : null}
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
