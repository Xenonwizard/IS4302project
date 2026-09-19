import Link from "next/link";
import { Button } from "@/components/ui/primitives";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-[52px] font-black leading-none text-surface-3">404</p>
      <h1 className="text-xl font-bold">We could not find that slab</h1>
      <p className="max-w-sm text-sm text-muted">
        The listing may have sold, been delisted, or the link is wrong.
      </p>
      <Link href="/marketplace">
        <Button size="lg">Back to the marketplace</Button>
      </Link>
    </div>
  );
}
