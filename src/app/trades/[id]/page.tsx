import { NegotiationView } from "@/components/negotiations/NegotiationView";

export const metadata = { title: "Negotiation room" };

/**
 * Chats live in the user's browser state, so the page only passes the id along. `?trade=1` and
 * `?loan=1` open the corresponding funded offer builder as soon as the chat does.
 */
export default async function NegotiationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ trade?: string; loan?: string }>;
}) {
  const { id } = await params;
  const { trade, loan } = await searchParams;
  return <NegotiationView id={id} openTrade={trade === "1"} openLoan={loan === "1"} />;
}
