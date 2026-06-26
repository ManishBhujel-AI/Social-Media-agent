"use client";

import type { Task } from "@prisma/client";
import { getActiveBoardTask } from "@/lib/tasks/taskStream";
import { taskSubLabel } from "@/lib/design/tokens";
import { allImagesCollected, countActiveInProgressTasks } from "@/lib/tasks/pendingTask";
import { isAgentQuestionPause, isUserPausedTask, taskHasAssignedImage } from "@/lib/tasks/taskPauseState";

export type ChatStatusTone = "planning" | "working" | "waiting" | "idle";

const IN_PROGRESS = [
  "AGENT_RUNNING",
  "WRITING_CAPTION",
  "WRITING_PROMPT",
  "GENERATING_IMAGE",
] as const;

export function deriveChatStatus(params: {
  loading: boolean;
  stopping?: boolean;
  pipelinePaused?: boolean;
  agentActivity: string | null;
  tasks: Task[];
  pendingTask?: Task;
  activeImageRequestTaskId?: string | null;
  pendingBrandKitQuestion?: { field: string; pendingQuestion: string } | null;
}): { label: string; detail?: string; tone: ChatStatusTone; spinning?: boolean } | null {
  const {
    loading,
    stopping,
    pipelinePaused,
    agentActivity,
    tasks,
    pendingTask,
    activeImageRequestTaskId,
    pendingBrandKitQuestion,
  } = params;

  if (stopping) {
    return {
      label: "Stopping…",
      tone: "planning",
    };
  }

  if (pendingBrandKitQuestion) {
    return {
      label: "Brand setup — waiting for your answer",
      detail: pendingBrandKitQuestion.pendingQuestion,
      tone: "waiting",
    };
  }

  if (loading || agentActivity) {
    return {
      label: agentActivity ?? "Thinking…",
      tone: "planning",
    };
  }

  const sorted = [...tasks].sort((a, b) => a.orderIndex - b.orderIndex);
  const total = sorted.length;

  if (pipelinePaused) {
    const done = sorted.filter((t) => t.status === "NEEDS_APPROVAL" || t.status === "APPROVED")
      .length;
    const unfinished = sorted.filter(
      (t) => !["NEEDS_APPROVAL", "APPROVED", "FAILED"].includes(t.status)
    );
    if (!unfinished.length) return null;
    return {
      label: "Work paused",
      detail: done > 0 ? `${done} of ${total} posts ready` : "Tap Resume work to continue",
      tone: "waiting",
      spinning: false,
    };
  }

  if (
    total > 0 &&
    sorted.every((t) => ["NEEDS_APPROVAL", "APPROVED", "FAILED"].includes(t.status))
  ) {
    return null;
  }

  if (pendingTask?.status === "NEEDS_INFO" && activeImageRequestTaskId) {
    return {
      label: `Post ${pendingTask.orderIndex + 1} of ${total} — upload photo`,
      detail: pendingTask.title,
      tone: "waiting",
    };
  }

  if (pendingTask?.status === "NEEDS_INFO") {
    const detail =
      pendingTask.statusLabel ??
      taskSubLabel(pendingTask.status, {
        statusLabel: pendingTask.statusLabel,
        pendingQuestion: pendingTask.pendingQuestion,
      }) ??
      "Answer in the chat below";
  const photoHint =
    isAgentQuestionPause(pendingTask) && taskHasAssignedImage(pendingTask)
      ? "Photos saved — need a short product description"
      : undefined;
    return {
      label: `Waiting on you — ${pendingTask.title}`,
      detail: photoHint ? `${photoHint}. ${detail}` : detail,
      tone: "waiting",
    };
  }

  const inProgressCount = countActiveInProgressTasks(sorted);
  const inProgressTasks = sorted.filter(
    (t) =>
      IN_PROGRESS.includes(t.status as (typeof IN_PROGRESS)[number]) && !isUserPausedTask(t)
  );

  if (allImagesCollected(sorted) && inProgressCount > 0) {
    const done = sorted.filter((t) => t.status === "NEEDS_APPROVAL" || t.status === "APPROVED")
      .length;
    const detail = inProgressTasks
      .map(
        (t) =>
          t.statusLabel ??
          taskSubLabel(t.status, {
            statusLabel: t.statusLabel,
            pendingQuestion: t.pendingQuestion,
          }) ??
          t.title
      )
      .join(" · ");

    return {
      label:
        inProgressCount > 1
          ? `Creating ${inProgressCount} posts in parallel…`
          : `Creating post ${inProgressTasks[0]?.orderIndex != null ? inProgressTasks[0].orderIndex + 1 : 1} of ${total}…`,
      detail: done > 0 ? `${done} ready · ${detail}` : detail,
      tone: "working",
    };
  }

  const active = getActiveBoardTask(sorted);
  const notStarted = sorted.filter((t) => t.status === "NOT_STARTED").length;

  if (active && !isUserPausedTask(active)) {
    const index = sorted.indexOf(active) + 1;
    const detail =
      active.statusLabel ??
      taskSubLabel(active.status, {
        statusLabel: active.statusLabel,
        pendingQuestion: active.pendingQuestion,
      }) ??
      undefined;
    return {
      label: `Working on post ${index} of ${total}`,
      detail,
      tone: active.status === "NEEDS_INFO" ? "waiting" : "working",
    };
  }

  if (notStarted > 0) {
    return {
      label: "Preparing next post…",
      detail: `${notStarted} post${notStarted === 1 ? "" : "s"} queued`,
      tone: "working",
    };
  }

  const failedTasks = sorted.filter((t) => t.status === "FAILED");
  if (failedTasks.length > 0) {
    const done = sorted.filter((t) => t.status === "NEEDS_APPROVAL" || t.status === "APPROVED")
      .length;
    const titles = failedTasks.map((t) => t.title).join(", ");
    return {
      label:
        failedTasks.length === 1
          ? `Post ${failedTasks[0].orderIndex + 1} failed — retry on the board`
          : `${failedTasks.length} posts failed — retry on the board`,
      detail: done > 0 ? `${done} ready · ${titles}` : titles,
      tone: "waiting",
    };
  }

  return null;
}

