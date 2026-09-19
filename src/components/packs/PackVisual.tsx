import clsx from "clsx";
import { BRAND } from "@/lib/brand";
import type { Pack } from "@/lib/types";

export function PackVisual({
  pack,
  className,
  torn = false,
}: {
  pack: Pack;
  className?: string;
  torn?: boolean;
}) {
  return (
    <div
      className={clsx("relative overflow-hidden rounded-xl", className)}
      style={{
        background: `linear-gradient(150deg, hsl(${pack.hueA} 70% 42%), hsl(${pack.hueB} 66% 18%) 70%, #07070c)`,
      }}
    >
      <div className="absolute inset-0 bg-[repeating-linear-gradient(115deg,rgba(255,255,255,0.07)_0_10px,transparent_10px_22px)]" />
      <div className="holo-sweep absolute inset-0" />
      <div className="relative flex h-full flex-col items-center justify-center gap-3 p-5 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-full border-2 border-white/70 text-[17px] font-black tracking-tight text-white">
          {BRAND.short}
        </span>
        <p className="text-[13px] font-black uppercase leading-tight tracking-[0.14em] text-white/90">
          {pack.group}
        </p>
        <p className="text-[15px] font-bold leading-tight text-white">{pack.name}</p>
      </div>
      {torn ? (
        <div className="absolute inset-x-0 top-1/3 h-[3px] bg-white/70 shadow-[0_0_20px_6px_rgba(255,255,255,0.5)]" />
      ) : null}
    </div>
  );
}
