"use client";

import { useCallback, useState } from "react";
import { GLASS_CARD } from "@/lib/design/tokens";
import type { BrandKitFieldName } from "@/lib/brandKit/types";

export function BrandKitQuestionCard({
  projectId,
  conversationId,
  field,
  question,
  allowSkip,
  active,
  onResponded,
}: {
  projectId: string;
  conversationId: string;
  field: BrandKitFieldName;
  question: string;
  allowSkip: boolean;
  active: boolean;
  onResponded?: (ack?: string, userMessage?: string) => void;
}) {
  const [reply, setReply] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = useCallback(
    async (opts?: { skipped?: boolean }) => {
      if (!active || submitting) return;
      if (!opts?.skipped && !reply.trim()) return;
      setSubmitting(true);
      try {
        const res = await fetch(`/api/projects/${projectId}/brand-kit/answer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId,
            field,
            answer: opts?.skipped ? undefined : reply.trim(),
            skipped: opts?.skipped,
          }),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          message?: string;
          error?: string;
        };
        if (!res.ok || data.error) {
          onResponded?.(data.error ?? "Could not save answer. Try again.");
          return;
        }
        const userMessage = opts?.skipped ? "Skipped — none for this brand" : reply.trim();
        setReply("");
        onResponded?.(data.message, userMessage);
      } finally {
        setSubmitting(false);
      }
    },
    [active, submitting, reply, projectId, conversationId, field, onResponded]
  );

  return (
    <div
      className={`${GLASS_CARD} max-w-[420px] overflow-hidden ${
        active ? "ring-2 ring-violet-400/40" : "opacity-75"
      }`}
    >
      <div className="px-4 py-3 border-b border-white/70 bg-violet-500/8">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-violet-700">
          Brand setup · Agent question
        </div>
      </div>
      <div className="p-4 flex flex-col gap-3">
        <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{question}</p>

        {active ? (
          <>
            <textarea
              className="w-full min-h-[72px] px-3 py-2.5 rounded-xl text-sm bg-white/80 border border-violet-400/30 outline-none focus:border-violet-500/50 resize-y placeholder:text-slate-400"
              placeholder={
                field === "colors"
                  ? "e.g. navy #1A2B3C, gold, white"
                  : "Type your answer here…"
              }
              value={reply}
              disabled={submitting}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
            />
            <div className="flex flex-col gap-2">
              <button
                type="button"
                disabled={submitting || !reply.trim()}
                onClick={() => void submit()}
                className="w-full py-2.5 rounded-xl text-[13px] font-semibold text-white bg-gradient-to-br from-violet-600 to-indigo-500 hover:from-violet-700 hover:to-indigo-600 disabled:opacity-50 transition-colors"
              >
                {submitting ? "Saving…" : "Send answer"}
              </button>
              {allowSkip ? (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void submit({ skipped: true })}
                  className="w-full py-2.5 rounded-xl text-[13px] font-medium text-slate-600 bg-white/70 border border-slate-200 hover:bg-white disabled:opacity-50 transition-colors"
                >
                  Skip — none for this brand
                </button>
              ) : null}
            </div>
          </>
        ) : (
          <p className="text-[11px] text-center text-slate-400">
            Answer the active brand setup card above first.
          </p>
        )}
      </div>
    </div>
  );
}