const SPINNER_STYLES: Record<ChatStatusTone, string> = {
  planning: "border-indigo-400/30 border-t-indigo-600",
  working: "border-blue-500/30 border-t-blue-600",
  waiting: "border-amber-500/30 border-t-amber-600",
  idle: "border-slate-400/30 border-t-slate-600",
};

/** Inline agent-style activity row — sits below messages like a reply in progress. */
export function ChatAgentActivityRow({
  label,
  detail,
  tone = "planning",
  spinning = true,
}: {
  label: string;
  detail?: string;
  tone?: ChatStatusTone;
  spinning?: boolean;
}) {
  return (
    <div className="flex gap-3 animate-blfade" role="status" aria-live="polite">
      <div className="w-[30px] h-[30px] rounded-[10px] flex-none flex items-center justify-center text-[13px] font-bold text-white bg-gradient-to-br from-blue-500 to-indigo-500">
        ✦
      </div>
      <div className="max-w-[74%] px-4 py-3 rounded-2xl text-sm bg-white/85 border border-white/90">
        <div className="flex items-center gap-2.5 text-slate-600">
          {spinning ? (
            <span
              className={`inline-block w-4 h-4 flex-none rounded-full border-2 border-t-transparent animate-spin ${SPINNER_STYLES[tone]}`}
              aria-hidden
            />
          ) : (
            <span className="inline-block w-2 h-2 flex-none rounded-full bg-amber-500" aria-hidden />
          )}
          <span className="font-medium text-slate-700">{label}</span>
        </div>
        {detail ? (
          <div className="text-[11.5px] text-slate-500 mt-1.5 leading-snug">{detail}</div>
        ) : null}
      </div>
    </div>
  );
}
