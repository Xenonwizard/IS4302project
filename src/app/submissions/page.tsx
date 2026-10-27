import { Suspense } from "react";
import { SubmissionsView } from "@/components/submissions/SubmissionsView";

export const metadata = { title: "Status Center" };

export default function SubmissionsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted">Loading Status Center…</div>}>
      <SubmissionsView />
    </Suspense>
  );
}
