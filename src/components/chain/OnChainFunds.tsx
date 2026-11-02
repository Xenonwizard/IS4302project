"use client";

import clsx from "clsx";
import { ArrowDownToLine, ArrowUpFromLine, Coins } from "lucide-react";
import { useState } from "react";
import { chain, contracts, toUsdcUnits } from "@/lib/chain/config";
import { useOnchainAccount } from "@/lib/chain/useOnchainAccount";
import { useChainTx } from "@/lib/chain/useChainTx";
import { usd } from "@/lib/format";
import { useStore } from "@/lib/store";
import { Button, inputClass } from "../ui/primitives";

type Mode = "deposit" | "withdraw";

/**
 * Account onboarding (money in) and offboarding (money out):
 *   MockUSDC.faucet                          test USDC into the wallet
 *   MockUSDC.approve + AccountRegistry.deposit
 *                                            wallet → Pokechain custody
 *   AccountRegistry.withdraw                 custody → wallet
 * Every move is mirrored into the wallet history below with its transaction hash.
 */
export function OnChainFunds() {
  const acct = useOnchainAccount();
  const { send } = useChainTx();
  const { recordChainCash, pushToast } = useStore();
  const [mode, setMode] = useState<Mode>("deposit");
  const [amount, setAmount] = useState("250");
  const [busy, setBusy] = useState<string | null>(null);

  const value = Number(amount);
  const valid = Number.isFinite(value) && value > 0;
  const max = mode === "deposit" ? acct.walletUsdc : acct.custodyBalance;

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
      await acct.refetch();
    } catch (e) {
      pushToast({ title: "Transaction failed", body: (e as Error).message, tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const faucet = () =>
    run("faucet", async () => {
      await send({ contract: "usdc", functionName: "faucet", args: [toUsdcUnits(10000)], label: "Mint test USDC" });
      pushToast({ title: "10,000 test USDC minted to your wallet", tone: "success" });
    });

  const deposit = () =>
    run("move", async () => {
      const units = toUsdcUnits(value);
      if (acct.allowance < value) {
        await send({ contract: "usdc", functionName: "approve", args: [contracts.accounts.address, units], label: "Approve USDC" });
      }
      const receipt = await send({ contract: "accounts", functionName: "deposit", args: [units], label: "Deposit USDC" });
      const hash = receipt.transactionHash;
      recordChainCash(value, "USDC deposited from your wallet", hash);
      pushToast({ title: `${usd(value, { cents: true })} deposited`, body: "It's now in your Pokechain account.", tone: "success" });
    });

  const withdraw = () =>
    run("move", async () => {
      const receipt = await send({ contract: "accounts", functionName: "withdraw", args: [toUsdcUnits(value)], label: "Withdraw USDC" });
      recordChainCash(-value, "USDC withdrawn to your wallet", receipt.transactionHash);
      pushToast({ title: `${usd(value, { cents: true })} sent to your wallet`, tone: "success" });
    });

  return (
    <section className="rounded-card border border-accent/30 bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-5 py-3.5">
        <h2 className="text-[14px] font-bold">USDC on {chain.name}</h2>
        <Button size="sm" variant="secondary" onClick={faucet} disabled={busy !== null}>
          <Coins size={14} />
          {busy === "faucet" ? "Minting…" : "Mint 10,000 test USDC"}
        </Button>
      </header>

      <div className="grid gap-3 p-5 sm:grid-cols-3">
        <Balance label="In your wallet" value={acct.walletUsdc} hint="Wallet USDC balance" />
        <Balance label="In your Pokechain account" value={acct.custodyBalance} hint="Available to spend on Pokechain" accent />
        <div className="rounded-xl bg-[#101014] p-3.5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-dim">Gas</p>
          <p className="mt-1 text-lg font-bold">
            {acct.gasBalance.toFixed(3)} {acct.gasSymbol}
          </p>
        </div>
      </div>

      <div className="border-t border-hairline px-5 py-4">
        <div className="flex w-fit rounded-xl bg-[#101014] p-1">
          {(["deposit", "withdraw"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={clsx("flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold", mode === m ? "bg-surface-3 text-white" : "text-muted")}
            >
              {m === "deposit" ? <ArrowDownToLine size={14} /> : <ArrowUpFromLine size={14} />}
              {m === "deposit" ? "Deposit" : "Withdraw"}
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <div className="relative w-44">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-dim">$</span>
            <input className={clsx(inputClass, "pl-7")} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" />
          </div>
          <Button variant="ghost" size="md" onClick={() => setAmount(String(Math.floor(max * 100) / 100))}>
            Max {usd(max, { cents: true })}
          </Button>
          <Button onClick={mode === "deposit" ? deposit : withdraw} disabled={!valid || value > max || busy !== null}>
            {busy === "move" ? "Confirm in your wallet…" : mode === "deposit" ? "Deposit" : "Withdraw"}
          </Button>
        </div>

      </div>
    </section>
  );
}

function Balance({ label, value, hint, accent }: { label: string; value: number; hint: string; accent?: boolean }) {
  return (
    <div className={clsx("rounded-xl p-3.5", accent ? "bg-accent/10" : "bg-[#101014]")}>
      <p className="text-[11px] font-bold uppercase tracking-wide text-dim">{label}</p>
      <p className="mt-1 text-lg font-bold">{usd(value, { cents: true })}</p>
      <p className="mt-0.5 font-mono text-[10.5px] text-dim">{hint}</p>
    </div>
  );
}
