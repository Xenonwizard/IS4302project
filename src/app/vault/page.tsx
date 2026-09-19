import { Suspense } from "react";
import { VaultView } from "@/components/vault/VaultView";

export const metadata = { title: "My vault" };

export default function VaultPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted">Loading vault…</div>}>
      <VaultView />
    </Suspense>
  );
}
