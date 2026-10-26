"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronsLeft,
  ChevronsRight,
  ClipboardList,
  Heart,
  House,
  MessagesSquare,
  Plus,
  ShieldCheck,
  Store,
  UserRound,
  Wallet,
} from "lucide-react";

const NAV = [
  { href: "/", label: "Home", short: "Home", icon: House },
  { href: "/marketplace", label: "Marketplace", short: "Market", icon: Store },
  { href: "/trades", label: "Negotiation rooms", short: "Rooms", icon: MessagesSquare },
  { href: "/submissions", label: "Submissions", short: "Submit", icon: ClipboardList },
  { href: "/vault", label: "Vault", short: "Vault", icon: ShieldCheck },
  { href: "/watchlist", label: "Watchlist", short: "Watchlist", icon: Heart },
  { href: "/wallet", label: "Wallet", short: "Wallet", icon: Wallet },
  { href: "/account", label: "Account", short: "Account", icon: UserRound, desktopOnly: true },
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
      <div className="border-t border-hairline p-3 pb-[72px]">
        <Link
          href="/submit"
          title={collapsed ? "Add a slab" : undefined}
          className={clsx(
            "flex h-11 items-center gap-3 rounded-xl bg-accent px-3 text-sm font-semibold text-white transition hover:bg-accent-hover active:scale-[0.99]",
            collapsed && "justify-center px-0",
          )}
        >
          <Plus size={19} strokeWidth={2.3} />
          {!collapsed ? <span>Add a slab</span> : null}
        </Link>
      </div>
    </aside>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-hairline bg-black/95 backdrop-blur lg:hidden">
      {NAV.filter((n) => !n.desktopOnly).map(({ href, short, icon: Icon }) => {
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
            {short}
          </Link>
        );
      })}
    </nav>
  );
}
