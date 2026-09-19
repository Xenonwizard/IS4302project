import { makeRandom } from "@/lib/rng";
import type { Listing } from "@/lib/types";

/**
 * Procedural card face. Everything is derived from listing.art.seed so a given
 * card always renders identically on the server and in the browser.
 */
export function CardArt({ listing }: { listing: Listing }) {
  const { style, hueA, hueB, seed, holo } = listing.art;
  const rnd = makeRandom(seed);
  const blobs = Array.from({ length: 5 }, () => ({
    x: rnd.int(5, 95),
    y: rnd.int(8, 92),
    r: rnd.int(14, 46),
    hue: (hueA + rnd.int(-40, 60) + 360) % 360,
    alpha: rnd.float(0.25, 0.75),
  }));
  const rays = Array.from({ length: 9 }, (_, i) => i * 40 + rnd.int(-8, 8));

  const art = (
    <div
      className="relative h-full w-full overflow-hidden"
      style={{
        background: `radial-gradient(120% 90% at 30% 20%, hsl(${hueA} 70% 46%) 0%, hsl(${hueB} 62% 22%) 55%, hsl(${(hueB + 20) % 360} 55% 10%) 100%)`,
      }}
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
        {rays.map((deg, i) => (
          <rect
            key={`r${i}`}
            x="49"
            y="-40"
            width={i % 2 ? 3 : 7}
            height="180"
            transform={`rotate(${deg} 50 50)`}
            fill={`hsl(${(hueA + i * 9) % 360} 80% 70%)`}
            opacity={0.1}
          />
        ))}
        {blobs.map((b, i) => (
          <circle
            key={`b${i}`}
            cx={b.x}
            cy={b.y}
            r={b.r}
            fill={`hsl(${b.hue} 75% 55%)`}
            opacity={b.alpha * 0.55}
            style={{ filter: "blur(0.6px)" }}
          />
        ))}
        <ellipse cx="50" cy="78" rx="34" ry="12" fill="#000" opacity="0.28" />
      </svg>
      {holo ? <div className="holo-sweep absolute inset-0 overflow-hidden" /> : null}
      <div className="absolute inset-0 bg-[radial-gradient(90%_70%_at_50%_35%,transparent,rgba(0,0,0,0.45))]" />
      <Silhouette style={style} hue={hueA} seed={seed} />
    </div>
  );

  if (style === "sports") return <SportsFace listing={listing}>{art}</SportsFace>;
  if (style === "mtg") return <MtgFace listing={listing}>{art}</MtgFace>;
  if (style === "anime") return <AnimeFace listing={listing}>{art}</AnimeFace>;
  return <PokemonFace listing={listing}>{art}</PokemonFace>;
}

