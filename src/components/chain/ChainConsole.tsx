"use client";

import clsx from "clsx";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Blocks, Check, ChevronDown, Copy, ExternalLink, Loader2, X } from "lucide-react";
import { useState } from "react";
import { decodeFunctionData, formatEther, formatGwei, parseEventLogs, type Abi, type Address, type Hash } from "viem";
import { usePublicClient } from "wagmi";
import { IS_LOCAL, chain, contracts, explorerAddress, explorerTx, shortHash, CONTRACT_LABEL } from "@/lib/chain/config";
import { useChainLog, type ChainLogEntry, type ChainLogKind } from "@/lib/chain/log";
import { useResetDemo } from "@/lib/chain/useResetDemo";
import { useStore } from "@/lib/store";
import { Drawer, TimeAgo } from "../ui/primitives";

const KIND: Record<ChainLogKind, { label: string; className: string }> = {
  tx: { label: "Wallet tx", className: "bg-accent/15 text-accent" },
  signature: { label: "Signature", className: "bg-warn/15 text-warn" },
  operator: { label: "Operator tx", className: "bg-[#a855f7]/15 text-[#c084fc]" },
  check: { label: "Off-chain step", className: "bg-good-bg text-good" },
};

/**
 * Local demo seed: @ash (Hardhat #1) and @misty (#2), each with vaulted slabs and PokeCredits, onboarded
 * through the real contracts by POST /api/dev/demo-traders. Log in as either with that test wallet.
 */
function useDemoTraders() {
  const { pushToast } = useStore();
  const log = useChainLog();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    const id = log.add({ kind: "operator", label: "Load demo traders", call: "POST /api/dev/demo-traders", args: ["test1 wallet", "test2 wallet"], status: "pending" });
    try {
      const res = await fetch("/api/dev/demo-traders", { method: "POST" });
      const body = (await res.json()) as { done?: string[]; error?: string };
      if (!res.ok) throw new Error(body.error);
      log.update(id, { status: "success", args: body.done?.length ? body.done : ["Already loaded"] });
      pushToast({
        title: "Demo traders ready",
        body: "Log in with the test1 or test2 wallet, then open Negotiation rooms to chat and trade.",
        tone: "success",
      });
      void queryClient.invalidateQueries();
    } catch (e) {
      log.update(id, { status: "failed", error: (e as Error).message });
      pushToast({ title: "Couldn't load demo traders", body: (e as Error).message, tone: "error" });
    } finally {
      setLoading(false);
    }
  };
  return { load, loading };
}

/** Floating button + drawer listing every blockchain call the app has made. */
export function ChainConsole({ presentationOnly = false }: { presentationOnly?: boolean }) {
  const { entries, open, setOpen, clear } = useChainLog();
  const { request: requestReset, armed, resetting } = useResetDemo();
  const { load: loadTraders, loading: loadingTraders } = useDemoTraders();
  const pending = entries.some((e) => e.status === "pending");

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-20 left-4 z-[80] flex h-10 items-center gap-2 rounded-full border border-hairline bg-[#0d0d11]/95 px-3.5 text-[12px] font-bold shadow-2xl backdrop-blur transition hover:border-white/25 lg:bottom-5"
      >
        {pending ? <Loader2 size={15} className="animate-spin text-accent" /> : <Blocks size={15} className="text-accent" />}
        Chain log
        <span className="rounded-full bg-surface-3 px-1.5 py-0.5 text-[10px]">{entries.length}</span>
      </button>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Chain log"
        side="left"
        footer={presentationOnly ? undefined :
          <div className="flex items-center justify-between text-[11px] text-dim">
            <span>
              {chain.name} · chain id {chain.id}
            </span>
            <span className="flex gap-3">
              {IS_LOCAL ? (
                <button
                  onClick={loadTraders}
                  disabled={loadingTraders}
                  title="Gives the test1 and test2 wallets vaulted demo slabs (and opens their accounts if needed), through the real contracts"
                  className="font-semibold text-accent hover:underline"
                >
                  {loadingTraders ? "Loading traders…" : "Load demo traders"}
                </button>
              ) : null}
              {entries.length ? (
                <button onClick={clear} className="font-semibold text-muted hover:text-white">
                  Clear log
                </button>
              ) : null}
              <button onClick={requestReset} disabled={resetting} className="font-semibold text-bad hover:underline">
                {resetting
                  ? "Resetting…"
                  : armed
                    ? "Click again to wipe everything"
                    : IS_LOCAL
                      ? "Reset chain + demo data"
                      : "Reset demo data"}
              </button>
            </span>
          </div>
        }
      >
        {!presentationOnly ? <Contracts /> : null}
        {entries.length ? (
          <ul className="divide-y divide-[rgba(255,255,255,0.08)]">
            {entries.map((e) => (
              <Entry key={e.id} entry={e} />
            ))}
          </ul>
        ) : (
          <p className="px-5 py-10 text-center text-[13px] text-muted">
            {presentationOnly ? "Nothing yet. Simulator actions appear here." : "Nothing yet. Open an account, deposit Pokechain credits or vault a slab, and every contract call shows up here."}
          </p>
        )}
      </Drawer>
    </>
  );
}

