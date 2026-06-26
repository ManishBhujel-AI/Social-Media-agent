"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { LayoutGroup, AnimatePresence } from "framer-motion";
import { taskSubLabel } from "@/lib/design/tokens";
import { useProjectStream, type TaskWithMeta } from "@/hooks/useProjectStream";
import { mergeTaskStreamEvent, getActiveBoardTask } from "@/lib/tasks/taskStream";
import { useProjectTasks } from "@/hooks/useProjectTasks";
import { PostCard } from "@/components/posts/PostCard";

const COLUMNS = [
  { key: "notstarted", statuses: ["NOT_STARTED"] },
  {
    key: "progress",
    statuses: ["AGENT_RUNNING", "WRITING_CAPTION", "WRITING_PROMPT", "GENERATING_IMAGE"],
  },
  { key: "failed", statuses: ["FAILED"] },
  { key: "needsinfo", statuses: ["NEEDS_INFO"] },
  { key: "needs", statuses: ["NEEDS_APPROVAL"] },
  { key: "changes", statuses: ["CHANGES_REQUESTED"] },
  { key: "approved", statuses: ["APPROVED"] },
] as const;

export function BoardView({
  projectId,
  initialTasks,
}: {
  projectId: string;
  initialTasks: TaskWithMeta[];
}) {
  const router = useRouter();
  const [variant, setVariant] = useState<"columns" | "swim">("columns");
  const { tasks, refreshTasks } = useProjectTasks(initialTasks);
  const kickedRecoveryRef = useRef(false);

  const refresh = useCallback(async () => {
    await refreshTasks();
    router.refresh();
  }, [refreshTasks, router]);

  useEffect(() => {
    if (kickedRecoveryRef.current) return;
    kickedRecoveryRef.current = true;
    void fetch(`/api/projects/${projectId}/kick-pipeline`, { method: "POST" })
      .then(() => refresh())
      .catch(() => {});
  }, [projectId, refresh]);

  const onTaskEvent = useCallback(
    (event: { type: "task.created" | "task.updated"; payload: Parameters<typeof mergeTaskStreamEvent>[2] }) => {
      const needsFullRefresh =
        event.payload.status === "NEEDS_APPROVAL" ||
        event.payload.status === "NEEDS_INFO" ||
        event.payload.status === "FAILED";
      if (needsFullRefresh) void refresh();
    },
    [refresh]
  );

  useProjectStream(projectId, { onTaskEvent });

  const sorted = useMemo(
    () => [...tasks].sort((a, b) => a.orderIndex - b.orderIndex),
    [tasks]
  );

  const activeTask = getActiveBoardTask(sorted);
  const activeIndex = activeTask ? sorted.indexOf(activeTask) + 1 : 0;
  const activeLabel = activeTask
    ? taskSubLabel(activeTask.status, {
        statusLabel: activeTask.statusLabel,
        pendingQuestion: activeTask.pendingQuestion,
      })
    : null;

  const failedCount = sorted.filter((t) => t.status === "FAILED").length;
  const showAgentHeader = Boolean(
    activeTask && !["APPROVED", "FAILED"].includes(activeTask.status)
  );

  const labels: Record<string, string> = {
    notstarted: "Not started",
    progress: "In progress",
    failed: "Failed",
    needsinfo: "Waiting for photo",
    needs: "Needs approval",
    changes: "Changes requested",
    approved: "Approved",
  };

  const columnDotColor = (key: string) => {
    switch (key) {
      case "progress":
        return "#3b82f6";
      case "failed":
        return "#ef4444";
      case "needsinfo":
        return "#ea580c";
      case "needs":
        return "#f59e0b";
      default:
        return "#94a3b8";
    }
  };

  if (!tasks.length) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] px-8 text-center">
        <div className="text-[15px] font-semibold text-slate-700">No posts yet</div>
        <p className="mt-2 text-sm text-slate-500 max-w-md">
          Start in Brief &amp; Chat — once the agent creates your posts, they&apos;ll show up here
          as they move through the pipeline.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-full">
      <div className="flex items-center gap-3 px-[30px] pt-[18px] pb-1.5">
        <div className="flex gap-0.5 p-1 rounded-xl bg-white/55 border border-white/80">
          {(["columns", "swim"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setVariant(v)}
              className={`px-3.5 py-1.5 rounded-[9px] text-[13px] font-semibold ${
                variant === v ? "bg-white/90 shadow text-slate-800" : "text-slate-500"
              }`}
            >
              {v === "columns" ? "Columns" : "Compact rows"}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {showAgentHeader ? (
          <div className="flex items-center gap-2.5 px-4 py-2 rounded-xl bg-white/70 border border-white/90 shadow-[0_4px_14px_rgba(30,41,59,0.06)]">
            <span
              className="inline-block w-4 h-4 rounded-full border-2 border-blue-400 border-t-transparent animate-spin"
              aria-hidden
            />
            <div className="text-[13px] leading-snug">
              <span className="font-semibold text-slate-800">
                Agent working on Post {activeIndex} of {sorted.length}
              </span>
              {activeLabel ? (
                <span className="block text-[12px] text-slate-500">{activeLabel}</span>
              ) : null}
            </div>
          </div>
        ) : failedCount > 0 ? (
          <div className="flex items-center gap-2.5 px-4 py-2 rounded-xl bg-red-500/8 border border-red-500/20">
            <span className="text-[13px] font-semibold text-red-800">
              {failedCount === 1
                ? "1 post failed — use Retry on the board card"
                : `${failedCount} posts failed — use Retry on the board cards`}
            </span>
          </div>
        ) : null}
      </div>

      <LayoutGroup>
        {variant === "columns" ? (
          <div className="flex gap-4 px-[30px] py-3.5 pb-8 min-w-max">
            {COLUMNS.map((col) => {
              const items = sorted.filter((t) => col.statuses.includes(t.status as never));
              return (
                <div key={col.key} className="w-[266px] flex-none flex flex-col">
                  <div className="flex items-center gap-2 px-1.5 pb-3">
                    <span
                      className={`w-2 h-2 rounded-full ${col.key === "progress" ? "animate-blpulse shadow-[0_0_0_4px_rgba(59,130,246,0.18)]" : ""}`}
                      style={{ background: columnDotColor(col.key) }}
                    />
                    <span className="text-[13px] font-semibold text-slate-700">{labels[col.key]}</span>
                    <span className="text-xs font-semibold text-slate-400">{items.length}</span>
                  </div>
                  <div className="flex-1 flex flex-col gap-2.5 p-2.5 rounded-[20px] bg-white/32 border border-white/60 min-h-[120px]">
                    <AnimatePresence initial={false} mode="popLayout">
                      {items.length ? (
                        items.map((t) => <PostCard key={t.id} task={t} projectId={projectId} />)
                      ) : (
                        <p key={`empty-${col.key}`} className="px-2 py-6 text-center text-xs text-slate-400">
                          No posts
                        </p>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col gap-4 px-[30px] py-3.5 pb-8">
            {COLUMNS.map((col) => {
              const items = sorted.filter((t) => col.statuses.includes(t.status as never));
              if (!items.length) return null;
              return (
                <div key={col.key}>
                  <div className="flex items-center gap-2 pb-2.5">
                    <span className="text-[13px] font-semibold">{labels[col.key]}</span>
                    <span className="text-xs text-slate-400">{items.length}</span>
                  </div>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
                    <AnimatePresence initial={false} mode="popLayout">
                      {items.map((t) => (
                        <PostCard key={t.id} task={t} compact projectId={projectId} />
                      ))}
                    </AnimatePresence>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </LayoutGroup>
    </div>
  );
}
