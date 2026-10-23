"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { useState } from "react";
import { keccak256, toBytes, zeroAddress, type Address } from "viem";
import { usePublicClient } from "wagmi";
import { contracts, shortHash } from "@/lib/chain/config";
import { useSlabChain } from "@/lib/chain/useSlabChain";
import { useStore } from "@/lib/store";
import type { Listing, VaultItem } from "@/lib/types";
import { Slab } from "../slab/Slab";
import { Button, Field, Modal, inputClass } from "../ui/primitives";
import { Fn, OnChainNote } from "./ui";

/**
 * A → B on Pokechain: the slab's ERC-721 moves to another collector's wallet. Collector Crypt's
 * Solana NFT stays put in Pokechain's escrow; only the Polygon title changes hands, so whoever
 * holds this token is who Collector Crypt will eventually ship to.
 */
export function TransferModal({ target, onClose }: { target: { entry: VaultItem; listing: Listing } | null; onClose: () => void }) {
  return (
    <Modal open={Boolean(target)} onClose={onClose} title="Transfer to another collector" width="max-w-lg">
      {target ? <Transfer key={target.listing.id} entry={target.entry} listing={target.listing} onClose={onClose} /> : null}
    </Modal>
  );
}

function Transfer({ entry, listing, onClose }: { entry: VaultItem; listing: Listing; onClose: () => void }) {
  const client = usePublicClient();
  const { transfer } = useSlabChain();
  const { user, pushToast, handOver } = useStore();
  const queryClient = useQueryClient();
  const [handle, setHandle] = useState("");
  const [to, setTo] = useState<{ address: Address; handle: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const tokenId = entry.token!.tokenId;

  /**
   * Handle → wallet, straight from AccountRegistry: handleOwner(keccak256(handle)), then accountOf.
   * Closed handles stay reserved to their old wallet, so the handle must also be that wallet's
   * *current* one, and the wallet can't be your own.
   */
  const lookup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setTo(null);
    const h = handle.trim().toLowerCase().replace(/^@/, "");
    const address = await client!.readContract({ ...contracts.accounts, functionName: "handleOwner", args: [keccak256(toBytes(h))] });
    if (address === zeroAddress) return setError(`No Pokechain account is called @${h}.`);
    if (address.toLowerCase() === user?.address?.toLowerCase()) return setError(`@${h} is your own wallet.`);
    const account = await client!.readContract({ ...contracts.accounts, functionName: "accountOf", args: [address] });
    if (account.status !== 1) return setError(`@${h}'s account is closed, so it can't receive slabs.`);
    if (account.handle !== h) return setError(`@${h} is a retired handle. That wallet is now @${account.handle}.`);
    setTo({ address, handle: h });
  };

  const send = async () => {
    if (!to) return;
    setBusy(true);
    try {
      const receipt = await transfer(tokenId, to.address, to.handle);
      // The receipt is in, so the chain already says they own it: take it out of this vault now
      // rather than waiting for the next ownership poll, and re-read ownership straight away.
      handOver(listing.id, to.handle, receipt.transactionHash);
      void queryClient.invalidateQueries({ queryKey: ["owned-slabs"] });
      pushToast({ title: `Sent to @${to.handle}`, body: `Token #${tokenId} is in their Vault now.`, tone: "success" });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 p-5">
      <div className="flex gap-4">
        <div className="w-16 shrink-0">
          <Slab listing={listing} flat />
        </div>
        <div className="min-w-0 text-[13px]">
          <p className="font-semibold leading-snug">{listing.title}</p>
          <p className="mt-1 text-[12px] text-muted">Token #{tokenId} · Collector Crypt NFT {shortHash(entry.token!.custodianRef)}</p>
        </div>
      </div>

      <form onSubmit={lookup} className="flex items-end gap-2">
        <div className="flex-1">
          <Field label="Collector's handle">
            <input className={inputClass} value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="misty" autoComplete="off" />
          </Field>
        </div>
        <Button type="submit" variant="secondary">
          Look up
        </Button>
      </form>
      {to ? (
        <p className="text-[13px] text-good">
          @{to.handle} → <span className="font-mono">{to.address}</span>
        </p>
      ) : null}
      {error ? <p className="text-[13px] font-medium text-bad">{error}</p> : null}

      <OnChainNote>
        1. Reads <Fn>AccountRegistry.handleOwner(keccak256(handle))</Fn> and <Fn>accountOf</Fn> to find their wallet
        and check it&apos;s an active account still using that handle (and isn&apos;t yours).
        <br />
        2. <Fn>SlabVault.safeTransferFrom(you, them, tokenId)</Fn> moves the token. SlabVault&apos;s <Fn>_update</Fn> only
        allows it while the slab is <b className="text-white">Vaulted</b> and the receiver&apos;s account is Active. It also
        moves <Fn>vaultedCount</Fn> with it.
        <br />
        Collector Crypt&apos;s NFT doesn&apos;t move: it stays in Pokechain&apos;s escrow. Whoever holds this token is who CC ships
        to on withdrawal. Paid sales will use the same transfer, inside a TradeEscrow swap.
      </OnChainNote>
      <Button className="w-full" size="lg" onClick={send} disabled={!to || busy}>
        <Send size={15} />
        {busy ? "Confirm in your wallet…" : to ? `Transfer to @${to.handle}` : "Look up a collector first"}
      </Button>
    </div>
  );
}
