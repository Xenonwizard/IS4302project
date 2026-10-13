import Link from "next/link";
import { LIVE_ROOMS } from "@/lib/trade";
import { RoomCard } from "../trades/RoomCard";

export function LiveRooms() {
  return (
    <section>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Live trade rooms</h2>
          <p className="mt-0.5 text-[13px] text-muted">
            Collectors bidding in chat right now. Jump in with cash or a slab.
          </p>
        </div>
        <Link href="/trades" className="shrink-0 text-[13px] font-semibold text-accent hover:underline">
          All rooms →
        </Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {LIVE_ROOMS.slice(0, 6).map((l) => (
          <RoomCard key={l.id} listing={l} />
        ))}
      </div>
    </section>
  );
}
