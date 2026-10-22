import { TraceView } from "@/components/chain/TraceView";

export const metadata = { title: "Trace a slab" };

export default async function TracePage({ params }: PageProps<"/trace/[tokenId]">) {
  const { tokenId } = await params;
  return <TraceView tokenId={tokenId} />;
}
