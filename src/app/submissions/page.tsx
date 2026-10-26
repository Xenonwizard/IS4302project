import { Suspense } from "react";
import { SubmissionsView } from "@/components/submissions/SubmissionsView";

export const metadata = { title: "Submissions" };

export default function SubmissionsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted">Loading your submissions…</div>}>
      <SubmissionsView />
    </Suspense>
  );
}
