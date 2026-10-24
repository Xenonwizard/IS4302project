"use client";

import { MessagesSquare } from "lucide-react";
import { useRouter } from "next/navigation";
import type { Address } from "viem";
import { anchorListing } from "@/lib/chain/slabValue";
import { useCollectors, useTradeSlabs } from "@/lib/chain/trades";
import { useStore } from "@/lib/store";
import { Avatar, Button } from "../ui/primitives";

/**
 * Other collectors on Pokechain, read from the chain. Starting a chat with one opens a negotiation
 * room; trade offers (slabs and cash, both ways) are made inside it as the two of you talk.
 */
export function CollectorChats({ me }: { me: string }) {
  const { data: collectors = [] } = useCollectors(me as Address);

  return (
    <section>
      <h2 className="mb-1 flex items-center gap-2 text-lg font-bold">
        <MessagesSquare size={17} className="text-accent" />
        Collectors to trade with
      </h2>
      <p className="mb-3 text-[13px] text-muted">
        Chat with a collector, then offer a swap in the chat, e.g. 3 Pikachus + $50 for 2 Articunos. Offers are locked in the TradeEscrow contract and settle in one transaction.
      </p>
      {collectors.length ? (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {collectors.map((c) => (
            <CollectorRow key={c.address} address={c.address} handle={c.handle} />
          ))}
        </ul>
      ) : (
        <p className="rounded-card border border-dashed border-hairline p-4 text-[13px] text-muted">
          No other collectors on-chain yet. Open a second account with Hardhat test collector #2 (or use{" "}
          <b className="text-white">Load demo traders</b> in the Chain log panel).
        </p>
      )}
    </section>
  );
}

function CollectorRow({ address, handle }: { address: Address; handle: string }) {
  const router = useRouter();
  const { openChat } = useStore();
  const { data: slabs = [], isFetched } = useTradeSlabs(address);

  const start = () => {
    // The chat hangs on one of their slabs; a trade in it can ask for any of them.
    const anchor = slabs[0] ? anchorListing(slabs[0], handle, address) : null;
    const id = anchor ? openChat(anchor) : null;
    if (id) router.push(`/trades/${id}`);
  };

  return (
    <li className="flex items-center gap-3 rounded-card border border-hairline bg-surface p-3">
      <Avatar name={handle} size={30} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-bold">@{handle}</span>
        <span className="block truncate text-[11.5px] text-dim">
          {isFetched ? `${slabs.length} vaulted slab${slabs.length === 1 ? "" : "s"}` : "Reading their vault…"}
        </span>
      </span>
      <Button size="sm" variant="secondary" disabled={!slabs.length} onClick={start} aria-label={`Chat with @${handle}`}>
        Chat
      </Button>
    </li>
  );
}
