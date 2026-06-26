import { prisma } from "@/lib/db/prisma";
import { dispatchPipelineJob, hasActivePipelineJob, isTaskPipelineJobActive, shouldUseInlinePipeline } from "./dispatch";
import { isImageCollectionBlocked } from "@/lib/tasks/pendingTask";
import { isUserPausedTask } from "@/lib/tasks/taskPauseState";
import { taskHasAssignedImage } from "@/lib/ai/agents/postImageRequest";
import type { TaskStatus } from "@prisma/client";

const IN_PROGRESS: TaskStatus[] = [
  "AGENT_RUNNING",
  "WRITING_CAPTION",
  "WRITING_PROMPT",
  "GENERATING_IMAGE",
];

/** Skip kick-pipeline recovery while a post agent is likely still running. */
const STALE_IN_PROGRESS_MS = 90_000;

/** Throttle automatic kick-pipeline recovery (Board/Chat mount, task refresh loops). */
const ADVANCE_COOLDOWN_MS = 20_000;
const RECENT_JOB_COOLDOWN_MS = 120_000;

const lastAdvanceAtByProject = new Map<string, number>();

async function hasRecentPipelineJob(taskId: string): Promise<boolean> {
  const since = new Date(Date.now() - RECENT_JOB_COOLDOWN_MS);
  const [active, failed] = await Promise.all([
    prisma.job.findFirst({
      where: {
        taskId,
        type: { in: ["RUN_TASK_AGENT", "RESUME_TASK_AGENT"] },
        createdAt: { gt: since },
        status: { in: ["queued", "running"] },
      },
      select: { id: true },
    }),
    prisma.job.findFirst({
      where: {
        taskId,
        type: { in: ["RUN_TASK_AGENT", "RESUME_TASK_AGENT"] },
        status: "failed",
        createdAt: { gt: since },
      },
      select: { id: true },
    }),
  ]);
  return Boolean(active || failed);
}

function isTaskInProgress(status: TaskStatus): boolean {
  return IN_PROGRESS.includes(status);
}

export async function isProjectPipelineBlocked(projectId: string): Promise<boolean> {
  const tasks = await prisma.task.findMany({
    where: { projectId },
    select: { status: true, agentState: true, pendingQuestion: true, statusLabel: true },
  });
  return isImageCollectionBlocked(tasks);
}

export async function getNextNotStartedTaskIds(projectId: string): Promise<string[]> {
  const notStarted = await prisma.task.findMany({
    where: { projectId, status: "NOT_STARTED" },
    orderBy: { orderIndex: "asc" },
    select: { id: true },
  });
  return notStarted.map((t) => t.id);
}

export async function filterNotStartedTaskIds(taskIds: string[]): Promise<string[]> {
  if (!taskIds.length) return [];
  const tasks = await prisma.task.findMany({
    where: { id: { in: taskIds } },
    select: { id: true, status: true },
  });
  return tasks.filter((t) => t.status === "NOT_STARTED").map((t) => t.id);
}

/** Show the next post's image card (one at a time). */
export async function promptNextImageCollectionTask(projectId: string): Promise<boolean> {
  if (await isProjectPipelineBlocked(projectId)) {
    return false;
  }

  const next = await prisma.task.findFirst({
    where: { projectId, status: "NOT_STARTED" },
    orderBy: { orderIndex: "asc" },
  });
  if (!next) return false;

  const payload = { taskId: next.id, remainingTaskIds: [] as string[] };

  if (shouldUseInlinePipeline()) {
    const { processJob } = await import("./handlers");
    await processJob("RUN_TASK_AGENT", payload);
  } else {
    await dispatchPipelineJob({
      type: "RUN_TASK_AGENT",
      taskId: next.id,
      projectId,
      payload,
    });
  }

  return true;
}

/** Recover posts that were submitted but reset to NOT_STARTED by a race bug. */
export async function resumeSubmittedStalledTasks(projectId: string): Promise<number> {
  const candidates = await prisma.task.findMany({
    where: { projectId, status: "NOT_STARTED" },
    orderBy: { orderIndex: "asc" },
  });

  let resumed = 0;
  for (const task of candidates) {
    if (!taskHasAssignedImage(task)) continue;
    if (await hasActivePipelineJob(task.id)) continue;
    if (await hasRecentPipelineJob(task.id)) continue;

    const dispatch = await dispatchPipelineJob({
      type: "RUN_TASK_AGENT",
      taskId: task.id,
      projectId,
      payload: { taskId: task.id, remainingTaskIds: [], skipImageRequest: true },
    });
    if (dispatch.ok) resumed += 1;
  }
  return resumed;
}

function hasResumableAgentCheckpoint(agentState: unknown): boolean {
  if (!agentState || typeof agentState !== "object") return false;
  const state = agentState as { messages?: unknown[]; pendingToolCallId?: string };
  if (state.pendingToolCallId) return true;
  return Array.isArray(state.messages) && state.messages.length > 0;
}

/** Recover in-progress posts whose worker never started (e.g. Stop was pressed, then user answered a card). */
export async function resumeStalledInProgressTasks(projectId: string): Promise<number> {
  const candidates = await prisma.task.findMany({
    where: { projectId, status: { in: IN_PROGRESS } },
    orderBy: { orderIndex: "asc" },
  });

  const now = Date.now();
  let resumed = 0;
  for (const task of candidates) {
    if (isTaskPipelineJobActive(task.id)) continue;
    if (await hasActivePipelineJob(task.id)) continue;
    if (await hasRecentPipelineJob(task.id)) continue;

    const state = task.agentState as { pendingToolCallId?: string } | null;
    if (state?.pendingToolCallId) continue;

    const userPaused = isUserPausedTask(task);
    const ageMs = now - task.updatedAt.getTime();
    const hasCheckpoint = hasResumableAgentCheckpoint(task.agentState);

    // Fresh runs are still executing — resumeCheckpoint with empty state would restart and duplicate askUser.
    if (!userPaused && ageMs < STALE_IN_PROGRESS_MS) continue;
    if (!userPaused && !hasCheckpoint && ageMs < STALE_IN_PROGRESS_MS * 3) continue;

    const dispatch = await dispatchPipelineJob({
      type: "RESUME_TASK_AGENT",
      taskId: task.id,
      projectId,
      payload: { taskId: task.id, userReply: "", resumeCheckpoint: true },
    });
    if (dispatch.ok) resumed += 1;
  }
  return resumed;
}

/** Recover a stalled pipeline at the very start (no cards shown yet). */
export async function bootstrapImageCollectionIfStalled(projectId: string): Promise<boolean> {
  await advanceImageCollectionQueue(projectId);
  return true;
}

/** Resume submitted posts and show the next photo card when the queue is not blocked. */
export async function advanceImageCollectionQueue(
  projectId: string,
  opts?: { force?: boolean }
): Promise<boolean> {
  const now = Date.now();
  const lastAdvance = lastAdvanceAtByProject.get(projectId) ?? 0;
  if (!opts?.force && now - lastAdvance < ADVANCE_COOLDOWN_MS) {
    return false;
  }
  lastAdvanceAtByProject.set(projectId, now);

  await resumeSubmittedStalledTasks(projectId);
  await resumeStalledInProgressTasks(projectId);

  if (await isProjectPipelineBlocked(projectId)) {
    return false;
  }

  return promptNextImageCollectionTask(projectId);
}
