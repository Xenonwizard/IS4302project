"use client";

import clsx from "clsx";
import Link from "next/link";
import { Trophy } from "lucide-react";
import { useState } from "react";
import { LEADERBOARD_CURRENT, LEADERBOARD_PREVIOUS } from "@/lib/catalog";
import { compact, points } from "@/lib/format";
import { useStore } from "@/lib/store";
import { Avatar } from "../ui/primitives";

export function LeaderboardView() {
  const [tab, setTab] = useState<"current" | "previous">("current");
  const { user } = useStore();
  const rows = tab === "current" ? LEADERBOARD_CURRENT : LEADERBOARD_PREVIOUS;
  const podium = [rows[1], rows[0], rows[2]];

  return (
    <div className="px-4 py-6 lg:px-6">
      <div className="text-center">
        <h1 className="text-[26px] font-bold">Monthly leaderboard</h1>
        <p className="mt-2 inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-[12px] text-muted">
          <Trophy size={13} className="text-warn" />
          Resets Thu, Oct 1 at 8AM (GMT+8)
        </p>
      </div>

      <div className="mx-auto mt-8 grid max-w-2xl grid-cols-3 items-end gap-3">
        {podium.map((entry, i) => {
          const place = i === 1 ? 1 : i === 0 ? 2 : 3;
          return (
            <div key={entry.user} className="flex flex-col items-center">
              <Avatar
                name={entry.user}
                hue={entry.avatarHueA}
                size={place === 1 ? 64 : 48}
                className="ring-2 ring-white/10"
              />
              <Link
                href={`/profile/${entry.user}`}
                className={clsx(
                  "mt-2 max-w-full truncate px-1 font-bold hover:underline",
                  place === 1 ? "text-[14px]" : "text-[12px]",
                )}
              >
                {entry.user}
              </Link>
              <span className="text-[11px] text-dim">
                {place === 1 ? "1st" : place === 2 ? "2nd" : "3rd"}
              </span>
              <div
                className={clsx(
                  "mt-3 flex w-full items-center justify-center rounded-t-xl border border-b-0 border-hairline bg-surface font-bold",
                  place === 1
                    ? "h-[92px] text-[15px]"
                    : place === 2
                      ? "h-[68px] text-[13px]"
                      : "h-[52px] text-[13px]",
                )}
              >
                🏆 {compact(entry.points)}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-8 flex justify-end">
        <div className="flex rounded-xl bg-surface p-1">
          {(["current", "previous"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={clsx(
                "h-9 rounded-lg px-4 text-[13px] font-semibold transition",
                tab === t ? "bg-surface-3 text-white" : "text-muted hover:text-white",
              )}
            >
              {t === "current" ? "Current month" : "Previous month"}
            </button>
          ))}
        </div>
      </div>

      {user ? (
        <div className="mt-4 flex items-center gap-4 rounded-card border border-accent/40 bg-accent/10 px-4 py-3.5">
          <span className="w-10 shrink-0 text-[13px] font-bold text-accent">You</span>
          <Avatar name={user.username} hue={user.hue} size={28} />
          <span className="min-w-0 flex-1 truncate text-[13px] font-bold">{user.username}</span>
          <span className="shrink-0 text-[13px] font-bold">{points(user.points)}</span>
        </div>
      ) : null}

      <ul className="mt-4 divide-y divide-[rgba(255,255,255,0.08)] overflow-hidden rounded-card border border-hairline bg-surface">
        {rows.slice(3).map((entry) => (
          <li key={entry.user} className="flex items-center gap-4 px-4 py-3">
            <span className="w-10 shrink-0 text-[13px] font-bold text-muted">#{entry.rank}</span>
            <Avatar name={entry.user} hue={entry.avatarHueA} size={26} />
            <Link
              href={`/profile/${entry.user}`}
              className="min-w-0 flex-1 truncate text-[13px] font-semibold hover:underline"
            >
              {entry.user}
            </Link>
            <span className="shrink-0 text-[13px] font-semibold tabular-nums text-muted">
              {points(entry.points)}
            </span>
          </li>
        ))}
      </ul>

      <section className="mt-6 rounded-card border border-hairline bg-surface p-5">
        <h2 className="text-sm font-bold">How points work</h2>
        <ul className="mt-3 space-y-2 text-[13px] leading-relaxed text-muted">
          <li>· 25 points per dollar spent ripping packs.</li>
          <li>· 10 points per dollar spent on marketplace buys.</li>
          <li>· Live events multiply pack points by 2x to 3x while they run.</li>
          <li>· Points reset on the first of each month; the previous board is archived.</li>
        </ul>
      </section>
    </div>
  );
}
