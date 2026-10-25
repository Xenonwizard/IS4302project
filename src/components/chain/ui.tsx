"use client";

import clsx from "clsx";
import { Check, Loader2 } from "lucide-react";

/** A contract function name set in code type, e.g. AccountRegistry.register(handle). */
export function Fn({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <code className={clsx("rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[11.5px] font-semibold text-white", className)}>
      {children}
    </code>
  );
}

/**
 * "What happens on-chain" panel: what a step does, in plain English. The exact contract calls go in
 * `tech`, folded away under "Technical detail" for anyone who wants to check them.
 */
export function OnChainNote({
  title = "What happens on-chain",
  children,
  tech,
}: {
  title?: string;
  children: React.ReactNode;
  tech?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-accent/25 bg-accent/[0.06] p-3.5 text-[12.5px] leading-relaxed text-muted">
      <p className="mb-1 text-[10.5px] font-bold uppercase tracking-wider text-accent">{title}</p>
      {children}
      {tech ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11.5px] font-semibold text-accent hover:underline">Technical detail</summary>
          <div className="mt-1.5 text-[11.5px] leading-relaxed">{tech}</div>
        </details>
      ) : null}
    </div>
  );
}

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
