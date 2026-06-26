import { prisma } from "@/lib/db/prisma";
import type { Task, TaskStatus } from "@prisma/client";
import { publishProjectEvent } from "@/lib/events/publish";
import { withTransientRetry } from "@/lib/db/transientRetry";
import { taskToStreamPayload, type TaskStreamPayload } from "./taskStream";

export type TaskEventPayload = TaskStreamPayload;

export function taskToEventPayload(task: Task): TaskEventPayload {
  return taskToStreamPayload(task);
}

export async function emitTaskCreated(task: Task): Promise<void> {
  try {
    await publishProjectEvent({
      type: "task.created",
      projectId: task.projectId,
      payload: taskToStreamPayload(task),
    });
  } catch (err) {
    console.warn("emitTaskCreated failed after retries:", err);
  }
}

export async function emitTaskUpdated(task: Task): Promise<void> {
  try {
    await publishProjectEvent({
      type: "task.updated",
      projectId: task.projectId,
      payload: taskToEventPayload(task),
    });
  } catch (err) {
    console.warn("emitTaskUpdated failed after retries:", err);
  }
}

/** Fired when caption/graphic land after feedback — triggers Approvals live refresh. */
export async function emitTaskDeliverableUpdated(taskId: string): Promise<void> {
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        generations: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!task) return;

    const latestGen = task.generations[task.generations.length - 1];

    await publishProjectEvent({
      type: "task.deliverable.updated",
      projectId: task.projectId,
      payload: {
        taskId: task.id,
        status: task.status,
        caption: task.caption,
        generationCount: task.generations.length,
        latestImagePath: latestGen?.imagePath ?? null,
        latestGenerationId: latestGen?.generationId ?? null,
        latestAgentNote: latestGen?.agentNote ?? null,
      },
    });
  } catch (err) {
    console.warn("emitTaskDeliverableUpdated failed after retries:", err);
  }
}

type TaskUpdateData = {
  status?: TaskStatus;
  statusLabel?: string | null;
  pendingQuestion?: string | null;
  agentState?: object | null;
};

export async function updateTaskFields(
  taskId: string,
  data: TaskUpdateData
): Promise<Task> {
  const task = await withTransientRetry(
    () =>
      prisma.task.update({
        where: { id: taskId },
        data: data as never,
      }),
    { label: "updateTaskFields" }
  );
  await emitTaskUpdated(task);
  return task;
}

export async function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
  extras?: Pick<TaskUpdateData, "statusLabel" | "pendingQuestion">
): Promise<Task> {
  return updateTaskFields(taskId, { status, ...extras });
}

export async function updateTaskLabel(
  taskId: string,
  statusLabel: string | null
): Promise<Task> {
  return updateTaskFields(taskId, { statusLabel });
}
