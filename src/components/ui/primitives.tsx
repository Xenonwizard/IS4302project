"use client";

import clsx from "clsx";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { countdown, timeAgo } from "@/lib/format";

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "outline";
  size?: "sm" | "md" | "lg";
}) {
  return (
    <button
      {...rest}
      className={clsx(
        "inline-flex select-none items-center justify-center gap-2 rounded-xl font-semibold transition disabled:cursor-not-allowed disabled:opacity-45",
        size === "sm" && "h-9 px-3 text-[13px]",
        size === "md" && "h-11 px-4 text-sm",
        size === "lg" && "h-12 px-5 text-[15px]",
        variant === "primary" && "bg-accent text-white hover:bg-accent-hover active:scale-[0.99]",
        variant === "secondary" &&
          "bg-surface-2 text-white hover:bg-surface-3 active:scale-[0.99]",
        variant === "outline" &&
          "border border-hairline bg-transparent text-white hover:bg-white/5",
        variant === "ghost" && "text-muted hover:bg-white/5 hover:text-white",
        variant === "danger" && "bg-bad/15 text-bad hover:bg-bad/25",
        className,
      )}
    />
  );
}

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: "neutral" | "good" | "accent" | "warn";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold leading-none",
        tone === "neutral" && "bg-surface-2 text-muted",
        tone === "good" && "bg-good-bg text-good",
        tone === "accent" && "bg-accent/15 text-accent",
        tone === "warn" && "bg-warn/15 text-warn",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Chip({
  active,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      {...rest}
      className={clsx(
        "h-9 shrink-0 rounded-lg px-3 text-[13px] font-semibold transition",
        active
          ? "bg-accent text-white"
          : "bg-surface-2 text-muted hover:bg-surface-3 hover:text-white",
        className,
      )}
    />
  );
}

export function Avatar({
  name,
  hue,
  size = 22,
  className,
}: {
  name: string;
  hue?: number;
  size?: number;
  className?: string;
}) {
  const h =
    hue ??
    [...name].reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) % 360, 7);
  return (
    <span
      className={clsx("inline-block shrink-0 rounded-full", className)}
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle at 30% 25%, hsl(${h} 90% 72%), hsl(${(h + 60) % 360} 75% 42%) 60%, hsl(${(h + 200) % 360} 65% 28%))`,
      }}
      aria-hidden
    />
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  width = "max-w-md",
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal
        className={clsx(
          "pop-in relative z-10 max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-hairline bg-[#0d0d11] sm:rounded-2xl cy-scroll",
          width,
        )}
      >
        {title ? (
          <div className="flex items-center justify-between border-b border-hairline px-5 py-4">
            <h2 className="text-base font-bold">{title}</h2>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-muted transition hover:bg-white/5 hover:text-white"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}

export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
  side = "right",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  side?: "right" | "left";
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[95]">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <aside
        className={clsx(
          "slide-in-right absolute top-0 flex h-full w-full max-w-[420px] flex-col border-hairline bg-[#09090c]",
          side === "right" ? "right-0 border-l" : "left-0 border-r",
        )}
      >
        <header className="flex items-center justify-between border-b border-hairline px-5 py-4">
          <h2 className="text-sm font-bold uppercase tracking-wide">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted transition hover:bg-white/5 hover:text-white"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </header>
        <div className="cy-scroll min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer ? <footer className="border-t border-hairline p-5">{footer}</footer> : null}
      </aside>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wide text-muted">
        {label}
      </span>
      {children}
      {hint ? <span className="mt-1.5 block text-[12px] text-dim">{hint}</span> : null}
    </label>
  );
}

export const inputClass =
  "h-11 w-full rounded-xl border border-hairline bg-surface px-3.5 text-sm text-white outline-none placeholder:text-dim focus:border-accent/70 focus:ring-2 focus:ring-accent/25";

/** Client-only relative time, keeps SSR output stable. */
export function TimeAgo({ value, className }: { value: string | number; className?: string }) {
  const [text, setText] = useState<string>("");
  useEffect(() => {
    const tick = () => setText(timeAgo(value));
    tick();
    const t = window.setInterval(tick, 15_000);
    return () => window.clearInterval(t);
  }, [value]);
  return (
    <span className={className} suppressHydrationWarning>
      {text || "—"}
    </span>
  );
}

export function Countdown({
  to,
  className,
  every,
}: {
  to: string;
  className?: string;
  /** auto-renewing deadline: once it passes, roll forward by this many ms */
  every?: number;
}) {
  const [text, setText] = useState<string>("");
  useEffect(() => {
    const tick = () => {
      let end = Date.parse(to);
      if (every) while (end <= Date.now()) end += every;
      setText(countdown(new Date(end).toISOString()));
    };
    tick();
    const t = window.setInterval(tick, 1000);
    return () => window.clearInterval(t);
  }, [to, every]);
  return (
    <span className={clsx("tabular-nums", className)} suppressHydrationWarning>
      {text || "—"}
    </span>
  );
}

export function Sparkline({
  values,
  className,
  stroke = "#3ddc84",
}: {
  values: number[];
  className?: string;
  stroke?: string;
}) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * 100;
    const y = 30 - ((v - min) / span) * 26 - 2;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className={className}>
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke={stroke}
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <polygon
        points={`0,30 ${pts.join(" ")} 100,30`}
        fill={stroke}
        opacity="0.12"
      />
    </svg>
  );
}
