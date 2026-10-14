import clsx from "clsx";
import { useId } from "react";

/**
 * The back of a Pokémon card: navy border, a swirling blue vortex, a glossy Poké
 * Ball floating in the middle, and the yellow logo at the top and mirrored at the
 * bottom. Drawn as SVG so it stays sharp at any size.
 */
export function CardBack({ className }: { className?: string }) {
  const uid = useId().replace(/:/g, "");
  const id = (name: string) => `${name}${uid}`;
  const url = (name: string) => `url(#${id(name)})`;

  // Spiral arms of the vortex, each rotated around the ball.
  const arms = [0, 60, 120, 180, 240, 300];

  return (
    <svg
      viewBox="0 0 630 880"
      preserveAspectRatio="xMidYMid slice"
      className={clsx("block h-full w-full", className)}
      role="img"
      aria-label="Pokémon card back"
    >
      <defs>
        <radialGradient id={id("field")} cx="50%" cy="50%" r="72%">
          <stop offset="0" stopColor="#e6f4ff" />
          <stop offset="0.18" stopColor="#8cc4f5" />
          <stop offset="0.45" stopColor="#3f82dc" />
          <stop offset="0.75" stopColor="#2257b8" />
          <stop offset="1" stopColor="#163a8c" />
        </radialGradient>
        <linearGradient id={id("arm")} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="0.45" stopColor="#ffffff" stopOpacity="0.85" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={id("vignette")} cx="50%" cy="50%" r="70%">
          <stop offset="0.6" stopColor="#0b2266" stopOpacity="0" />
          <stop offset="1" stopColor="#0b2266" stopOpacity="0.55" />
        </radialGradient>
        <radialGradient id={id("red")} cx="35%" cy="25%" r="85%">
          <stop offset="0" stopColor="#ff8a66" />
          <stop offset="0.35" stopColor="#ee3b25" />
          <stop offset="1" stopColor="#9c1710" />
        </radialGradient>
        <radialGradient id={id("white")} cx="40%" cy="20%" r="95%">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.55" stopColor="#e3e6ec" />
          <stop offset="1" stopColor="#9da3ae" />
        </radialGradient>
        <radialGradient id={id("button")} cx="40%" cy="35%" r="70%">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.6" stopColor="#dce8f3" />
          <stop offset="1" stopColor="#a7bccf" />
        </radialGradient>
        <linearGradient id={id("gloss")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.85" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <filter id={id("blur")} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
        <filter id={id("shadow")} x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="14" stdDeviation="14" floodColor="#061540" floodOpacity="0.6" />
        </filter>
        <filter id={id("logoShadow")} x="-10%" y="-30%" width="120%" height="160%">
          <feDropShadow dx="0" dy="4" stdDeviation="2" floodColor="#0a1d55" floodOpacity="0.7" />
        </filter>
        <clipPath id={id("inner")}>
          <rect x="30" y="30" width="570" height="820" rx="14" />
        </clipPath>
      </defs>

      {/* navy border */}
      <rect width="630" height="880" rx="34" fill="#1b3880" />

      {/* swirling vortex */}
      <g clipPath={url("inner")}>
        <rect x="30" y="30" width="570" height="820" fill={url("field")} />
        <g filter={url("blur")} opacity="0.75">
          {arms.map((deg, i) => (
            <path
              key={deg}
              d="M315 440 C 420 330, 560 360, 600 520"
              fill="none"
              stroke={url("arm")}
              strokeWidth={i % 2 ? 22 : 40}
              strokeLinecap="round"
              transform={`rotate(${deg} 315 440)`}
            />
          ))}
        </g>
        <g filter={url("blur")} opacity="0.45">
          {arms.map((deg) => (
            <path
              key={deg}
              d="M315 440 C 380 300, 520 260, 620 330"
              fill="none"
              stroke="#ffffff"
              strokeWidth="10"
              strokeLinecap="round"
              transform={`rotate(${deg + 30} 315 440)`}
            />
          ))}
        </g>
        <rect x="30" y="30" width="570" height="820" fill={url("vignette")} />
      </g>

      {/* glossy Poké Ball */}
      <g transform="rotate(-16 315 440)" filter={url("shadow")}>
        <path d="M148 440 A167 167 0 0 1 482 440 Z" fill={url("red")} />
        <path d="M148 440 A167 167 0 0 0 482 440 Z" fill={url("white")} />
        <rect x="148" y="425" width="334" height="30" fill="#151515" />
        <circle cx="315" cy="440" r="167" fill="none" stroke="#151515" strokeWidth="12" />
        <circle cx="315" cy="440" r="58" fill="#151515" />
        <circle cx="315" cy="440" r="40" fill={url("button")} />
        <circle cx="315" cy="440" r="40" fill="none" stroke="#8ea5ba" strokeWidth="4" />
        <circle cx="304" cy="428" r="11" fill="#ffffff" opacity="0.9" />
        {/* specular highlights */}
        <ellipse cx="248" cy="338" rx="70" ry="34" fill={url("gloss")} transform="rotate(-28 248 338)" />
        <circle cx="388" cy="330" r="10" fill="#ffffff" opacity="0.7" />
        <path d="M190 500 A140 140 0 0 0 300 590" fill="none" stroke="#ffffff" strokeWidth="6" strokeLinecap="round" opacity="0.55" />
      </g>

      {/* logo, top and mirrored at the bottom */}
      <Logo x={215} y={160} rotate={-7} filter={url("logoShadow")} />
      <Logo x={415} y={720} rotate={173} filter={url("logoShadow")} />
    </svg>
  );
}

function Logo({ x, y, rotate, filter }: { x: number; y: number; rotate: number; filter: string }) {
  const text = {
    x: 0,
    y: 0,
    textAnchor: "middle" as const,
    dominantBaseline: "middle" as const,
    fontFamily: "'Arial Black', 'Helvetica Neue', Arial, sans-serif",
    fontWeight: 900,
    fontSize: 92,
    textLength: 360,
    lengthAdjust: "spacingAndGlyphs" as const,
  };
  return (
    <g transform={`translate(${x} ${y}) rotate(${rotate})`} filter={filter}>
      {/* thick navy outline, then the yellow letters with a blue inner edge */}
      <text {...text} fill="#1d3f8f" stroke="#1d3f8f" strokeWidth="26" strokeLinejoin="round">
        POKéMON
      </text>
      <text {...text} fill="#ffcb05" stroke="#3b6fc4" strokeWidth="7" strokeLinejoin="round" paintOrder="stroke">
        POKéMON
      </text>
      <text x="190" y="-30" fontFamily="Arial, sans-serif" fontSize="18" fontWeight="700" fill="#ffffff">
        TM
      </text>
    </g>
  );
}
