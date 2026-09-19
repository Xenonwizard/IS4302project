import clsx from "clsx";
import { CardArt } from "./CardArt";
import type { Grader, Listing } from "@/lib/types";

const GRADER_STYLE: Record<
  Grader,
  { bar: string; barText: string; wordmark: string; sub: string; accent: string }
> = {
  CGC: {
    bar: "#121214",
    barText: "#ffffff",
    wordmark: "CGC",
    sub: "CERTIFIED GUARANTY COMPANY",
    accent: "#1c1c22",
  },
  PSA: {
    bar: "#b3121c",
    barText: "#ffffff",
    wordmark: "PSA",
    sub: "PROFESSIONAL SPORTS AUTHENTICATOR",
    accent: "#b3121c",
  },
  BGS: {
    bar: "#0d1a3a",
    barText: "#e8c879",
    wordmark: "BECKETT",
    sub: "BGS AUTHENTIC GRADING",
    accent: "#0d1a3a",
  },
  SGC: {
    bar: "#101010",
    barText: "#d8b45a",
    wordmark: "SGC",
    sub: "SPORTSCARD GUARANTY",
    accent: "#8a6f2a",
  },
};

export function Slab({
  listing,
  className,
  flat = false,
  fit = false,
}: {
  listing: Listing;
  className?: string;
  /** flat drops the plastic glare — used for tiny thumbnails */
  flat?: boolean;
  /** fit sizes from the parent's height instead of its width */
  fit?: boolean;
}) {
  const g = GRADER_STYLE[listing.grader];
  const gradeText = String(listing.grade);

  return (
    <div
      className={clsx(
        "@container relative",
        fit ? "h-full w-full" : "aspect-[0.63] w-full",
        className,
      )}
    >
      {/* plastic case */}
      <div
        className="absolute inset-0 rounded-[4cqw] p-[3.2cqw]"
        style={{
          background:
            "linear-gradient(155deg, rgba(255,255,255,0.30), rgba(255,255,255,0.10) 42%, rgba(255,255,255,0.22))",
          boxShadow:
            "0 22px 44px -18px rgba(0,0,0,0.95), inset 0 0 0 1px rgba(255,255,255,0.22)",
        }}
      >
        {/* inner insert */}
        <div className="flex h-full w-full flex-col gap-[2.2cqw] overflow-hidden rounded-[2.4cqw] bg-[#eceae4] p-[2.6cqw]">
          {/* grading label */}
          <div className="overflow-hidden rounded-[1cqw] bg-white shadow-[0_0.4cqw_1cqw_rgba(0,0,0,0.18)]">
            <div
              className="flex items-center justify-between px-[2cqw] py-[1cqw]"
              style={{ background: g.bar, color: g.barText }}
            >
              <span className="text-[4cqw] font-black leading-none tracking-tight">
                {g.wordmark}
              </span>
              <span className="truncate pl-[1.5cqw] text-[1.9cqw] font-semibold leading-none tracking-[0.08em] opacity-90">
                {g.sub}
              </span>
            </div>
            <div className="flex items-stretch">
              <div className="min-w-0 flex-1 px-[2cqw] py-[1.4cqw]">
                <p className="truncate text-[2.7cqw] font-bold leading-[1.25] text-[#15151a]">
                  {listing.shortName}
                </p>
                <p className="truncate text-[2.2cqw] leading-[1.35] text-[#3d3d46]">
                  {listing.category} ({listing.year})
                </p>
                <p className="truncate text-[2.2cqw] leading-[1.35] text-[#3d3d46]">
                  {listing.set} - {listing.cardNumber}
                </p>
                <p className="truncate text-[2.2cqw] leading-[1.35] text-[#3d3d46]">
                  {listing.variant}
                </p>
              </div>
              <div
                className="flex w-[24%] flex-col items-center justify-center border-l border-black/10 px-[1cqw] py-[1cqw]"
                style={{ color: "#15151a" }}
              >
                <span className="text-center text-[1.9cqw] font-bold uppercase leading-none tracking-tight">
                  {listing.gradeLabel}
                </span>
                <span className="text-[8.5cqw] font-black leading-[1.05]">{gradeText}</span>
              </div>
            </div>
            <div className="flex items-center gap-[1cqw] px-[2cqw] pb-[1.2cqw]">
              <div
                className="h-[2cqw] flex-1"
                style={{
                  background:
                    "repeating-linear-gradient(90deg,#15151a 0 0.4cqw,transparent 0.4cqw 0.9cqw,#15151a 0.9cqw 1.1cqw,transparent 1.1cqw 1.7cqw)",
                }}
              />
              <span className="text-[1.8cqw] font-medium tabular-nums text-[#3d3d46]">
                {listing.certNumber}
              </span>
            </div>
          </div>

          {/* the card itself */}
          <div className="@container min-h-0 flex-1 overflow-hidden rounded-[1.4cqw] shadow-[0_0.6cqw_1.6cqw_rgba(0,0,0,0.35)]">
            <CardArt listing={listing} />
          </div>
        </div>

        {/* case glare */}
        {!flat ? (
          <>
            <div className="pointer-events-none absolute inset-0 rounded-[4cqw] bg-[linear-gradient(115deg,rgba(255,255,255,0.28)_0%,transparent_28%,transparent_72%,rgba(255,255,255,0.14)_100%)]" />
            <div className="pointer-events-none absolute left-[8%] top-0 h-full w-[14%] rotate-[8deg] bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.16),transparent)]" />
          </>
        ) : null}
      </div>
    </div>
  );
}

/** Detail-page presentation: slab floating over a lit pedestal. */
export function SlabStage({
  listing,
  spinning = false,
}: {
  listing: Listing;
  spinning?: boolean;
}) {
  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_38%,rgba(255,255,255,0.07),transparent_70%)]" />
      <div className="relative aspect-[0.63] h-[76%] max-h-[420px] [perspective:1400px]">
        <div
          className={clsx(
            "h-full w-full",
            spinning
              ? "spin-slab"
              : "transition-transform duration-500 hover:[transform:rotateY(-10deg)_rotateX(4deg)]",
          )}
        >
          <Slab listing={listing} fit />
        </div>
        {/* pedestal */}
        <div className="pointer-events-none absolute -bottom-5 left-1/2 h-[46px] w-[82%] -translate-x-1/2">
          <div className="absolute left-1/2 top-3 h-[32px] w-full -translate-x-1/2 rounded-[50%] bg-[linear-gradient(180deg,#3a3a42,#16161a)] shadow-[0_20px_40px_-10px_rgba(0,0,0,0.9)]" />
          <div className="absolute left-1/2 top-0 h-[24px] w-[86%] -translate-x-1/2 rounded-[50%] bg-[linear-gradient(180deg,#54545d,#2a2a31)]" />
        </div>
      </div>
    </div>
  );
}
