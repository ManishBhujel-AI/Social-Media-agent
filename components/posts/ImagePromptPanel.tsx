"use client";

import { CopyTextButton } from "./CopyTextButton";

function promptPreview(prompt: string): string {
  const scaffoldIdx = prompt.indexOf("BRAND SCAFFOLD");
  const creative = scaffoldIdx > 0 ? prompt.slice(0, scaffoldIdx).trim() : prompt.trim();
  if (creative.length <= 88) return creative;
  return `${creative.slice(0, 85)}…`;
}

export function ImagePromptPanel({
  prompt,
  compact = false,
}: {
  prompt: string | null | undefined;
  compact?: boolean;
}) {
  const text = prompt?.trim();
  if (!text) return null;

  const preview = promptPreview(text);
  const hasFullPrompt = text.includes("BRAND SCAFFOLD") || text.length > preview.length + 4;

  return (
    <details
      className={`rounded-xl border border-sky-200/80 bg-white/50 ${compact ? "mt-1" : "mt-2"}`}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <summary className="cursor-pointer list-none px-2.5 py-1.5 text-[11px] font-semibold text-sky-700">
        <span className="flex items-start justify-between gap-2">
          <span className="min-w-0">
            <span className="inline-flex items-center gap-1.5 min-w-0">
              <span aria-hidden>🖼</span>
              <span className="truncate">Image prompt</span>
              {hasFullPrompt ? (
                <span className="font-normal text-sky-500/90 shrink-0">— tap to review</span>
              ) : null}
            </span>
            {preview ? (
              <span className="block mt-0.5 text-[10px] font-normal leading-snug text-slate-500 line-clamp-2">
                {preview}
              </span>
            ) : null}
          </span>
          <CopyTextButton text={text} label="Copy image prompt" className="mt-0.5" />
        </span>
      </summary>
      <div className="px-2.5 pb-2.5 border-t border-white/70">
        <p className="pt-2 text-[11px] leading-relaxed text-slate-700 whitespace-pre-wrap font-mono max-h-48 overflow-y-auto">
          {text}
        </p>
      </div>
    </details>
  );
}
