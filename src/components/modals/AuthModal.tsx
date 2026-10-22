"use client";

import { useConnectModal } from "@rainbow-me/rainbowkit";
import { AlertTriangle, ChevronDown, Fuel, Wallet } from "lucide-react";
import { useState } from "react";
import { useDisconnect } from "wagmi";
import { BRAND } from "@/lib/brand";
import { IS_LOCAL, chain, shortHash } from "@/lib/chain/config";
import { useOnchainAccount } from "@/lib/chain/useOnchainAccount";
import { useChainTx } from "@/lib/chain/useChainTx";
import { useStore } from "@/lib/store";
import { Fn, OnChainNote, Step, type StepState } from "../chain/ui";
import { Button, Field, Modal, inputClass } from "../ui/primitives";

/**
 * Account onboarding. Three steps, each one visible on-chain:
 *   1. connect a wallet (RainbowKit)                    the wallet address is the account id
 *   2. be on the right chain with gas to pay fees
 *   3. AccountRegistry.register(handle)                  the account now exists on-chain
 * ChainSessionSync then signs the app in as that handle.
 */
export function AuthModal() {
  const { authOpen, setAuthOpen } = useStore();
  return (
    <Modal open={authOpen} onClose={() => setAuthOpen(false)} title={`Join ${BRAND.name}`}>
      <Onboarding />
    </Modal>
  );
}

