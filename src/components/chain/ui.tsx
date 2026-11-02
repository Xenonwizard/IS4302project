"use client";

import clsx from "clsx";
import { Check, Loader2 } from "lucide-react";

export type StepState = "todo" | "active" | "busy" | "done";

/** One numbered step in a multi-step chain flow. */
export function Step({
  n,
  title,
  state,
  children,
}: {
  n: number;
  title: string;
  state: StepState;
  children?: React.ReactNode;
}) {
  return (
    <li className={clsx("flex gap-3", state === "todo" && "opacity-45")}>
      <span
        className={clsx(
          "grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-bold",
          state === "done" ? "bg-good-bg text-good" : state === "todo" ? "bg-surface-2 text-dim" : "bg-accent text-white",
        )}
      >
        {state === "done" ? <Check size={14} /> : state === "busy" ? <Loader2 size={14} className="animate-spin" /> : n}
      </span>
      <div className="min-w-0 flex-1 pb-1">
        <p className="pt-1 text-[14px] font-bold">{title}</p>
        {state === "active" || state === "busy" ? <div className="mt-2.5 space-y-3">{children}</div> : null}
      </div>
    </li>
  );
}
