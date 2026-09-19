"use client";

import clsx from "clsx";
import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function Select<T extends string>({
  value,
  options,
  onChange,
  className,
  align = "right",
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  className?: string;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const current = options.find((o) => o.value === value);

  return (
    <div className={clsx("relative", className)} ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-xl border border-hairline bg-surface px-3 text-[13px] font-semibold transition hover:bg-surface-2"
      >
        <span className="truncate">{current?.label ?? value}</span>
        <ChevronDown size={15} className={clsx("shrink-0 text-muted transition", open && "rotate-180")} />
      </button>
      {open ? (
        <ul
          className={clsx(
            "pop-in absolute top-11 z-50 min-w-full overflow-hidden rounded-xl border border-hairline bg-[#0d0d11] py-1 shadow-2xl",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {options.map((o) => (
            <li key={o.value}>
              <button
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className={clsx(
                  "block w-full whitespace-nowrap px-3.5 py-2 text-left text-[13px] font-medium transition",
                  o.value === value ? "bg-accent text-white" : "text-muted hover:bg-white/5 hover:text-white",
                )}
              >
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