function Onboarding() {
  const acct = useOnchainAccount();
  const { send, operator, ensureChain } = useChainTx();
  const { openConnectModal } = useConnectModal();
  const { disconnect } = useDisconnect();
  const { pushToast } = useStore();
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState<"gas" | "register" | "switch" | null>(null);
  const [error, setError] = useState("");

  const hasGas = acct.gasBalance > 0;
  const s1: StepState = acct.isConnected ? "done" : "active";
  const s2: StepState = !acct.isConnected ? "todo" : !acct.wrongChain && hasGas ? "done" : busy === "gas" || busy === "switch" ? "busy" : "active";
  const s3: StepState = s2 !== "done" ? "todo" : acct.status === "Active" ? "done" : busy === "register" ? "busy" : "active";

  const getGas = async () => {
    if (!acct.address) return;
    setBusy("gas");
    try {
      await operator("Test gas for a new wallet", "/api/chain/faucet", { address: acct.address });
      await acct.refetch();
    } catch (e) {
      pushToast({ title: "Faucet failed", body: (e as Error).message, tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const register = async (e: React.FormEvent) => {
    e.preventDefault();
    const h = handle.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(h)) {
      setError("3 to 20 characters: a-z, 0-9 or _.");
      return;
    }
    setError("");
    setBusy("register");
    try {
      await send({ contract: "accounts", functionName: "register", args: [h], label: "Open account" });
      await acct.refetch();
      pushToast({ title: "Account opened on-chain", body: `@${h} is registered to ${shortHash(acct.address!)}.`, tone: "success" });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5 p-5">
      {!acct.reachable ? (
        <div className="flex gap-2.5 rounded-xl border border-warn/30 bg-warn/10 p-3 text-[12.5px] text-warn">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            {IS_LOCAL
              ? "The local blockchain isn't running, so nothing can be sent yet. Start it in a terminal with npm run chain (it also deploys the contracts), then try again."
              : `Can't reach ${chain.name}.`}
          </span>
        </div>
      ) : !acct.deployed ? (
        <div className="flex gap-2.5 rounded-xl border border-warn/30 bg-warn/10 p-3 text-[12.5px] text-warn">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            The Pokechain contracts aren&apos;t on {chain.name}. {IS_LOCAL ? "Start the chain with npm run chain, which also deploys them." : "Run npm run deploy:amoy."}
          </span>
        </div>
      ) : null}

      <ol className="space-y-4">
        <Step n={1} title={acct.isConnected ? `Wallet connected · ${shortHash(acct.address!)}` : "Connect a wallet"} state={s1}>
          <Button className="w-full" size="lg" onClick={openConnectModal}>
            <Wallet size={17} />
            Connect wallet
          </Button>
          <OnChainNote>
            Nothing yet. Your wallet address becomes your account id. MetaMask holds the private
            key, and {BRAND.name} never sees it.
            {IS_LOCAL ? " For a quick demo, pick a Hardhat test collector." : ""}
          </OnChainNote>
        </Step>
        {acct.isConnected && acct.status !== "Active" ? (
          <button onClick={() => disconnect()} className="-mt-2 ml-10 text-[12px] font-semibold text-accent hover:underline">
            Use a different wallet
          </button>
        ) : null}

        <Step n={2} title={acct.wrongChain ? `Switch to ${chain.name}` : hasGas || !acct.isConnected ? "Network and gas" : `Get ${acct.gasSymbol} for gas`} state={s2}>
          {acct.wrongChain ? (
            <Button
              className="w-full"
              onClick={async () => {
                setBusy("switch");
                try {
                  await ensureChain();
                } catch (e) {
                  pushToast({ title: "Could not switch network", body: (e as Error).message, tone: "error" });
                } finally {
                  setBusy(null);
                }
              }}
            >
              Switch network
            </Button>
          ) : IS_LOCAL ? (
            <Button className="w-full" onClick={getGas} disabled={busy === "gas" || !acct.reachable}>
              <Fuel size={15} />
              Send me 10 test ETH
            </Button>
          ) : (
            <a href="https://faucet.polygon.technology/" target="_blank" rel="noreferrer">
              <Button className="w-full">
                <Fuel size={15} />
                Get Amoy POL from the Polygon faucet
              </Button>
            </a>
          )}
          <OnChainNote>
            Every transaction pays a small gas fee in the chain&apos;s native coin ({acct.gasSymbol}).{" "}
            {IS_LOCAL
              ? "The local Hardhat chain has no public faucet, so the vault operator sends you 10 test ETH."
              : "Amoy POL is free from the faucet."}
          </OnChainNote>
        </Step>

        <Step n={3} title={acct.status === "Active" ? `Account @${acct.handle} is open` : "Open your account on-chain"} state={s3}>
          <form onSubmit={register} className="space-y-3">
            <Field label="Handle" hint={acct.status === "Closed" ? `This wallet closed @${acct.handle}. You can reopen it under that handle or a new one.` : "Lowercase letters, numbers and _. Unique across Pokechain, forever."}>
              <input
                className={inputClass}
                value={handle}
                onChange={(e) => setHandle(e.target.value.toLowerCase())}
                placeholder="vaultedcharizard"
                autoComplete="off"
              />
            </Field>
            {error ? <p className="text-[13px] font-medium text-bad">{error}</p> : null}
            <Button type="submit" className="w-full" size="lg" disabled={busy === "register" || !acct.reachable}>
              {busy === "register" ? "Confirm in your wallet…" : "Open account"}
            </Button>
          </form>
          <OnChainNote>
            Calls <Fn>AccountRegistry.register(handle)</Fn>. The contract checks the handle (3 to 20
            characters of a-z, 0-9 or _) and that nobody has claimed it. It then stores your account
            as <b className="text-white">Active</b> and emits <Fn>AccountOpened</Fn>. The handle
            stays reserved to your address, even after you close the account.
          </OnChainNote>
        </Step>
      </ol>

      <DemoLogin />
    </div>
  );
}

/** The old off-chain handle login, kept so the trading demo still works without a wallet. */
function DemoLogin() {
  const { login } = useStore();
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  return (
    <div className="border-t border-hairline pt-4">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between text-[12px] font-semibold text-dim hover:text-muted">
        Explore without a wallet (off-chain demo account)
        <ChevronDown size={14} className={open ? "rotate-180" : ""} />
      </button>
      {open ? (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const h = username.trim().replace(/\s+/g, "");
            if (h.length >= 3) login(h);
          }}
        >
          <input className={inputClass} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="demotester" autoComplete="off" />
          <Button type="submit" variant="secondary">
            Enter
          </Button>
        </form>
      ) : null}
    </div>
  );
}