function Contracts() {
  return (
    <div className="border-b border-hairline px-5 py-4">
      <p className="text-[11px] font-bold uppercase tracking-wide text-dim">Deployed contracts</p>
      <ul className="mt-2 space-y-1.5">
        {(Object.keys(contracts) as (keyof typeof contracts)[]).map((k) => {
          const link = explorerAddress(contracts[k].address);
          return (
            <li key={k} className="flex items-center justify-between gap-3 text-[12px]">
              <span className="font-semibold">{CONTRACT_LABEL[k]}</span>
              {link ? (
                <a href={link} target="_blank" rel="noreferrer" className="font-mono text-accent hover:underline">
                  {shortHash(contracts[k].address)}
                </a>
              ) : (
                <CopyText text={contracts[k].address} />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Entry({ entry: e }: { entry: ChainLogEntry }) {
  const link = e.hash ? explorerTx(e.hash as Hash) : null;
  const [expanded, setExpanded] = useState(false);
  return (
    <li className="px-5 py-3.5">
      <div className="flex items-center gap-2">
        <span className={clsx("rounded-md px-1.5 py-0.5 text-[10px] font-bold", KIND[e.kind].className)}>{KIND[e.kind].label}</span>
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-muted">{e.label}</span>
        {e.status === "pending" ? (
          <Loader2 size={14} className="animate-spin text-muted" />
        ) : e.status === "success" ? (
          <Check size={14} className="text-good" />
        ) : (
          <X size={14} className="text-bad" />
        )}
      </div>
      <p className="mt-1.5 break-all font-mono text-[12px] font-semibold text-white">
        {e.call}
        {e.kind === "check" ? "" : `(${e.args.join(", ")})`}
      </p>
      {e.kind === "check" ? <p className="mt-1 text-[12px] text-muted">{e.args[0]}</p> : null}
      {e.error ? <p className="mt-1 text-[12px] text-bad">{e.error}</p> : null}
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-dim">
        <TimeAgo value={e.at} />
        {e.from ? <span>from {shortHash(e.from)}</span> : null}
        {e.blockNumber ? <span>block {e.blockNumber}</span> : null}
        {e.gasUsed ? <span>{Number(e.gasUsed).toLocaleString()} gas</span> : null}
        {e.hash ? (
          link ? (
            <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
              {shortHash(e.hash)} <ExternalLink size={10} />
            </a>
          ) : (
            <CopyText text={e.hash} title={IS_LOCAL ? "Local chain: no explorer. Copy the hash to inspect it with viem or cast." : undefined} />
          )
        ) : null}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="ml-auto inline-flex items-center gap-0.5 font-semibold text-accent hover:underline"
          aria-expanded={expanded}
        >
          {expanded ? "Hide details" : "Details"}
          <ChevronDown size={12} className={clsx("transition", expanded && "rotate-180")} />
        </button>
      </div>
      {expanded ? <EntryDetails entry={e} /> : null}
    </li>
  );
}

const show = (v: unknown): string =>
  typeof v === "bigint"
    ? v.toString()
    : typeof v === "string"
      ? v
      : JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x));

/** Which Pokechain contract an address is, so its calldata and logs can be decoded with the right ABI. */
function contractAt(address?: Address | null) {
  const key = (Object.keys(contracts) as (keyof typeof contracts)[]).find(
    (k) => contracts[k].address.toLowerCase() === address?.toLowerCase(),
  );
  return key ? { name: CONTRACT_LABEL[key], abi: contracts[key].abi as Abi } : null;
}

/**
 * Everything the chain knows about one logged transaction: the transaction itself
 * (eth_getTransactionByHash), its receipt (eth_getTransactionReceipt) and block, with the calldata
 * and every emitted log decoded against the Pokechain ABIs.
 */
function EntryDetails({ entry: e }: { entry: ChainLogEntry }) {
  const client = usePublicClient();
  const { data, error, isLoading } = useQuery({
    queryKey: ["tx-details", e.hash],
    enabled: Boolean(e.hash && client && e.status !== "pending"),
    queryFn: async () => {
      const hash = e.hash as Hash;
      const [tx, receipt] = await Promise.all([client!.getTransaction({ hash }), client!.getTransactionReceipt({ hash })]);
      const block = await client!.getBlock({ blockNumber: receipt.blockNumber });
      const target = contractAt(tx.to);
      let call: { name: string; args: { name: string; value: string }[] } | null = null;
      if (target && tx.input !== "0x") {
        const decoded = decodeFunctionData({ abi: target.abi, data: tx.input });
        const item = target.abi.find((x) => x.type === "function" && x.name === decoded.functionName && x.inputs.length === (decoded.args?.length ?? 0));
        const inputs = item && item.type === "function" ? item.inputs : [];
        call = {
          name: decoded.functionName,
          args: (decoded.args ?? []).map((v, i) => ({ name: inputs[i]?.name || `arg${i}`, value: show(v) })),
        };
      }
      // Each log is decoded with the ABI of the contract that emitted it (ERC-20 and ERC-721
      // Transfer share a topic, so one combined ABI would mix them up).
      const events = receipt.logs.map((log) => {
        const source = contractAt(log.address);
        const [parsed] = source ? parseEventLogs({ abi: source.abi, logs: [log] }) : [];
        return {
          contract: source?.name ?? log.address,
          name: parsed?.eventName ?? "(unknown event)",
          args: parsed ? Object.entries(parsed.args as Record<string, unknown>).map(([k, v]) => ({ name: k, value: show(v) })) : [],
        };
      });
      return { tx, receipt, block, target, call, events };
    },
  });

  // Off-chain steps: nothing was broadcast, so the log entry itself is the whole record.
  if (!e.hash) {
    return (
      <div className="mt-2.5 space-y-1.5 rounded-xl bg-[#101014] p-3 text-[11.5px]">
        <p className="text-dim">
          {e.kind === "signature"
            ? "Signed in the wallet only: no transaction, no gas. The signature is passed into the next transaction."
            : "Off-chain call: nothing was broadcast to the chain."}
        </p>
        <Kv label="Step" value={e.call} mono />
        {e.args.map((a, i) => (
          <Kv key={i} label={e.kind === "check" ? "Result" : `Field ${i + 1}`} value={a} mono={e.kind !== "check"} />
        ))}
        {e.from ? <Kv label="From" value={e.from} mono /> : null}
        <Kv label="At" value={new Date(e.at).toLocaleString()} />
        {e.error ? <Kv label="Error" value={e.error} /> : null}
      </div>
    );
  }

  if (e.status === "pending") return <p className="mt-2 text-[11.5px] text-dim">Waiting for the transaction to be mined…</p>;
  if (isLoading) return <p className="mt-2 text-[11.5px] text-dim">Reading the transaction and receipt from the chain…</p>;
  if (error || !data) {
    return (
      <p className="mt-2 text-[11.5px] text-bad">
        Couldn&apos;t read this transaction. If the local chain was restarted or reset since, it no longer exists.
      </p>
    );
  }

  const { tx, receipt, block, target, call, events } = data;
  const fee = receipt.gasUsed * receipt.effectiveGasPrice;
  return (
    <div className="mt-2.5 space-y-3 rounded-xl bg-[#101014] p-3 text-[11.5px]">
      <div className="space-y-1">
        <Kv label="Status" value={receipt.status === "success" ? "Success" : "Reverted"} />
        <Kv label="Tx hash" value={receipt.transactionHash} mono copy />
        <Kv label="Block" value={`${receipt.blockNumber} · ${new Date(Number(block.timestamp) * 1000).toLocaleString()}`} />
        <Kv label="From" value={tx.from} mono copy />
        <Kv label="To" value={target ? `${target.name} · ${tx.to}` : (tx.to ?? "contract creation")} mono />
        <Kv label="Nonce" value={String(tx.nonce)} />
        <Kv label="Gas used" value={`${receipt.gasUsed.toLocaleString()} of ${tx.gas.toLocaleString()} limit`} />
        <Kv label="Gas price" value={`${formatGwei(receipt.effectiveGasPrice)} gwei`} />
        <Kv label="Fee" value={`${formatEther(fee)} ${chain.nativeCurrency.symbol}`} />
        {tx.value > BigInt(0) ? <Kv label="Value" value={`${formatEther(tx.value)} ${chain.nativeCurrency.symbol}`} /> : null}
      </div>

      {call ? (
        <div>
          <p className="mb-1 font-bold text-white">
            Function: <span className="font-mono">{target?.name}.{call.name}</span>
          </p>
          <div className="space-y-1 border-l border-hairline pl-2.5">
            {call.args.length ? call.args.map((a) => <Kv key={a.name} label={a.name} value={a.value} mono />) : <p className="text-dim">no arguments</p>}
          </div>
        </div>
      ) : null}

      <div>
        <p className="mb-1 font-bold text-white">Events emitted ({events.length})</p>
        <div className="space-y-2">
          {events.map((ev, i) => (
            <div key={i} className="border-l border-hairline pl-2.5">
              <p className="font-mono font-semibold">
                <span className="text-dim">{ev.contract}.</span>
                {ev.name}
              </p>
              <div className="mt-0.5 space-y-0.5">
                {ev.args.map((a) => (
                  <Kv key={a.name} label={a.name} value={a.value} mono />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1 flex items-center justify-between font-bold text-white">
          Raw calldata <CopyText text={tx.input} label="Copy" />
        </p>
        <p className="break-all font-mono text-[10.5px] text-dim">
          {tx.input.length > 266 ? `${tx.input.slice(0, 266)}… (${(tx.input.length - 2) / 2} bytes)` : tx.input}
        </p>
      </div>
    </div>
  );
}

function Kv({ label, value, mono, copy }: { label: string; value: string; mono?: boolean; copy?: boolean }) {
  return (
    <div className="grid grid-cols-[88px_1fr] gap-2">
      <span className="text-dim">{label}</span>
      <span className={clsx("flex min-w-0 items-start gap-1.5 break-all text-white", mono && "font-mono text-[11px]")}>
        <span className="min-w-0">{value}</span>
        {copy ? <CopyText text={value} label="Copy" /> : null}
      </span>
    </div>
  );
}

/** Copies `text`. Shows it shortened (hashes, addresses) unless a `label` is given, e.g. "Copy". */
export function CopyText({ text, title, label }: { text: string; title?: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      title={title ?? text}
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}
      className={clsx("inline-flex shrink-0 items-center gap-1 text-muted hover:text-white", label ? "font-semibold" : "font-mono")}
    >
      {label ? (copied ? "Copied" : label) : shortHash(text)}
      {copied ? <Check size={10} className="text-good" /> : <Copy size={10} />}
    </button>
  );
}
