"use client";

import clsx from "clsx";
import Link from "next/link";
import { ArrowLeftRight, Banknote, Check, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { useOnchainAccount } from "@/lib/chain/useOnchainAccount";
import { getListing } from "@/lib/catalog";
import { usd } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { Listing, TradeBid } from "@/lib/types";
import { Slab } from "../slab/Slab";
import { Button, inputClass } from "../ui/primitives";

const cents = (n: number) => Math.round(n * 100) / 100;
/** Always show cents here, so the breakdown visibly adds up. */
const exact = (n: number) => usd(n, { cents: true });

/**
 * Builds an offer that is either full cash or slabs plus a cash top-up. For a
 * trade the buyer picks slabs and separately chooses the cash to add.
 */
export function DealBuilder({
  listing,
  presets,
  submitLabel,
  onSubmit,
}: {
  listing: Listing;
  presets: { label: string; value: number }[];
  submitLabel: (value: number) => React.ReactNode;
  onSubmit: (bid: TradeBid, availableFunds?: number) => boolean;
}) {
  const { vault, balance, resolve, topUp, user } = useStore();
  const acct = useOnchainAccount();
  const [kind, setKind] = useState<"cash" | "trade">("cash");
  const [target, setTarget] = useState("");
  const [picked, setPicked] = useState<string[]>([]);

  const availableBalance = user?.address
    ? Math.max(acct.walletUsdc + acct.custodyBalance, balance)
    : balance;

  const mySlabs = useMemo(
    () =>
      vault
        .filter((v) => v.status === "Vaulted" && v.listingId !== listing.id)
        .map((v) => getListing(v.listingId))
        .filter((l): l is Listing => Boolean(l))
        .map(resolve),
    [vault, listing.id, resolve],
  );

  const targetValue = cents(Number(target) || 0);
  const slabs = kind === "trade" ? mySlabs.filter((l) => picked.includes(l.id)) : [];
  const cash = targetValue;
  const total = cash;
  const after = cents(availableBalance - cash);
  const short = after < 0;
  const topUpBy = Math.ceil(-after / 100) * 100;
  const needsSlab = kind === "trade" && slabs.length === 0;
  const blocked = !Number.isFinite(Number(target)) || (cash <= 0 && !slabs.length) || short || needsSlab;

  const submit = () => {
    if (blocked) return;
    if (onSubmit({ cash, slabIds: slabs.map((l) => l.id) }, availableBalance)) {
      setTarget("");
      setPicked([]);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1">
        {(
          [
            ["cash", "Full cash", <Banknote key="c" size={14} />],
            ["trade", "Trade + Cash", <ArrowLeftRight key="t" size={14} />],
          ] as const
        ).map(([value, label, icon]) => (
          <button
            key={value}
            type="button"
            onClick={() => setKind(value)}
            className={clsx(
              "flex h-9 items-center justify-center gap-1.5 rounded-lg text-[12px] font-bold transition",
              kind === value ? "bg-accent text-white" : "text-muted hover:text-white",
            )}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>

      <div>
        <p className="mb-1.5 text-[12px] font-semibold text-muted">
          {kind === "cash" ? "Cash offer" : "Cash to add to your slabs"}
        </p>
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-[150px] flex-1">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
            <input
              className={`${inputClass} pl-7 font-bold`}
              inputMode="decimal"
              placeholder="0.00"
              value={target}
              onChange={(e) => setTarget(e.target.value.replace(/[^\d.]/g, ""))}
            />
          </div>
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => setTarget(String(cents(p.value)))}
              className="h-11 rounded-xl bg-surface-2 px-3 text-[12px] font-semibold text-muted transition hover:bg-surface-3 hover:text-white"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {kind === "trade" ? (
        mySlabs.length ? (
          <div>
            <p className="mb-1.5 text-[12px] font-semibold text-muted">
              Slabs to trade <span className="font-normal text-dim">· agree their value with the seller</span>
            </p>
            <div className="cy-scroll flex gap-2 overflow-x-auto pb-1">
              {mySlabs.map((l) => {
                const on = picked.includes(l.id);
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() =>
                      setPicked((p) => (p.includes(l.id) ? p.filter((x) => x !== l.id) : [...p, l.id]))
                    }
                    className={clsx(
                      "relative flex w-[156px] shrink-0 items-center gap-2 rounded-xl border p-2 text-left transition",
                      on ? "border-accent bg-accent/10" : "border-hairline bg-surface-2 hover:bg-surface-3",
                    )}
                  >
                    <span className="w-7 shrink-0">
                      <Slab listing={l} flat />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[11px] font-semibold">{l.shortName}</span>
                      <span className="block text-[11px] text-muted">
                        {l.grader} {l.grade}
                      </span>
                    </span>
                    {on ? (
                      <span className="absolute right-1.5 top-1.5 grid h-4 w-4 place-items-center rounded-full bg-accent text-white">
                        <Check size={10} />
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="rounded-xl bg-surface-2 p-3 text-[12px] text-muted">
            You have no vaulted slabs to trade.{" "}
            <Link href="/submit" className="font-semibold text-accent hover:underline">
              Vault a graded slab
            </Link>{" "}
            or switch to full cash.
          </p>
        )
      ) : null}

      {/* how the cash is worked out, then what it does to the wallet */}
      <div className="rounded-2xl bg-surface p-3.5 text-[13px]">
        <dl className="space-y-2">
          {kind === "trade" ? <Line label="Slabs included" value={String(slabs.length)} /> : null}
          <Line label="Cash you pay" value={exact(cash)} strong />
        </dl>

        <div className="my-3 h-px bg-hairline" />

        <dl className="space-y-2">
          <Line
            label={
              <span className="flex items-center gap-1.5">
                <Wallet size={13} /> {user?.address ? "PokeCredits balance" : "Wallet balance"}
                <Link href="/wallet" className="text-[11px] font-semibold text-accent hover:underline">
                  see history
                </Link>
              </span>
            }
            value={exact(availableBalance)}
          />
          <Line label="Cash you pay" value={`− ${exact(cash)}`} />
          <Line
            label="Left in wallet if accepted"
            value={short ? `− ${exact(-after)}` : exact(after)}
            strong
            tone={short ? "bad" : undefined}
          />
        </dl>
      </div>

      {short ? (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-warn/10 p-3">
          <p className="text-[12px] text-warn">
            Your wallet is {exact(-after)} short of the cash.{" "}
            {user?.address
              ? "Lower the offer or get more PokeCredits available."
              : kind === "trade"
              ? "Lower the cash amount or top up."
              : "Lower the offer or top up."}
          </p>
          {user?.address ? (
            <Link href="/wallet">
              <Button size="sm" variant="secondary">
                Go to Wallet
              </Button>
            </Link>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => topUp(topUpBy)}>
              Top up {usd(topUpBy)}
            </Button>
          )}
        </div>
      ) : null}

      <Button size="lg" className="w-full" disabled={blocked} onClick={submit}>
        {kind === "trade" ? `Send offer · ${slabs.length} slab${slabs.length === 1 ? "" : "s"} + ${exact(cash)}` : submitLabel(total)}
      </Button>
    </div>
  );
}

function Line({
  label,
  value,
  strong,
  indent,
  tone,
}: {
  label: React.ReactNode;
  value: string;
  strong?: boolean;
  indent?: boolean;
  tone?: "bad";
}) {
  return (
    <div className={clsx("flex items-center justify-between gap-3", indent && "pl-3")}>
      <dt className={clsx("text-muted", indent && "text-[12px]")}>{label}</dt>
      <dd
        className={clsx(
          strong ? "font-bold" : "font-semibold",
          indent && "text-[12px] text-muted",
          tone === "bad" && "text-bad",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
