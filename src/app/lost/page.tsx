import { Suspense } from "react";
import { LostCardsView } from "@/components/lost/LostCardsView";

export const metadata = {
  title: "Lost Cards & Bounties — Pokechain",
  description: "Search and view cards reported missing from the vault or in transit, with active recovery bounties.",
};

export default function LostPage() {
  return (
    <Suspense>
      <LostCardsView />
    </Suspense>
  );
}
