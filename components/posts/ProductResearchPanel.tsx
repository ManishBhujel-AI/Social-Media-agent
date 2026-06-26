"use client";

import { getProductResearchInfo } from "@/lib/ai/productContext";

export function ProductResearchPanel({
  productSummary,
  compact = false,
}: {
  productSummary: unknown;
  compact?: boolean;
}) {
  const info = getProductResearchInfo(productSummary);
  if (!info) return null;

  const isPerplexity = info.source === "search";

  return (
    <details
      className={`rounded-xl border bg-white/50 ${
        isPerplexity ? "border-violet-200/80" : "border-slate-200/70"
      } ${compact ? "mt-1" : "mt-2"}`}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <summary
        className={`cursor-pointer list-none px-2.5 py-1.5 text-[11px] font-semibold ${
          isPerplexity ? "text-violet-700" : "text-slate-500"
        }`}
      >
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden>{isPerplexity ? "🔍" : "📋"}</span>
          {info.title}
          {isPerplexity && info.notes ? (
            <span className="font-normal text-violet-500/90">— tap to review</span>
          ) : null}
        </span>
      </summary>
      <div className="px-2.5 pb-2.5 space-y-2 border-t border-white/70">
        {info.detail ? (
          <p className="text-[11px] leading-relaxed text-slate-500">{info.detail}</p>
        ) : null}
        {info.query ? (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-0.5">
              Query
            </div>
            <p className="text-[11px] leading-relaxed text-slate-600">{info.query}</p>
          </div>
        ) : null}
        {info.notes ? (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-0.5">
              Raw research
            </div>
            <p className="text-[11px] leading-relaxed text-slate-700 whitespace-pre-wrap max-h-40 overflow-y-auto">
              {info.notes}
            </p>
          </div>
        ) : null}
        {info.brief ? (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-0.5">
              Marketing brief used
            </div>
            <p className="text-[11px] leading-relaxed text-slate-600 whitespace-pre-wrap">
              {info.brief}
            </p>
          </div>
        ) : null}
      </div>
    </details>
  );
}
