"use client";

import { getProductResearchInfo, type ProductResearchInfo } from "@/lib/ai/productContext";
import { CopyTextButton } from "./CopyTextButton";

function researchCopyText(info: ProductResearchInfo): string {
  const parts: string[] = [];
  if (info.query) parts.push(`Query:\n${info.query}`);
  if (info.notes) parts.push(info.notes);
  if (info.brief && info.brief !== info.notes) parts.push(`Marketing brief:\n${info.brief}`);
  if (info.citations?.length) {
    parts.push(
      `Sources:\n${info.citations
        .map((c) => (c.title?.trim() ? `${c.title}\n${c.url}` : c.url))
        .join("\n\n")}`
    );
  }
  if (parts.length) return parts.join("\n\n");
  return info.detail?.trim() ?? "";
}

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
  const copyText = researchCopyText(info);

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
        <span className="flex items-start justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 min-w-0">
            <span aria-hidden>{isPerplexity ? "🔍" : "📋"}</span>
            <span className="min-w-0">
              {info.title}
              {isPerplexity && (info.notes || info.citations?.length) ? (
                <span className="font-normal text-violet-500/90"> — tap to review</span>
              ) : null}
            </span>
          </span>
          {copyText ? (
            <CopyTextButton text={copyText} label="Copy research" className="mt-0.5" />
          ) : null}
        </span>
      </summary>
      <div className="px-2.5 pb-2.5 space-y-2 border-t border-white/70">
        {info.detail ? (
          <p className="text-[11px] leading-relaxed text-slate-500">{info.detail}</p>
        ) : null}
        {info.query ? (
          <div>
            <div className="flex items-center justify-between gap-2 mb-0.5">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Query
              </div>
              <CopyTextButton text={info.query} label="Copy query" />
            </div>
            <p className="text-[11px] leading-relaxed text-slate-600">{info.query}</p>
          </div>
        ) : null}
        {info.citations?.length ? (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-0.5">
              Sources ({info.citations.length})
            </div>
            <ul className="space-y-1 max-h-32 overflow-y-auto">
              {info.citations.map((citation) => (
                <li key={citation.url}>
                  <a
                    href={citation.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] leading-relaxed text-violet-700 hover:text-violet-900 hover:underline break-all"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {citation.title?.trim() || citation.url}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {info.notes ? (
          <div>
            <div className="flex items-center justify-between gap-2 mb-0.5">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Raw research
              </div>
              <CopyTextButton text={info.notes} label="Copy raw research" />
            </div>
            <p className="text-[11px] leading-relaxed text-slate-700 whitespace-pre-wrap max-h-40 overflow-y-auto">
              {info.notes}
            </p>
          </div>
        ) : null}
        {info.brief ? (
          <div>
            <div className="flex items-center justify-between gap-2 mb-0.5">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Marketing brief used
              </div>
              <CopyTextButton text={info.brief} label="Copy marketing brief" />
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
