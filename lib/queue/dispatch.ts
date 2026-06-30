import { enqueueJob, type JobType } from "./bullmq";
import { isProjectPipelinePaused } from "./pipelinePauseFlag";
import { prisma } from "@/lib/db/prisma";
import { isRetryable } from "@/lib/ai/errors";
import { isTransientConnectionError } from "@/lib/db/transientRetry";
import { updateTaskStatus } from "@/lib/tasks/taskEvents";
import { formatTaskFailureLabel } from "@/lib/tasks/failureLabel";
import type { TaskStatus } from "@prisma/client";

/** Prevent duplicate inline jobs on the same task (race on image submit + kick-pipeline). */
const inlineRunningTaskIds = new Set<string>();

const IN_PROGRESS: TaskStatus[] = [
  "AGENT_RUNNING",
  "WRITING_CAPTION",
  "WRITING_PROMPT",
  "GENERATING_IMAGE",
];

async function markInlinePipelineFailure(taskId: string, err: unknown) {
  if (isRetryable(err) || isTransientConnectionError(err)) return;
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { status: true },
  });
  if (!task || !IN_PROGRESS.includes(task.status)) return;
  const msg = err instanceof Error ? err.message : String(err);
  await updateTaskStatus(taskId, "FAILED", {
    statusLabel: formatTaskFailureLabel(msg),
  });
}

export type DispatchResult = { ok: true } | { ok: false; reason: "paused" | "already_running" };

export function isTaskPipelineJobActive(taskId: string): boolean {
  return inlineRunningTaskIds.has(taskId);
}

/** Queued or running post-agent job for this task (worker / BullMQ mode). */
export async function hasActivePipelineJob(taskId: string): Promise<boolean> {
  if (inlineRunningTaskIds.has(taskId)) return true;
  if (shouldUseInlinePipeline()) return false;

  const active = await prisma.job.findFirst({
    where: {
      taskId,
      type: { in: ["RUN_TASK_AGENT", "RESUME_TASK_AGENT"] },
      status: { in: ["queued", "running"] },
    },
    select: { id: true },
  });
  if (active) return true;

  const recent = await prisma.job.findFirst({
    where: {
      taskId,
      type: { in: ["RUN_TASK_AGENT", "RESUME_TASK_AGENT"] },
      createdAt: { gt: new Date(Date.now() - 30_000) },
      status: { not: "done" },
    },
    select: { id: true },
  });
  return Boolean(recent);
}

/** Run post-agent jobs in-process (dev / no worker). Queue when PIPELINE_WORKER=1 or production. */
export function shouldUseInlinePipeline(): boolean {
  if (!process.env.REDIS_URL) return true;
  if (process.env.PIPELINE_MODE === "inline") return true;
  if (process.env.PIPELINE_MODE === "queue") return false;
  if (process.env.NODE_ENV === "development") {
    return process.env.PIPELINE_WORKER !== "1";
  }
  return false;
}

export async function dispatchPipelineJob(params: {
  type: Extract<JobType, "RUN_TASK_AGENT" | "RESUME_TASK_AGENT">;
  taskId?: string;
  projectId?: string;
  payload: Record<string, unknown>;
}): Promise<DispatchResult> {
  if (params.projectId && (await isProjectPipelinePaused(params.projectId))) {
    return { ok: false, reason: "paused" };
  }

  if (params.taskId && inlineRunningTaskIds.has(params.taskId)) {
    return { ok: false, reason: "already_running" };
  }

  if (params.taskId && !shouldUseInlinePipeline()) {
    const active = await prisma.job.findFirst({
      where: {
        taskId: params.taskId,
        type: { in: ["RUN_TASK_AGENT", "RESUME_TASK_AGENT"] },
        status: { in: ["queued", "running"] },
      },
      select: { id: true },
    });
    if (active) {
      return { ok: false, reason: "already_running" };
    }
  }

  if (shouldUseInlinePipeline()) {
    const { processJob } = await import("./handlers");
    if (params.taskId) inlineRunningTaskIds.add(params.taskId);
    void processJob(params.type, params.payload)
      .catch(async (err) => {
        console.error(`[pipeline:inline] ${params.type} failed:`, err);
        if (params.taskId) {
          await markInlinePipelineFailure(params.taskId, err);
        }
      })
      .finally(() => {
        if (params.taskId) inlineRunningTaskIds.delete(params.taskId);
      });
    return { ok: true };
  }

  await enqueueJob({
    type: params.type,
    taskId: params.taskId,
    projectId: params.projectId,
    payload: params.payload,
  });
  return { ok: true };
}

export async function dispatchFeedbackJob(params: {
  projectId: string;
  taskId: string;
  payload: Record<string, unknown>;
}): Promise<string | null> {
  if (shouldUseInlinePipeline()) {
    const { processJob } = await import("./handlers");
    void processJob("APPLY_FEEDBACK", params.payload).catch((err) => {
      console.error("[pipeline:inline] APPLY_FEEDBACK failed:", err);
    });
    return null;
  }

  return enqueueJob({
    type: "APPLY_FEEDBACK",
    projectId: params.projectId,
    taskId: params.taskId,
    payload: params.payload,
  });
}
