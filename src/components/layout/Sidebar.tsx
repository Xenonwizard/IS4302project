"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  House,
  PackageOpen,
  ShieldCheck,
  Store,
  Trophy,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { EVENTS } from "@/lib/catalog";
import { Button } from "../ui/primitives";

const NAV = [
  { href: "/", label: "Home", icon: House },
  { href: "/packs", label: "Packs", icon: PackageOpen },
  { href: "/marketplace", label: "Marketplace", icon: Store },
  { href: "/leaderboard", label: "Leaderboard", icon: Trophy },
  { href: "/vault", label: "My vault", icon: ShieldCheck },
];

export function Sidebar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const pathname = usePathname();
  const [eventsOpen, setEventsOpen] = useState(true);

  return (
    <aside
      className={clsx(
        "relative hidden shrink-0 flex-col border-r border-hairline bg-black transition-[width] duration-200 lg:flex",
        collapsed ? "w-[72px]" : "w-[232px]",
      )}
    >
      <button
        onClick={onToggle}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className="absolute -right-3 top-4 z-20 grid h-6 w-6 place-items-center rounded-full border border-hairline bg-surface text-muted transition hover:text-white"
      >
        {collapsed ? <ChevronsRight size={13} /> : <ChevronsLeft size={13} />}
      </button>

      <nav className="cy-scroll flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-1">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  title={collapsed ? label : undefined}
                  className={clsx(
                    "flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition",
                    active ? "bg-white/8 text-white" : "text-muted hover:bg-white/5 hover:text-white",
                    collapsed && "justify-center px-0",
                  )}
                >
                  <Icon size={19} strokeWidth={active ? 2.4 : 1.9} />
                  {!collapsed ? <span>{label}</span> : null}
                </Link>
              </li>
            );
          })}
        </ul>

        {!collapsed ? (
          <div className="mt-6">
            <button
              onClick={() => setEventsOpen((v) => !v)}
              className="flex w-full items-center justify-between px-3 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-dim transition hover:text-muted"
            >
              Events
              <ChevronDown
                size={15}
                className={clsx("transition", eventsOpen && "rotate-180")}
              />
            </button>
            {eventsOpen ? (
              <ul className="mt-1 space-y-0.5">
                {EVENTS.map((e) => {
                  const active = pathname === `/events/${e.slug}`;
                  return (
                    <li key={e.slug}>
                      <Link
                        href={`/events/${e.slug}`}
                        className={clsx(
                          "flex h-10 items-center gap-3 rounded-xl px-3 text-[13px] font-medium transition",
                          active
                            ? "bg-white/8 text-white"
                            : "text-muted hover:bg-white/5 hover:text-white",
                        )}
                      >
                        <Zap
                          size={16}
                          style={{ color: `hsl(${e.hueA} 80% 62%)` }}
                          strokeWidth={2}
                        />
                        <span className="truncate">{e.name}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        ) : null}
      </nav>

      <div className="p-3">
        <Link href="/submit">
          {collapsed ? (
            <Button variant="primary" size="sm" className="w-full px-0" title="Submit my collectibles">
              +
            </Button>
          ) : (
            <Button variant="primary" className="w-full">
              Submit my collectibles
            </Button>
          )}
        </Link>
      </div>
    </aside>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-hairline bg-black/95 backdrop-blur lg:hidden">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={clsx(
              "flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-semibold",
              active ? "text-white" : "text-dim",
            )}
          >
            <Icon size={19} strokeWidth={active ? 2.4 : 1.9} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
