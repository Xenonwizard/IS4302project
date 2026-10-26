"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { zeroAddress } from "viem";
import { buildOnChainListing, certPreview } from "@/lib/catalog";
import { cardFromTokenURI } from "@/lib/comparables";
import { chain, contracts, fromUsdcUnits, IS_DEPLOYED, shortHash } from "@/lib/chain/config";
import { useStore } from "@/lib/store";
import type { Grader } from "@/lib/types";
import { Button } from "../ui/primitives";
import { AssetDetail } from "./AssetDetail";

/**
 * Public token pages also work for sold or delisted slabs outside the visitor's browser storage.
 */
export function StoredSlab({ id }: { id: string }) {
  const { ready, slabs } = useStore();
  const client = usePublicClient();
  const tokenId = id.match(/^(?:token-)?(\d+)$/)?.[1];
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["public-slab", chain.id, contracts.slabVault.address, tokenId],
    enabled: Boolean(client && IS_DEPLOYED && tokenId),
    queryFn: async () => {
      const args = [BigInt(tokenId!)] as const;
      const [uri, owner, ask] = await Promise.all([
        client!.readContract({ ...contracts.slabVault, functionName: "tokenURI", args }),
        client!.readContract({ ...contracts.slabVault, functionName: "ownerOf", args }),
        client!.readContract({ ...contracts.slabMarket, functionName: "getListing", args }),
      ]);
      const card = cardFromTokenURI(uri);
      const preview = certPreview(card.grader as Grader, card.certNumber);
      const displayCard = card.image
        ? card
        : { ...card, title: preview?.title ?? card.title, image: preview?.image ?? "" };
      const account = await client!.readContract({ ...contracts.accounts, functionName: "accountOf", args: [owner] });
      const listed = ask.seller !== zeroAddress && ask.price > BigInt(0);
      return {
        ...buildOnChainListing({ ...displayCard, grader: displayCard.grader as Grader, tokenId: tokenId!, owner: account.handle || shortHash(owner), ownerAddress: owner, price: listed ? fromUsdcUnits(ask.price) : undefined, contract: contracts.slabVault.address }),
        isListed: listed,
      };
    },
  });
  const listing = data ?? slabs.find((s) => s.id === id || s.tokenId === id || s.id === `token-${id}`);

  if (!ready || (!listing && tokenId && client && IS_DEPLOYED && isPending)) {
    return (
      <div className="px-4 py-5 lg:px-6">
        <div className="skeleton h-[70vh] rounded-card" />
      </div>
    );
  }
  if (!listing && isError) {
    return <div className="px-6 py-12 text-center"><p className="text-sm text-muted">This slab could not be loaded from Pokechain.</p><Button className="mt-4" onClick={() => void refetch()}>Try again</Button></div>;
  }
  if (!listing) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-[52px] font-black leading-none text-surface-3">404</p>
        <h1 className="text-xl font-bold">We could not find that slab</h1>
        <p className="max-w-sm text-sm text-muted">
          The listing may have sold, been delisted, or the link is wrong.
        </p>
        <Link href="/marketplace">
          <Button size="lg">Back to the marketplace</Button>
        </Link>
      </div>
    );
  }
  return <AssetDetail listing={listing} />;
}
