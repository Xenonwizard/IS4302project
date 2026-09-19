import { BRAND } from "@/lib/brand";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
        <circle cx="16" cy="16" r="16" fill="#fff" />
        <path
          d="M16 6c-4.4 0-8 3.6-8 8v12h5.2v-12c0-1.6 1.2-2.8 2.8-2.8s2.8 1.2 2.8 2.8v12H24V14c0-4.4-3.6-8-8-8Z"
          fill="#000"
        />
        <circle cx="16" cy="22" r="2.6" fill="#000" />
      </svg>
      {!compact ? (
        <span className="text-[19px] font-bold tracking-tight">{BRAND.name}</span>
      ) : null}
    </span>
  );
}
