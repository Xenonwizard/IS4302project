"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { usd } from "@/lib/format";
import { useStore } from "@/lib/store";
import { Slab } from "../slab/Slab";
import { Button, Drawer } from "../ui/primitives";

export function CartDrawer() {
  const { cartOpen, setCartOpen, cartListings, cartTotal, removeFromCart } = useStore();
  const router = useRouter();
  const fee = Math.round(cartTotal * 0.02 * 100) / 100;

  return (
    <Drawer
      open={cartOpen}
      onClose={() => setCartOpen(false)}
      title={`Cart (${cartListings.length})`}
      footer={
        cartListings.length ? (
          <div className="space-y-3">
            <Row label="Subtotal" value={usd(cartTotal)} />
            <Row label="Marketplace fee (2%)" value={usd(fee)} />
            <Row label="Total" value={usd(cartTotal + fee)} strong />
            <Button
              size="lg"
              className="w-full"
              onClick={() => {
                setCartOpen(false);
                router.push("/checkout");
              }}
            >
              Go to checkout
            </Button>
          </div>
        ) : null
      }
    >
      {cartListings.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="text-sm text-muted">Your cart is empty.</p>
          <Link href="/marketplace" onClick={() => setCartOpen(false)}>
            <Button variant="secondary">Browse the marketplace</Button>
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-[rgba(255,255,255,0.08)]">
          {cartListings.map((l) => (
            <li key={l.id} className="flex gap-3 p-4">
              <Link href={`/asset/${l.id}`} onClick={() => setCartOpen(false)} className="w-16 shrink-0">
                <Slab listing={l} flat />
              </Link>
              <div className="min-w-0 flex-1">
                <Link
                  href={`/asset/${l.id}`}
                  onClick={() => setCartOpen(false)}
                  className="line-clamp-2 text-[13px] font-semibold leading-snug hover:underline"
                >
                  {l.title}
                </Link>
                <p className="mt-1 text-[12px] text-dim">
                  FMV {usd(l.fmv)} · {l.grader} {l.grade}
                </p>
                <p className="mt-1.5 text-sm font-bold">{usd(l.price)}</p>
              </div>
              <button
                onClick={() => removeFromCart(l.id)}
                aria-label="Remove"
                className="self-start rounded-lg p-1.5 text-dim transition hover:bg-white/5 hover:text-bad"
              >
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className={strong ? "font-bold" : "text-muted"}>{label}</span>
      <span className={strong ? "text-base font-bold" : "font-semibold"}>{value}</span>
    </div>
  );
}
