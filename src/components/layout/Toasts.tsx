"use client";

import clsx from "clsx";
import { Check, Info, TriangleAlert, X } from "lucide-react";
import { useStore } from "@/lib/store";

export function Toasts() {
  const { toasts, dismissToast } = useStore();
  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed bottom-20 right-4 z-[120] flex w-[min(92vw,360px)] flex-col gap-2 lg:bottom-6">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={clsx(
            "fade-up pointer-events-auto flex items-start gap-3 rounded-2xl border border-hairline bg-[#111116] p-3.5 shadow-2xl",
          )}
        >
          <span
            className={clsx(
              "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full",
              t.tone === "success" && "bg-good-bg text-good",
              t.tone === "error" && "bg-bad/15 text-bad",
              (!t.tone || t.tone === "default") && "bg-accent/15 text-accent",
            )}
          >
            {t.tone === "success" ? <Check size={14} /> : t.tone === "error" ? <TriangleAlert size={14} /> : <Info size={14} />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold leading-snug">{t.title}</p>
            {t.body ? <p className="mt-0.5 text-[12px] leading-snug text-muted">{t.body}</p> : null}
          </div>
          <button
            onClick={() => dismissToast(t.id)}
            className="rounded p-0.5 text-dim transition hover:text-white"
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
