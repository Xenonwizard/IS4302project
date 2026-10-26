"use client";

import clsx from "clsx";
import { useQuery } from "@tanstack/react-query";
import { Receipt } from "lucide-react";
import { isAddressEqual, type Address, type Hash } from "viem";
import { usePublicClient } from "wagmi";
import { CONTRACT_LABEL, DEPLOY_BLOCK, contracts, fromUsdcUnits, type ContractName } from "@/lib/chain/config";
import { shortDate, usd } from "@/lib/format";
import { CopyText } from "./ChainConsole";
import { Fn } from "./ui";

interface Payment {
  key: string;
  label: string;
  /** signed, in dollars: positive came into this Pokechain account */
  amount: number;
  call: string;
  at: number;
  block: bigint;
  tx: Hash;
}

/** Contracts that hold money in AccountRegistry on their own account (escrows). */
const ESCROWS: ContractName[] = ["lostAndFound", "tradeEscrow", "loanEscrow"];

/**
 * Every movement of the account's Pokechain balance, rebuilt from AccountRegistry's events:
 * Deposited, Withdrawn and BalanceMoved (from or to this address). LostAndFound's own events in
 * the same transaction say which bounty step a move was. No server keeps this list.
 */
export function OnChainPayments({ address }: { address: Address }) {
  const client = usePublicClient();
  const { data = [], isLoading } = useQuery({
    queryKey: ["onchain-payments", address],
    enabled: Boolean(client),
    refetchInterval: 4_000,
    queryFn: async (): Promise<Payment[]> => {
      const from = { fromBlock: DEPLOY_BLOCK };
      const [deposits, withdrawals, out, into, paid, refunded, set] = await Promise.all([
        client!.getContractEvents({ ...contracts.accounts, eventName: "Deposited", args: { account: address }, ...from }),
        client!.getContractEvents({ ...contracts.accounts, eventName: "Withdrawn", args: { account: address }, ...from }),
        client!.getContractEvents({ ...contracts.accounts, eventName: "BalanceMoved", args: { from: address }, ...from }),
        client!.getContractEvents({ ...contracts.accounts, eventName: "BalanceMoved", args: { to: address }, ...from }),
        client!.getContractEvents({ ...contracts.lostAndFound, eventName: "BountyPaid", args: { finder: address }, ...from }),
        client!.getContractEvents({ ...contracts.lostAndFound, eventName: "BountyRefunded", args: { owner: address }, ...from }),
        client!.getContractEvents({ ...contracts.lostAndFound, eventName: "BountySet", args: { owner: address }, ...from }),
      ]);
      // Which bounty step each LostAndFound transaction was, by tx hash.
      const bountyStep = new Map<string, string>();
      for (const e of paid) bountyStep.set(e.transactionHash, `Recovery bounty received · case #${e.args.claimId} · token #${e.args.tokenId}`);
      for (const e of refunded) bountyStep.set(e.transactionHash, `Lost-slab bounty refunded · token #${e.args.tokenId}`);
      for (const e of set) {
        if (!bountyStep.has(e.transactionHash)) bountyStep.set(e.transactionHash, `Lost-slab bounty escrowed · token #${e.args.tokenId}`);
      }

      // Another collector is shown by their on-chain handle (AccountRegistry.accountOf).
      const people = [...new Set([...out.map((e) => e.args.to!), ...into.map((e) => e.args.from!)])].filter(
        (who) => !ESCROWS.some((c) => isAddressEqual(contracts[c].address, who)),
      );
      const handles = new Map(
        await Promise.all(
          people.map(async (who) => {
            const account = await client!.readContract({ ...contracts.accounts, functionName: "accountOf", args: [who] });
            return [who.toLowerCase(), account.handle] as const;
          }),
        ),
      );
      const nameOf = (who: Address) => {
        const escrow = ESCROWS.find((c) => isAddressEqual(contracts[c].address, who));
        if (escrow) return CONTRACT_LABEL[escrow];
        const handle = handles.get(who.toLowerCase());
        return handle ? `@${handle}` : `${who.slice(0, 6)}…${who.slice(-4)}`;
      };
      const moveLabel = (tx: string, incoming: boolean, other: Address) => {
        const step = bountyStep.get(tx);
        if (step && isAddressEqual(other, contracts.lostAndFound.address)) {
          // A lowered bounty is refunded through BountySet, not BountyRefunded.
          return incoming && step.startsWith("Lost-slab bounty escrowed") ? step.replace("escrowed", "lowered, difference refunded") : step;
        }
        const name = nameOf(other);
        return incoming ? `Received from ${name}` : `Sent to ${name}`;
      };

      const rows: Omit<Payment, "at">[] = [
        ...deposits.map((e) => ({
          key: `${e.transactionHash}-${e.logIndex}`,
          label: "Deposit from wallet",
          amount: fromUsdcUnits(e.args.amount!),
          call: "AccountRegistry.deposit",
          block: e.blockNumber,
          tx: e.transactionHash,
        })),
        ...withdrawals.map((e) => ({
          key: `${e.transactionHash}-${e.logIndex}`,
          label: "Withdrawal to wallet",
          amount: -fromUsdcUnits(e.args.amount!),
          call: "AccountRegistry.withdraw",
          block: e.blockNumber,
          tx: e.transactionHash,
        })),
        ...out.map((e) => ({
          key: `${e.transactionHash}-${e.logIndex}`,
          label: moveLabel(e.transactionHash, false, e.args.to!),
          amount: -fromUsdcUnits(e.args.amount!),
          call: "AccountRegistry.moveBalance",
          block: e.blockNumber,
          tx: e.transactionHash,
        })),
        ...into.map((e) => ({
          key: `${e.transactionHash}-${e.logIndex}`,
          label: moveLabel(e.transactionHash, true, e.args.from!),
          amount: fromUsdcUnits(e.args.amount!),
          call: "AccountRegistry.moveBalance",
          block: e.blockNumber,
          tx: e.transactionHash,
        })),
      ];
      const blocks = [...new Set(rows.map((r) => r.block))];
      const times = new Map(
        await Promise.all(blocks.map(async (n) => [n, Number((await client!.getBlock({ blockNumber: n })).timestamp)] as const)),
      );
      return rows
        .map((r) => ({ ...r, at: times.get(r.block) ?? 0 }))
        .sort((a, b) => (a.block === b.block ? b.key.localeCompare(a.key) : Number(b.block - a.block)));
    },
  });

  return (
    <div className="overflow-hidden rounded-card border border-hairline bg-surface" data-testid="onchain-payments">
      <div className="border-b border-hairline px-4 py-3">
        <p className="flex items-center gap-2 text-[14px] font-bold">
          <Receipt size={15} /> Pokechain account history
        </p>
        <p className="mt-1 text-[12px] text-muted">
          Read from the chain: <Fn>AccountRegistry</Fn> <Fn>Deposited</Fn>, <Fn>Withdrawn</Fn> and <Fn>BalanceMoved</Fn> events for
          your address. Bounty payouts and refunds come from the <Fn>LostAndFound</Fn> escrow.
        </p>
      </div>
      {isLoading ? (
        <div className="space-y-2 p-4">{[0, 1].map((i) => <div key={i} className="skeleton h-10 rounded-lg" />)}</div>
      ) : data.length ? (
        <ul className="divide-y divide-[rgba(255,255,255,0.08)]">
          {data.map((p) => (
            <li key={p.key} className="grid grid-cols-[1fr_auto] items-center gap-4 px-4 py-3 text-[13px]">
              <span className="min-w-0">
                <span className="block truncate font-semibold">{p.label}</span>
                <span className="flex flex-wrap gap-x-3 text-[11px] text-dim">
                  <span>{p.at ? shortDate(new Date(p.at * 1000).toISOString()) : ""}</span>
                  <span>{p.call}</span>
                  <span>block {p.block.toString()}</span>
                  <span>tx <CopyText text={p.tx} /></span>
                </span>
              </span>
              <span className={clsx("w-28 text-right font-bold", p.amount >= 0 ? "text-good" : "text-white")}>
                {p.amount >= 0 ? "+" : "−"}
                {usd(Math.abs(p.amount), { cents: true })}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-6 text-center text-[12px] text-dim">No on-chain payments yet. Deposits, purchases and bounties show up here.</p>
      )}
    </div>
  );
}
