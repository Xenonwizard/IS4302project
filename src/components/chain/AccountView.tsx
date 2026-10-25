"use client";

import Link from "next/link";
import { CheckCircle2, CircleAlert, LogOut, UserRound, Wallet } from "lucide-react";
import { useState } from "react";
import { BRAND } from "@/lib/brand";
import { chain, contracts, shortHash } from "@/lib/chain/config";
import { useOnchainAccount } from "@/lib/chain/useOnchainAccount";
import { useChainTx } from "@/lib/chain/useChainTx";
import { usd } from "@/lib/format";
import { useStore } from "@/lib/store";
import { Badge, Button } from "../ui/primitives";
import { LoginPrompt } from "../vault/shared";
import { ChainHistory } from "./ChainHistory";
import { CopyText } from "./ChainConsole";
import { Fn } from "./ui";

/** /account: the on-chain account record, offboarding (close account) and the event history. */
export function AccountView() {
  const { user, ready, setAuthOpen } = useStore();
  const acct = useOnchainAccount();

  if (!ready) {
    return (
      <div className="mx-auto max-w-xl space-y-4 px-4 py-10">
        <div className="skeleton h-10 w-48 rounded-xl" />
        <div className="skeleton h-32 w-full rounded-2xl" />
      </div>
    );
  }

  if (!user) {
    return <LoginPrompt icon={<UserRound size={26} />} title="Account" body="Connect a wallet to see your on-chain account." />;
  }
  if (!user.address || !acct.address) {
    return (
      <div className="mx-auto max-w-xl space-y-4 px-4 py-10 text-center">
        <h1 className="text-[22px] font-bold">@{user.username} is an off-chain demo account</h1>
        <p className="text-[13px] text-muted">
          It lives only in this browser. Open an on-chain account with a wallet to register a handle in{" "}
          <Fn>AccountRegistry</Fn>, deposit Pokechain credits and tokenise slabs.
        </p>
        <Button onClick={() => setAuthOpen(true)}>
          <Wallet size={15} /> Open an on-chain account
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-5 lg:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-bold">@{acct.handle || user.username}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-muted">
            <CopyText text={acct.address} /> · {chain.name}
            <Badge tone={acct.status === "Active" ? "good" : "warn"}>{acct.status}</Badge>
          </p>
        </div>
        <Link href="/wallet">
          <Button variant="secondary" size="sm">
            <Wallet size={14} /> Deposit or withdraw Pokechain credits
          </Button>
        </Link>
      </div>

      <CloseAccount acct={acct} />
      <ChainHistory address={acct.address} />
    </div>
  );
}

type Acct = ReturnType<typeof useOnchainAccount>;

/** Offboarding: AccountRegistry.closeAccount() refunds the custody balance and marks the account Closed. */
function CloseAccount({ acct }: { acct: Acct }) {
  const { send } = useChainTx();
  const { recordChainCash, offboard, pushToast } = useStore();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  if (acct.status !== "Active") return null;

  const slabsClear = acct.vaultedCount === 0;

  const close = async () => {
    setBusy(true);
    const refund = acct.custodyBalance;
    try {
      const receipt = await send({ contract: "accounts", functionName: "closeAccount", args: [], label: "Close account" });
      if (refund > 0) recordChainCash(-refund, "Refund on account close (to your wallet)", receipt.transactionHash);
      // Refetch first, so the session sync sees Closed and doesn't sign straight back in.
      await acct.refetch();
      offboard();
    } catch (e) {
      pushToast({ title: "Could not close the account", body: (e as Error).message, tone: "error" });
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };

  return (
    <section className="rounded-card border border-bad/25 bg-surface p-4">
      <h2 className="flex items-center gap-2 text-[14px] font-bold">
        <LogOut size={15} /> Close account (offboarding)
      </h2>
      <ul className="mt-3 space-y-2 text-[13px]">
        <li className="flex items-start gap-2">
          {slabsClear ? <CheckCircle2 size={16} className="mt-0.5 text-good" /> : <CircleAlert size={16} className="mt-0.5 text-warn" />}
          <span>
            {slabsClear ? "No slabs left in the vault." : `${acct.vaultedCount} slab${acct.vaultedCount === 1 ? " is" : "s are"} still in the vault. `}
            {!slabsClear ? (
              <Link href="/vault" className="text-accent hover:underline">
                Withdraw them first
              </Link>
            ) : null}
          </span>
        </li>
        <li className="flex items-start gap-2">
          <CheckCircle2 size={16} className="mt-0.5 text-good" />
          <span>
            {acct.custodyBalance > 0
              ? `${usd(acct.custodyBalance, { cents: true })} Pokechain credits go back to ${shortHash(acct.address!)} in the same transaction.`
              : "No Pokechain credits in custody to refund."}
          </span>
        </li>
      </ul>
      <div className="mt-3 flex gap-2">
        {confirm ? (
          <>
            <Button variant="danger" onClick={close} disabled={busy}>
              {busy ? "Confirm in your wallet…" : `Yes, close @${acct.handle}`}
            </Button>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button variant="danger" onClick={() => setConfirm(true)} disabled={!slabsClear}>
            Close account
          </Button>
        )}
      </div>
      <p className="mt-2 text-[11px] text-dim">
        {BRAND.name} never holds your keys. Contract: <CopyText text={contracts.accounts.address} />
      </p>
    </section>
  );
}
