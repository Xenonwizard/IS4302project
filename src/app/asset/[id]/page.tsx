import { AssetDetail } from "@/components/asset/AssetDetail";
import { StoredSlab } from "@/components/asset/StoredSlab";
import { LISTINGS, getListing } from "@/lib/catalog";

export function generateStaticParams() {
  return LISTINGS.slice(0, 24).map((l) => ({ id: l.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const listing = getListing(id);
  return { title: listing ? listing.title : "Slab" };
}

export default async function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const listing = getListing(id);
  // Not in the catalog: it may be a slab the user submitted, which lives client-side.
  if (!listing) return <StoredSlab id={id} />;
  return <AssetDetail listing={listing} />;
}
