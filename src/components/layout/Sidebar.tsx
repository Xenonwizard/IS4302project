"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronsLeft,
  ChevronsRight,
  House,
  MessagesSquare,
  ShieldCheck,
  Store,
} from "lucide-react";
import { Button } from "../ui/primitives";

const NAV = [
  { href: "/", label: "Home", icon: House },
  { href: "/marketplace", label: "Marketplace", icon: Store },
  { href: "/trades", label: "Trade rooms", icon: MessagesSquare },
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
