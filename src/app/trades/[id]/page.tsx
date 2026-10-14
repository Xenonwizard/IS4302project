import { NegotiationView } from "@/components/negotiations/NegotiationView";

export const metadata = { title: "Negotiation room" };

/** Chats live in the user's browser state, so the page only passes the id along. */
export default async function NegotiationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <NegotiationView id={id} />;
}