/** Abstract subject shape so every face has a focal point. */
function Silhouette({ style, hue, seed }: { style: string; hue: number; seed: number }) {
  const rnd = makeRandom(seed ^ 0x9e37);
  const tilt = rnd.int(-8, 8);
  const light = `hsl(${(hue + 30) % 360} 85% 78%)`;
  const dark = `hsl(${(hue + 340) % 360} 60% 22%)`;

  if (style === "sports") {
    return (
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" style={{ transform: `rotate(${tilt / 3}deg)` }}>
        <g fill={dark} opacity="0.9">
          <circle cx="50" cy="34" r="11" fill={light} />
          <path d="M34 52 Q50 42 66 52 L72 86 Q50 94 28 86 Z" />
          <path d="M30 56 L18 74 L26 80 L36 62 Z" />
          <path d="M70 56 L84 72 L76 79 L64 62 Z" />
        </g>
      </svg>
    );
  }
  if (style === "mtg") {
    return (
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full">
        <g opacity="0.92">
          <path d="M50 18 L64 40 L86 44 L68 60 L74 84 L50 72 L26 84 L32 60 L14 44 L36 40 Z" fill={light} opacity="0.75" />
          <circle cx="50" cy="52" r="14" fill={dark} opacity="0.8" />
        </g>
      </svg>
    );
  }
  const variant = rnd.int(0, 3);
  return (
    <svg
      viewBox="0 0 100 100"
      className="absolute inset-0 h-full w-full"
      style={{ transform: `rotate(${tilt}deg)` }}
    >
      <g>
        {variant === 0 ? (
          <>
            {/* winged */}
            <path d="M18 50 Q34 30 44 48 Z" fill={light} opacity="0.7" />
            <path d="M82 50 Q66 30 56 48 Z" fill={light} opacity="0.7" />
            <ellipse cx="50" cy="56" rx="21" ry="24" fill={light} opacity="0.9" />
            <path d="M50 30 L57 44 L43 44 Z" fill={dark} opacity="0.7" />
          </>
        ) : null}
        {variant === 1 ? (
          <>
            {/* serpentine */}
            <path
              d="M24 82 Q46 74 40 58 Q34 42 52 36 Q70 30 72 46"
              stroke={light}
              strokeWidth="11"
              fill="none"
              strokeLinecap="round"
              opacity="0.9"
            />
            <circle cx="72" cy="44" r="10" fill={light} />
            <circle cx="69" cy="42" r="2" fill="#0b0b10" />
          </>
        ) : null}
        {variant === 2 ? (
          <>
            {/* quadruped */}
            <ellipse cx="52" cy="60" rx="25" ry="15" fill={light} opacity="0.9" />
            <circle cx="30" cy="48" r="12" fill={light} />
            <path d="M22 40 L26 28 L33 38 Z" fill={light} />
            <path d="M40 72 L38 86 M62 72 L66 86" stroke={light} strokeWidth="6" strokeLinecap="round" />
            <circle cx="27" cy="47" r="2.2" fill="#0b0b10" />
          </>
        ) : null}
        {variant === 3 ? (
          <>
            {/* rounded classic */}
            <ellipse cx="50" cy="56" rx="24" ry="26" fill={light} opacity="0.9" />
            <ellipse cx="50" cy="44" rx="17" ry="15" fill={dark} opacity="0.5" />
            <circle cx="43" cy="44" r="3.4" fill="#0b0b10" />
            <circle cx="57" cy="44" r="3.4" fill="#0b0b10" />
            <circle cx="42" cy="43" r="1.1" fill="#fff" />
            <circle cx="56" cy="43" r="1.1" fill="#fff" />
            <path
              d="M46 54 Q50 58 54 54"
              stroke="#0b0b10"
              strokeWidth="1.6"
              fill="none"
              strokeLinecap="round"
            />
            <path d="M30 34 L36 20 L44 32 Z" fill={light} opacity="0.85" />
            <path d="M70 34 L64 20 L56 32 Z" fill={light} opacity="0.85" />
          </>
        ) : null}
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */

function PokemonFace({ listing, children }: { listing: Listing; children: React.ReactNode }) {
  const vintage = listing.year < 2004;
  const frame = vintage
    ? "linear-gradient(160deg,#f7d94a,#e3b323 55%,#c9931a)"
    : `linear-gradient(160deg, hsl(${listing.art.hueA} 45% 78%), hsl(${listing.art.hueB} 40% 52%))`;
  return (
    <div className="h-full w-full p-[4.5cqw]" style={{ background: frame }}>
      <div className="flex h-full w-full flex-col overflow-hidden rounded-[1cqw] bg-[#d9d3bd] p-[2.4cqw] text-[#20201c]">
        <div className="flex items-baseline justify-between gap-[2cqw]">
          <span className="truncate text-[5.2cqw] font-bold leading-none">{listing.shortName}</span>
          <span className="shrink-0 text-[4.4cqw] font-extrabold leading-none">
            {60 + (listing.art.seed % 24) * 10} HP
          </span>
        </div>
        <div className="mt-[2cqw] flex-1 overflow-hidden rounded-[0.6cqw] border-[0.8cqw] border-[#b3a780]">
          {children}
        </div>
        <div className="mt-[2cqw] space-y-[1.2cqw]">
          <div className="h-[2.6cqw] w-full rounded-full bg-black/15" />
          <div className="h-[2.6cqw] w-[78%] rounded-full bg-black/12" />
          <div className="flex items-center justify-between pt-[0.8cqw] text-[3cqw] font-medium opacity-70">
            <span className="truncate">{listing.set}</span>
            <span>#{listing.cardNumber}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function SportsFace({ listing, children }: { listing: Listing; children: React.ReactNode }) {
  const vintage = listing.year < 1995;
  return (
    <div
      className="h-full w-full p-[3.4cqw]"
      style={{
        background: vintage
          ? "linear-gradient(160deg,#f3ece0,#ddd2bd)"
          : `linear-gradient(160deg,#101018, hsl(${listing.art.hueA} 45% 22%))`,
      }}
    >
      <div className="flex h-full w-full flex-col overflow-hidden rounded-[1cqw]">
        <div className="flex-1 overflow-hidden">{children}</div>
        <div
          className="flex items-center justify-between gap-[2cqw] px-[3cqw] py-[2.4cqw]"
          style={{ background: `linear-gradient(90deg, hsl(${listing.art.hueA} 60% 32%), hsl(${listing.art.hueB} 55% 18%))` }}
        >
          <span className="truncate text-[4.6cqw] font-extrabold uppercase tracking-wide text-white">
            {listing.shortName}
          </span>
          <span className="shrink-0 text-[3.4cqw] font-semibold text-white/70">
            {listing.year}
          </span>
        </div>
      </div>
    </div>
  );
}

function AnimeFace({ listing, children }: { listing: Listing; children: React.ReactNode }) {
  return (
    <div className="h-full w-full bg-[#120a08] p-[3cqw]">
      <div className="flex h-full w-full flex-col overflow-hidden rounded-[1cqw] border-[0.8cqw] border-[#c2903f]">
        <div className="flex items-center justify-between bg-[#8c1c13] px-[2.6cqw] py-[1.8cqw]">
          <span className="truncate text-[4.4cqw] font-black uppercase text-[#f3d7a1]">
            {listing.shortName}
          </span>
          <span className="text-[3.6cqw] font-bold text-[#f3d7a1]/80">{listing.cardNumber}</span>
        </div>
        <div className="flex-1 overflow-hidden">{children}</div>
        <div className="space-y-[1.2cqw] bg-[#1c1310] px-[2.6cqw] py-[2.2cqw]">
          <div className="h-[2.2cqw] w-full rounded-full bg-[#f3d7a1]/25" />
          <div className="h-[2.2cqw] w-[70%] rounded-full bg-[#f3d7a1]/18" />
        </div>
      </div>
    </div>
  );
}

function MtgFace({ listing, children }: { listing: Listing; children: React.ReactNode }) {
  return (
    <div className="h-full w-full bg-[#0c0a08] p-[3cqw]">
      <div className="flex h-full w-full flex-col gap-[1.6cqw] rounded-[1cqw] bg-[#1b1611] p-[2.2cqw]">
        <div className="flex items-center justify-between rounded-[0.6cqw] bg-[#cdbfa2] px-[2.2cqw] py-[1.4cqw]">
          <span className="truncate text-[4cqw] font-bold text-[#1b1611]">{listing.shortName}</span>
          <span className="h-[3.4cqw] w-[3.4cqw] rounded-full bg-[#1b1611]/70" />
        </div>
        <div className="h-[46%] overflow-hidden rounded-[0.6cqw]">{children}</div>
        <div className="flex-1 space-y-[1.4cqw] rounded-[0.6cqw] bg-[#cdbfa2] p-[2.2cqw]">
          <div className="h-[2cqw] w-full rounded-full bg-[#1b1611]/20" />
          <div className="h-[2cqw] w-[85%] rounded-full bg-[#1b1611]/16" />
          <div className="h-[2cqw] w-[60%] rounded-full bg-[#1b1611]/12" />
        </div>
      </div>
    </div>
  );
}
