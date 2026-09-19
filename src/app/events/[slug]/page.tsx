import Link from "next/link";
import { notFound } from "next/navigation";
import { Trophy, Zap } from "lucide-react";
import { ListingCard } from "@/components/market/ListingCard";
import { Button, Countdown } from "@/components/ui/primitives";
import { Avatar } from "@/components/ui/primitives";
import { EVENTS, LEADERBOARD_CURRENT, eventPool, getEvent, getPack } from "@/lib/catalog";
import { points, usd } from "@/lib/format";

export function generateStaticParams() {
  return EVENTS.map((e) => ({ slug: e.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = getEvent(slug);
  return { title: event ? event.name : "Event not found" };
}

export default async function EventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = getEvent(slug);
  if (!event) notFound();
  const pack = getPack(event.packSlug);
  const pool = eventPool(slug);

  return (
    <div className="px-4 py-5 lg:px-6">
      <section
        className="relative overflow-hidden rounded-card border border-hairline p-6 sm:p-8"
        style={{
          background: `linear-gradient(120deg, hsl(${event.hueA} 62% 18%), hsl(${event.hueB} 58% 10%) 65%, #05050a)`,
        }}
      >
        <span className="inline-flex items-center gap-1.5 rounded-full bg-black/40 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider backdrop-blur">
          <Zap size={12} style={{ color: `hsl(${event.hueA} 80% 65%)` }} />
          Live event
        </span>
        <h1 className="mt-4 text-[28px] font-bold leading-tight sm:text-[36px]">{event.name}</h1>
        <p className="mt-2 max-w-xl text-[15px] text-white/70">{event.blurb}</p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          {pack ? (
            <Link href={`/packs/${pack.slug}`}>
              <Button size="lg">Rip {pack.name} · {usd(pack.price)}</Button>
            </Link>
          ) : null}
          <div className="rounded-xl border border-hairline bg-black/40 px-4 py-3 backdrop-blur">
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted">Ends in</p>
            <Countdown to={event.endsAt} className="text-sm font-bold" />
          </div>
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          <section className="rounded-card border border-hairline bg-surface p-5">
            <h2 className="text-sm font-bold">How it works</h2>
            <p className="mt-2 text-[13px] leading-relaxed text-muted">{event.detail}</p>
          </section>

          <section>
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">In the pool</h2>
                <p className="mt-0.5 text-[13px] text-muted">
                  The heaviest slabs currently sitting in this event&apos;s pool.
                </p>
              </div>
              <Link
                href="/marketplace?sort=price-desc"
                className="shrink-0 text-[13px] font-semibold text-accent hover:underline"
              >
                See all →
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {pool.map((l) => (
                <ListingCard key={l.id} listing={l} dense />
              ))}
            </div>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-card border border-hairline bg-surface p-4">
            <h2 className="flex items-center gap-2 text-sm font-bold">
              <Trophy size={15} className="text-warn" />
              Event rewards
            </h2>
            <ul className="mt-3 space-y-2.5">
              {event.rewards.map((r) => (
                <li key={r.place} className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="font-bold">{r.place}</span>
                  <span className="text-right text-muted">{r.prize}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-card border border-hairline bg-surface p-4">
            <h2 className="text-sm font-bold">Event leaders</h2>
            <ul className="mt-3 space-y-3">
              {LEADERBOARD_CURRENT.slice(0, 8).map((e) => (
                <li key={e.user} className="flex items-center gap-3">
                  <span className="w-6 shrink-0 text-[12px] font-bold text-muted">#{e.rank}</span>
                  <Avatar name={e.user} hue={e.avatarHueA} size={22} />
                  <Link
                    href={`/profile/${e.user}`}
                    className="min-w-0 flex-1 truncate text-[12px] font-semibold hover:underline"
                  >
                    {e.user}
                  </Link>
                  <span className="shrink-0 text-[11px] text-dim">{points(e.points)}</span>
                </li>
              ))}
            </ul>
            <Link href="/leaderboard">
              <Button variant="secondary" size="sm" className="mt-4 w-full">
                Full leaderboard
              </Button>
            </Link>
          </section>
        </aside>
      </div>
    </div>
  );
}
