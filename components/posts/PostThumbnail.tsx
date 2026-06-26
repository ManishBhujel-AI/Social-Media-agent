"use client";

import type { StatusKey } from "@/lib/design/tokens";
import { STATUS_META } from "@/lib/design/tokens";

const HUES = [215, 230, 245, 200, 265, 185];

export function PostThumbnail({
  seed = 0,
  height = "100%",
  label,
  imageUrl,
  imageKey,
}: {
  seed?: number;
  height?: string;
  label?: string | null;
  imageUrl?: string | null;
  /** Bust browser cache when the graphic version changes. */
  imageKey?: string | null;
}) {
  const hue = HUES[seed % HUES.length];
  if (imageUrl) {
    return (
      <div className="relative w-full overflow-hidden rounded-[14px] border border-black/5" style={{ height }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={imageKey ?? imageUrl}
          src={imageUrl}
          alt=""
          className="w-full h-full object-cover"
        />
        {label && (
          <div className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded-md text-[10px] font-mono text-slate-600 bg-white/82">
            {label}
          </div>
        )}
      </div>
    );
  }
  return (
    <div
      className="relative w-full overflow-hidden rounded-[14px] border border-black/5 flex items-end"
      style={{
        height,
        background: `repeating-linear-gradient(135deg, hsl(${hue} 32% 94%) 0 11px, hsl(${hue} 28% 90%) 11px 22px)`,
      }}
    >
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className="w-11 h-11 rounded-[13px] flex items-center justify-center text-slate-500/70"
          style={{ background: `hsl(${hue} 40% 88%)` }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
            <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="9" cy="10" r="1.5" fill="currentColor" />
            <path d="M3 16l4.5-4.5 3 3L17 9l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
      {label && (
        <div className="relative m-2 px-1.5 py-0.5 rounded-md text-[10px] font-mono text-slate-600 bg-white/82">
          {label}
        </div>
      )}
    </div>
  );
}

export function StatusChip({ statusKey }: { statusKey: string }) {
  const m = STATUS_META[statusKey as StatusKey] ?? STATUS_META.notstarted;
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11.5px] font-semibold"
      style={{ color: m.fg, background: m.bg }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: m.dot }} />
      {m.label}
    </span>
  );
}
