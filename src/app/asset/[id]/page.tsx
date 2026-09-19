import { notFound } from "next/navigation";
import { AssetDetail } from "@/components/asset/AssetDetail";
import { LISTINGS, getListing } from "@/lib/catalog";

export function generateStaticParams() {
  return LISTINGS.slice(0, 24).map((l) => ({ id: l.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const listing = getListing(id);
  return { title: listing ? listing.title : "Listing not found" };
}

export default async function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const listing = getListing(id);
  if (!listing) notFound();
  return <AssetDetail listing={listing} />;
}
