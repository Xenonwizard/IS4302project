"use client";

import clsx from "clsx";
import { Blocks, Check, Copy, ExternalLink, Loader2, X } from "lucide-react";
import { useState } from "react";
import type { Hash } from "viem";
import { IS_LOCAL, chain, contracts, explorerAddress, explorerTx, shortHash, CONTRACT_LABEL } from "@/lib/chain/config";
import { useChainLog, type ChainLogEntry, type ChainLogKind } from "@/lib/chain/log";
import { Drawer, TimeAgo } from "../ui/primitives";

const KIND: Record<ChainLogKind, { label: string; className: string }> = {
  tx: { label: "Wallet tx", className: "bg-accent/15 text-accent" },
  signature: { label: "Signature", className: "bg-warn/15 text-warn" },
  operator: { label: "Operator tx", className: "bg-[#a855f7]/15 text-[#c084fc]" },
  check: { label: "Custody check", className: "bg-good-bg text-good" },
};

/** Floating button + drawer listing every blockchain call the app has made. */
export function ChainConsole() {
  const { entries, open, setOpen, clear } = useChainLog();
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
        footer={
          <div className="flex items-center justify-between text-[11px] text-dim">
            <span>
              {chain.name} · chain id {chain.id}
            </span>
            {entries.length ? (
              <button onClick={clear} className="font-semibold text-muted hover:text-white">
                Clear
              </button>
            ) : null}
          </div>
        }
      >
        <Contracts />
        {entries.length ? (
          <ul className="divide-y divide-[rgba(255,255,255,0.08)]">
            {entries.map((e) => (
              <Entry key={e.id} entry={e} />
            ))}
          </ul>
        ) : (
          <p className="px-5 py-10 text-center text-[13px] text-muted">
            Nothing yet. Open an account, deposit USDC or vault a slab, and every contract call shows up here.
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
      </div>
    </li>
  );
}

export function CopyText({ text, title }: { text: string; title?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      title={title ?? text}
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}
      className="inline-flex items-center gap-1 font-mono text-muted hover:text-white"
    >
      {shortHash(text)}
      {copied ? <Check size={10} className="text-good" /> : <Copy size={10} />}
    </button>
  );
}
