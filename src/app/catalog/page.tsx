import { Suspense } from "react";
import { CatalogView } from "@/components/market/CatalogView";

export const metadata = { title: "Browse all slabs — Pokechain" };

export default function CatalogPage() {
  return (
    <Suspense>
      <CatalogView />
    </Suspense>
  );
}
