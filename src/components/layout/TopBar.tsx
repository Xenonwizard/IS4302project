"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  LogOut,
  RotateCcw,
  Search,
  ShieldCheck,
  MessagesSquare,
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
      <span>Make an offer on any slab and negotiate 1-to-1 with the seller.</span>
      <Link href="/marketplace" className="text-accent underline-offset-2 hover:underline">
        Browse slabs →
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
  const { user, balance, logout, setAuthOpen, resetDemo } = useStore();
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
                <Link
                  href="/wallet"
                  onClick={() => setMenuOpen(false)}
                  className="mt-3 block rounded-xl bg-surface p-2.5 transition hover:bg-surface-2"
                >
                  <p className="text-[10px] font-bold uppercase tracking-wide text-dim">Wallet balance</p>
                  <p className="text-sm font-bold">{usd(balance, { cents: true })}</p>
                  <p className="mt-0.5 text-[11px] text-accent">See history →</p>
                </Link>
              </div>
              <div className="p-2">
                <MenuLink href="/vault" icon={<ShieldCheck size={16} />} onGo={() => setMenuOpen(false)}>
                  Vault
                </MenuLink>
                <MenuLink href="/wallet" icon={<Wallet size={16} />} onGo={() => setMenuOpen(false)}>
                  Wallet
                </MenuLink>
                <MenuLink href="/trades" icon={<MessagesSquare size={16} />} onGo={() => setMenuOpen(false)}>
                  Negotiation rooms
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
        placeholder={`Search ${BRAND.name} — Pokémon, set, grade…`}
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
