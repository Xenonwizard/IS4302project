import { Suspense } from "react";
import { OuttakeSimulator } from "@/components/chain/OuttakeSimulator";

export const metadata = { title: { absolute: "Card outtake simulator" } };

export default function OuttakePage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted">Loading outtake simulator…</div>}>
      <OuttakeSimulator />
    </Suspense>
  );
}
