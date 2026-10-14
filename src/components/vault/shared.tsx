"use client";

import Link from "next/link";
import { useStore } from "@/lib/store";
import { Button } from "../ui/primitives";

/** Empty state for the vault, watchlist and wallet pages. */
export function Empty({
  icon,
  title,
  body,
  cta,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  cta?: { href: string; label: string };
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-hairline py-16 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-surface text-muted">
        {icon}
      </span>
      <p className="text-base font-bold">{title}</p>
      <p className="max-w-sm text-[13px] text-muted">{body}</p>
      {cta ? (
        <Link href={cta.href}>
          <Button variant="secondary" className="mt-1">
            {cta.label}
          </Button>
        </Link>
      ) : null}
    </div>
  );
}

/** Shown in place of an account page when nobody is logged in. */
export function LoginPrompt({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  const { setAuthOpen } = useStore();
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-accent/15 text-accent">
        {icon}
      </span>
      <h1 className="text-xl font-bold">{title}</h1>
      <p className="max-w-sm text-sm text-muted">{body}</p>
      <Button size="lg" onClick={() => setAuthOpen(true)}>
        Log in
      </Button>
    </div>
  );
}
