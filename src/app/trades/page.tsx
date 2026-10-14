import { Suspense } from "react";
import { NegotiationsInbox } from "@/components/negotiations/NegotiationsInbox";

export const metadata = { title: "Negotiation rooms" };

export default function NegotiationsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted">Loading chats…</div>}>
      <NegotiationsInbox />
    </Suspense>
  );
}
