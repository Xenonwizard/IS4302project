import { Suspense } from "react";
import { ListingCardSkeleton } from "@/components/market/ListingCard";
import { MarketplaceView } from "@/components/market/MarketplaceView";

export const metadata = { title: "Marketplace" };

export default function MarketplacePage() {
  return (
    <Suspense
      fallback={
        <div className="grid grid-cols-2 gap-3 px-4 py-6 lg:grid-cols-4 lg:px-6 2xl:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => (
            <ListingCardSkeleton key={i} />
          ))}
        </div>
      }
    >
      <MarketplaceView />
    </Suspense>
  );
}
