"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CreditCard,
  Loader2,
  Lock,
  ShieldCheck,
  ShoppingCart,
  Truck,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import { BRAND } from "@/lib/brand";
import { usd } from "@/lib/format";
import { useStore } from "@/lib/store";
import { Slab } from "../slab/Slab";
import { Button, Field, inputClass } from "../ui/primitives";

export function CheckoutView() {
  const { cartListings, cartTotal, removeFromCart, checkout, user, requireAuth, topUp, pushToast } =
    useStore();
  const router = useRouter();
  const [method, setMethod] = useState<"card" | "usdc">("card");
  const [delivery, setDelivery] = useState<"vault" | "ship">("vault");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);

  const fee = Math.round(cartTotal * 0.02 * 100) / 100;
  const shipping = delivery === "ship" ? 14.5 : 0;
  const total = Math.round((cartTotal + fee + shipping) * 100) / 100;
  const short = method === "card" && (user?.balance ?? 0) < total;

  const place = () => {
    if (!requireAuth(() => place())) return;
    if (delivery === "ship" && address.trim().length < 8) {
      pushToast({ title: "Add a shipping address", tone: "error" });
      return;
    }
    if (short) {
      pushToast({ title: "Balance is short", body: "Top up or pay with USDC.", tone: "error" });
      return;
    }
    setBusy(true);
    window.setTimeout(() => {
      const order = checkout(method);
      setBusy(false);
      if (order) router.push("/checkout/success");
    }, 1600);
  };

  if (!cartListings.length) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-surface text-muted">
          <ShoppingCart size={26} />
        </span>
        <h1 className="text-xl font-bold">Your cart is empty</h1>
        <p className="max-w-sm text-sm text-muted">
          Add a slab from the marketplace and it will show up here.
        </p>
        <Link href="/marketplace">
          <Button size="lg">Browse the marketplace</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="px-4 py-5 lg:px-6">
      <h1 className="text-[24px] font-bold">Checkout</h1>

      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          {/* items */}
          <section className="overflow-hidden rounded-card border border-hairline bg-surface">
            <h2 className="border-b border-hairline px-4 py-3 text-sm font-bold">
              {cartListings.length} slab{cartListings.length === 1 ? "" : "s"}
            </h2>
            <ul className="divide-y divide-[rgba(255,255,255,0.08)]">
              {cartListings.map((l) => (
                <li key={l.id} className="flex items-center gap-4 p-4">
                  <Link href={`/asset/${l.id}`} className="w-14 shrink-0">
                    <Slab listing={l} flat />
                  </Link>
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/asset/${l.id}`}
                      className="line-clamp-2 text-[13px] font-semibold leading-snug hover:underline"
                    >
                      {l.title}
                    </Link>
                    <p className="mt-1 text-[12px] text-muted">
                      Cert {l.certNumber} · FMV {usd(l.fmv)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-bold">{usd(l.price)}</p>
                    <button
                      onClick={() => removeFromCart(l.id)}
                      className="mt-1 text-[12px] text-dim transition hover:text-bad"
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {/* payment */}
          <section className="rounded-card border border-hairline bg-surface p-4">
            <h2 className="text-sm font-bold">Payment</h2>
            <div className="mt-3 space-y-2">
              <Option
                active={method === "card"}
                onClick={() => setMethod("card")}
                icon={<CreditCard size={17} />}
                title="Vault balance"
                subtitle={user ? `${usd(user.balance)} available` : "Log in to use your balance"}
              />
              <Option
                active={method === "usdc"}
                onClick={() => setMethod("usdc")}
                icon={<Wallet size={17} />}
                title={`USDC on ${BRAND.chain}`}
                subtitle="Gasless settlement, one signature"
              />
            </div>
            {short ? (
              <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-warn/10 p-3.5">
                <p className="text-[12px] text-warn">
                  Short by {usd(total - (user?.balance ?? 0))}.
                </p>
                <Button size="sm" variant="secondary" onClick={() => topUp(5000)}>
                  Add $5,000
                </Button>
              </div>
            ) : null}
          </section>

          {/* delivery */}
          <section className="rounded-card border border-hairline bg-surface p-4">
            <h2 className="text-sm font-bold">Delivery</h2>
            <div className="mt-3 space-y-2">
              <Option
                active={delivery === "vault"}
                onClick={() => setDelivery("vault")}
                icon={<ShieldCheck size={17} />}
                title="Keep in the vault (free)"
                subtitle="Stays insured and instantly resellable"
              />
              <Option
                active={delivery === "ship"}
                onClick={() => setDelivery("ship")}
                icon={<Truck size={17} />}
                title="Ship the physical slab ($14.50)"
                subtitle="Tracked and insured courier, 5–8 business days"
              />
            </div>
            {delivery === "ship" ? (
              <div className="mt-4">
                <Field label="Shipping address">
                  <textarea
                    className={`${inputClass} h-24 resize-none py-2.5`}
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder={"21 Lower Kent Ridge Rd\nSingapore 119077"}
                  />
                </Field>
              </div>
            ) : null}
          </section>
        </div>

        {/* summary */}
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-card border border-hairline bg-surface p-4">
            <h2 className="text-sm font-bold">Order summary</h2>
            <div className="mt-4 space-y-2.5 text-[13px]">
              <Row label="Subtotal" value={usd(cartTotal)} />
              <Row label="Marketplace fee (2%)" value={usd(fee)} />
              <Row label="Shipping" value={shipping ? usd(shipping) : "Free"} />
              <div className="h-px bg-hairline" />
              <div className="flex items-center justify-between">
                <span className="font-bold">Total</span>
                <span className="text-lg font-bold">{usd(total)}</span>
              </div>
            </div>

            <Button size="lg" className="mt-5 w-full" onClick={place} disabled={busy}>
              {busy ? (
                <>
                  <Loader2 size={17} className="animate-spin" />
                  Settling on {BRAND.chain}…
                </>
              ) : (
                <>
                  <Lock size={16} />
                  Place order · {usd(total)}
                </>
              )}
            </Button>
            <p className="mt-3 text-[11px] leading-relaxed text-dim">
              Demo checkout — no real payment is taken. Ownership is recorded as an ERC-721 transfer
              on {BRAND.chain}.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Option({
  active,
  onClick,
  icon,
  title,
  subtitle,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-xl border p-3.5 text-left transition ${
        active ? "border-accent bg-accent/10" : "border-hairline bg-[#0f0f13] hover:bg-surface-2"
      }`}
    >
      <span className={active ? "text-accent" : "text-muted"}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold">{title}</span>
        <span className="block text-[12px] text-muted">{subtitle}</span>
      </span>
      <span
        className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border ${
          active ? "border-accent" : "border-white/25"
        }`}
      >
        {active ? <span className="h-2 w-2 rounded-full bg-accent" /> : null}
      </span>
    </button>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}
