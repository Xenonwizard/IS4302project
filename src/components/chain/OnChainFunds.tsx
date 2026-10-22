"use client";

import clsx from "clsx";
import { ArrowDownToLine, ArrowUpFromLine, Coins } from "lucide-react";
import { useState } from "react";
import { parseSignature } from "viem";
import { usePublicClient, useSignTypedData } from "wagmi";
import { chain, contracts, toUsdcUnits } from "@/lib/chain/config";
import { useOnchainAccount } from "@/lib/chain/useOnchainAccount";
import { useChainTx } from "@/lib/chain/useChainTx";
import { usd } from "@/lib/format";
import { useStore } from "@/lib/store";
import { Button, inputClass } from "../ui/primitives";
import { Fn, OnChainNote } from "./ui";

type Mode = "deposit" | "withdraw";

/**
 * Account onboarding (money in) and offboarding (money out):
 *   MockUSDC.faucet                          test dollars into the wallet
 *   EIP-2612 permit signature + AccountRegistry.depositWithPermit
 *                                            wallet → Pokechain custody in one transaction
 *   MockUSDC.approve + AccountRegistry.deposit
 *                                            the classic two-transaction way
 *   AccountRegistry.withdraw                 custody → wallet
 * Every move is mirrored into the wallet history below with its transaction hash.
 */
export function OnChainFunds() {
  const acct = useOnchainAccount();
  const { send, sign } = useChainTx();
  const client = usePublicClient();
  const { signTypedDataAsync } = useSignTypedData();
  const { recordChainCash, pushToast } = useStore();
  const [mode, setMode] = useState<Mode>("deposit");
  const [amount, setAmount] = useState("250");
  const [usePermit, setUsePermit] = useState(true);
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
      await send({ contract: "usdc", functionName: "faucet", args: [toUsdcUnits(1000)], label: "Mint test USDC" });
      pushToast({ title: "1,000 test USDC minted to your wallet", tone: "success" });
    });

  const deposit = () =>
    run("move", async () => {
      const units = toUsdcUnits(value);
      let hash: `0x${string}`;
      if (usePermit) {
        // Off-chain: sign the EIP-712 Permit struct. No gas, nothing broadcast.
        const owner = acct.address!;
        const nonce = await client!.readContract({ ...contracts.usdc, functionName: "nonces", args: [owner] });
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
        const signature = await sign(
          "Authorise deposit",
          "EIP-712 Permit (MockUSDC)",
          [`spender ${contracts.accounts.address}`, `value ${units}`, `nonce ${nonce}`, `deadline ${deadline}`],
          () =>
            signTypedDataAsync({
              domain: { name: "Pokechain Test USD Coin", version: "1", chainId: chain.id, verifyingContract: contracts.usdc.address },
              types: {
                Permit: [
                  { name: "owner", type: "address" },
                  { name: "spender", type: "address" },
                  { name: "value", type: "uint256" },
                  { name: "nonce", type: "uint256" },
                  { name: "deadline", type: "uint256" },
                ],
              },
              primaryType: "Permit",
              message: { owner, spender: contracts.accounts.address, value: units, nonce, deadline },
            }),
        );
        const { r, s, v, yParity } = parseSignature(signature);
        const receipt = await send({
          contract: "accounts",
          functionName: "depositWithPermit",
          args: [units, deadline, Number(v ?? BigInt(27 + yParity)), r, s],
          label: "Deposit USDC",
        });
        hash = receipt.transactionHash;
      } else {
        if (acct.allowance < value) {
          await send({ contract: "usdc", functionName: "approve", args: [contracts.accounts.address, units], label: "Approve USDC" });
        }
        const receipt = await send({ contract: "accounts", functionName: "deposit", args: [units], label: "Deposit USDC" });
        hash = receipt.transactionHash;
      }
      recordChainCash(value, "USDC deposit from your wallet", hash);
      pushToast({ title: `${usd(value, { cents: true })} deposited`, body: "It's now in your Pokechain account.", tone: "success" });
    });

  const withdraw = () =>
    run("move", async () => {
      const receipt = await send({ contract: "accounts", functionName: "withdraw", args: [toUsdcUnits(value)], label: "Withdraw USDC" });
      recordChainCash(-value, "USDC withdrawal to your wallet", receipt.transactionHash);
      pushToast({ title: `${usd(value, { cents: true })} sent to your wallet`, tone: "success" });
    });

  return (
    <section className="rounded-card border border-accent/30 bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-5 py-3.5">
        <h2 className="text-[14px] font-bold">USDC on {chain.name}</h2>
        <Button size="sm" variant="secondary" onClick={faucet} disabled={busy !== null}>
          <Coins size={14} />
          {busy === "faucet" ? "Minting…" : "Mint 1,000 test USDC"}
        </Button>
      </header>

      <div className="grid gap-3 p-5 sm:grid-cols-3">
        <Balance label="In your wallet" value={acct.walletUsdc} hint="MockUSDC.balanceOf(you)" />
        <Balance label="In your Pokechain account" value={acct.custodyBalance} hint="AccountRegistry.balanceOf(you)" accent />
        <div className="rounded-xl bg-[#101014] p-3.5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-dim">Gas</p>
          <p className="mt-1 text-lg font-bold">
            {acct.gasBalance.toFixed(3)} {acct.gasSymbol}
          </p>
          <p className="mt-0.5 font-mono text-[10.5px] text-dim">eth_getBalance(you)</p>
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

        {mode === "deposit" ? (
          <label className="mt-3 flex items-center gap-2 text-[12.5px] text-muted">
            <input type="checkbox" checked={usePermit} onChange={(e) => setUsePermit(e.target.checked)} className="accent-[#2f5bf9]" />
            One-step deposit with an EIP-2612 permit signature
          </label>
        ) : null}

        <div className="mt-3">
          <OnChainNote>
            {mode === "withdraw" ? (
              <>
                Calls <Fn>AccountRegistry.withdraw(amount)</Fn>. The contract lowers your custody balance
                first, then sends the USDC (checks-effects-interactions, plus a <Fn>nonReentrant</Fn> guard),
                and emits <Fn>Withdrawn</Fn>. It works even after the account is closed, so funds can&apos;t get stuck.
              </>
            ) : usePermit ? (
              <>
                1. Your wallet signs an EIP-712 <Fn>Permit</Fn> message. It costs no gas and nothing is sent.
                <br />
                2. <Fn>AccountRegistry.depositWithPermit(amount, deadline, v, r, s)</Fn> hands that signature
                to <Fn>MockUSDC.permit</Fn>, which sets the allowance. It then pulls the USDC with{" "}
                <Fn>transferFrom</Fn>, all in one transaction.
              </>
            ) : (
              <>
                1. <Fn>MockUSDC.approve(AccountRegistry, amount)</Fn> lets the registry move your USDC.
                <br />
                2. <Fn>AccountRegistry.deposit(amount)</Fn> pulls it in with <Fn>transferFrom</Fn> and
                credits your custody balance. Two transactions and two gas fees. Tick the permit box to
                see the one-step way.
              </>
            )}
          </OnChainNote>
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
