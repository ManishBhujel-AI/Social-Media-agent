import { enqueueJob, type JobType } from "./bullmq";
import { isProjectPipelinePaused } from "./pipelinePauseFlag";
import { prisma } from "@/lib/db/prisma";

/** Prevent duplicate inline jobs on the same task (race on image submit + kick-pipeline). */
const inlineRunningTaskIds = new Set<string>();

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
      .catch((err) => {
        console.error(`[pipeline:inline] ${params.type} failed:`, err);
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
