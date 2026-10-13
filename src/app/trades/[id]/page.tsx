import { notFound } from "next/navigation";
import { TradeRoomView } from "@/components/trades/TradeRoomView";
import { getListing } from "@/lib/catalog";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const listing = getListing(id);
  return { title: listing ? `Trade room · ${listing.shortName}` : "Trade room not found" };
}

export default async function TradeRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const listing = getListing(id);
  if (!listing) notFound();
  return <TradeRoomView listing={listing} />;
}
