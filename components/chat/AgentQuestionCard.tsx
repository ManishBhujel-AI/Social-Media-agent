"use client";

import { useCallback, useState } from "react";
import { GLASS_CARD } from "@/lib/design/tokens";
import type { Task } from "@prisma/client";
import { taskHasAssignedImage } from "@/lib/tasks/taskPauseState";

export function AgentQuestionCard({
  projectId,
  conversationId,
  task,
  question,
  active,
  onResponded,
}: {
  projectId: string;
  conversationId: string;
  task: Task;
  question: string;
  active: boolean;
  onResponded?: (ack?: string, userMessage?: string) => void;
}) {
  const [reply, setReply] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const photosSaved = taskHasAssignedImage(task);
  const photoCount = ((task.sourceImages as string[] | null) ?? []).length;

  const sendReply = useCallback(
    async (message: string) => {
      const trimmed = message.trim();
      if (!active || submitting || !trimmed) return;
      setSubmitting(true);
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            conversationId,
            taskId: task.id,
            message: trimmed,
          }),
        });
        const contentType = res.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
          const data = (await res.json()) as {
            mode?: string;
            message?: string;
            error?: string;
          };
          if (data.error || res.status === 409) {
            onResponded?.(data.error ?? data.message ?? "Could not send answer. Try again.");
            return;
          }
          setReply("");
          onResponded?.(data.mode === "resume" ? data.message : undefined, trimmed);
        } else {
          await res.text();
          setReply("");
          onResponded?.(undefined, trimmed);
        }
      } finally {
        setSubmitting(false);
      }
    },
    [active, submitting, projectId, conversationId, task.id, onResponded]
  );

  const respond = useCallback(() => void sendReply(reply), [reply, sendReply]);

  return (
    <div
      className={`${GLASS_CARD} max-w-[420px] overflow-hidden ${
        active ? "ring-2 ring-amber-400/40" : "opacity-75"
      }`}
    >
      <div className="px-4 py-3 border-b border-white/70 bg-amber-500/8">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">
          Post {task.orderIndex + 1} · Agent question
        </div>
        <div className="text-[15px] font-bold text-slate-800 mt-0.5 leading-snug">{task.title}</div>
      </div>
      <div className="p-4 flex flex-col gap-3">
        {photosSaved ? (
          <div className="px-3 py-2 rounded-xl text-[12px] text-green-800 bg-green-500/10 border border-green-500/20">
            ✓ {photoCount > 1 ? `${photoCount} photos saved` : "Photo saved"} — still need a short
            product description for the caption.
          </div>
        ) : null}
        <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{question}</p>

        {active ? (
          <>
            <textarea
              className="w-full min-h-[72px] px-3 py-2.5 rounded-xl text-sm bg-white/80 border border-amber-400/30 outline-none focus:border-amber-500/50 resize-y placeholder:text-slate-400"
              placeholder={
                photosSaved
                  ? "e.g. MERV 8 pleated filters for Hawaii HVAC contractors…"
                  : "Type your answer here…"
              }
              value={reply}
              disabled={submitting}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void respond();
                }
              }}
            />
            {photosSaved ? (
              <button
                type="button"
                disabled={submitting}
                onClick={() =>
                  void sendReply("Use the client-approved caption I pasted earlier for this product.")
                }
                className="w-full py-2 rounded-xl text-[12px] font-semibold text-violet-700 bg-violet-500/10 border border-violet-500/20 hover:bg-violet-500/15 disabled:opacity-50"
              >
                Use my saved caption
              </button>
            ) : null}
            <button
              type="button"
              disabled={submitting || !reply.trim()}
              onClick={() => void respond()}
              className="w-full py-2.5 rounded-xl text-[13px] font-semibold text-white bg-gradient-to-br from-violet-600 to-indigo-500 hover:from-violet-700 hover:to-indigo-600 disabled:opacity-50 transition-colors"
            >
              {submitting ? "Sending…" : "Send answer"}
            </button>
            <p className="text-[11px] text-amber-800/75 text-center">
              Other posts keep running while you reply here.
            </p>
          </>
        ) : (
          <p className="text-[11px] text-center text-slate-400">
            Answer the active post above first.
          </p>
        )}
      </div>
    </div>
  );
}
