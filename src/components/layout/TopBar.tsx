"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  LogOut,
  RotateCcw,
  Search,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Wallet,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BRAND } from "@/lib/brand";
import { LISTINGS } from "@/lib/catalog";
import { usd } from "@/lib/format";
import { useStore } from "@/lib/store";
import { Avatar, Button, inputClass } from "../ui/primitives";
import { Logo } from "./Logo";

export function PromoBanner() {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <div className="relative flex items-center justify-center gap-2 bg-black px-10 py-2.5 text-center text-[13px] font-semibold">
      <span>The thrill of the rip — now in your pocket.</span>
      <Link href="/packs" className="text-accent underline-offset-2 hover:underline">
        Open a pack →
      </Link>
      <button
        onClick={() => setOpen(false)}
        aria-label="Dismiss"
        className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-muted transition hover:text-white"
      >
        <X size={16} />
      </button>
    </div>
  );
}

export function TopBar() {
  const { user, logout, setAuthOpen, cart, setCartOpen, resetDemo } = useStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  return (
    <header className="flex h-[62px] shrink-0 items-center gap-4 bg-black px-4 lg:px-6">
      <Link href="/" className="shrink-0">
        <Logo />
      </Link>

      <div className="hidden flex-1 md:block">
        <GlobalSearch />
      </div>
      <div className="flex-1 md:hidden" />

      <button
        onClick={() => setCartOpen(true)}
        className="relative grid h-10 w-10 place-items-center rounded-xl text-muted transition hover:bg-white/5 hover:text-white"
        aria-label="Cart"
      >
        <ShoppingCart size={19} />
        {cart.length ? (
          <span className="absolute -right-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">
            {cart.length}
          </span>
        ) : null}
      </button>

      {user ? (
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex h-10 items-center gap-2 rounded-xl border border-hairline px-2.5 text-sm font-semibold transition hover:bg-white/5"
          >
            <Avatar name={user.username} hue={user.hue} size={22} />
            <span className="hidden max-w-[120px] truncate sm:block">{user.username}</span>
          </button>
          {menuOpen ? (
            <div className="pop-in absolute right-0 top-12 z-50 w-64 overflow-hidden rounded-2xl border border-hairline bg-[#0d0d11] shadow-2xl">
              <div className="border-b border-hairline p-4">
                <p className="text-sm font-bold">{user.username}</p>
                <p className="truncate text-[12px] text-dim">{user.email}</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-surface p-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-dim">
                      Balance
                    </p>
                    <p className="text-sm font-bold">{usd(user.balance)}</p>
                  </div>
                  <div className="rounded-xl bg-surface p-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-dim">
                      Points
                    </p>
                    <p className="text-sm font-bold">{user.points.toLocaleString()}</p>
                  </div>
                </div>
              </div>
              <div className="p-2">
                <MenuLink href="/vault" icon={<ShieldCheck size={16} />} onGo={() => setMenuOpen(false)}>
                  My vault
                </MenuLink>
                <MenuLink href="/vault?tab=orders" icon={<Wallet size={16} />} onGo={() => setMenuOpen(false)}>
                  Orders & offers
                </MenuLink>
                <MenuLink href="/packs" icon={<Sparkles size={16} />} onGo={() => setMenuOpen(false)}>
                  Open a pack
                </MenuLink>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    resetDemo();
                  }}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium text-muted transition hover:bg-white/5 hover:text-white"
                >
                  <RotateCcw size={16} />
                  Reset demo data
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    logout();
                  }}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium text-muted transition hover:bg-white/5 hover:text-white"
                >
                  <LogOut size={16} />
                  Sign out
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setAuthOpen(true)}>
            Log in
          </Button>
          <Button size="sm" onClick={() => setAuthOpen(true)}>
            Sign up
          </Button>
        </div>
      )}
    </header>
  );
}

function MenuLink({
  href,
  icon,
  children,
  onGo,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  onGo: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onGo}
      className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium text-muted transition hover:bg-white/5 hover:text-white"
    >
      {icon}
      {children}
    </Link>
  );
}

function GlobalSearch() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, []);

  const results = q.trim().length >= 2
    ? LISTINGS.filter((l) => l.title.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 6)
    : [];

  return (
    <div className="relative mx-auto max-w-xl" ref={boxRef}>
      <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-dim" />
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && q.trim()) {
            setOpen(false);
            router.push(`/marketplace?q=${encodeURIComponent(q.trim())}`);
          }
        }}
        placeholder={`Search ${BRAND.name} — set, player, grade…`}
        className={`${inputClass} h-10 pl-10`}
      />
      {open && results.length ? (
        <div className="pop-in absolute left-0 right-0 top-12 z-50 overflow-hidden rounded-2xl border border-hairline bg-[#0d0d11] shadow-2xl">
          {results.map((l) => (
            <Link
              key={l.id}
              href={`/asset/${l.id}`}
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 border-b border-hairline px-3.5 py-2.5 last:border-0 hover:bg-white/5"
            >
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{l.title}</span>
              <span className="shrink-0 text-[13px] font-bold">{usd(l.price)}</span>
            </Link>
          ))}
          <button
            onClick={() => {
              setOpen(false);
              router.push(`/marketplace?q=${encodeURIComponent(q.trim())}`);
            }}
            className="w-full px-3.5 py-2.5 text-left text-[12px] font-semibold text-accent hover:bg-white/5"
          >
            See all results for “{q.trim()}”
          </button>
        </div>
      ) : null}
    </div>
  );
}
