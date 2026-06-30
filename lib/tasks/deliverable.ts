import { prisma } from "@/lib/db/prisma";
import type { TaskStatus } from "@prisma/client";
import { updateTaskFields } from "./taskEvents";

const IN_PROGRESS: TaskStatus[] = [
  "AGENT_RUNNING",
  "WRITING_CAPTION",
  "WRITING_PROMPT",
  "GENERATING_IMAGE",
];

export function isInProgressStatus(status: TaskStatus): boolean {
  return IN_PROGRESS.includes(status);
}

export async function taskDeliverableReady(taskId: string): Promise<boolean> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { generations: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!task?.caption?.trim()) return false;
  return Boolean(task.generations[0]?.imagePath);
}

export async function getTaskDeliverableStatus(
  taskId: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { generations: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!task) return { ok: false, reason: "Task not found" };
  if (!task.caption?.trim()) {
    return { ok: false, reason: "Agent finished without a caption — call writeCaption or askUser" };
  }
  if (!task.generations[0]?.imagePath) {
    return { ok: false, reason: "Agent finished without a graphic — call makeGraphic or askUser" };
  }
  return { ok: true };
}

/** Caption + graphic exist but status never advanced (e.g. API rate limit mid-finalize). */
export async function promoteTaskIfDeliverableReady(taskId: string): Promise<boolean> {
  if (!(await taskDeliverableReady(taskId))) return false;

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { status: true },
  });
  if (!task) return false;
  if (task.status === "NEEDS_APPROVAL" || task.status === "APPROVED") return true;
  if (task.status !== "FAILED" && !isInProgressStatus(task.status)) return false;

  await updateTaskFields(taskId, {
    status: "NEEDS_APPROVAL",
    statusLabel: null,
    pendingQuestion: null,
  });
  return true;
}

/** Heal in-progress posts that already have a full deliverable. */
export async function healDeliverableStuckTasks(projectId: string): Promise<number> {
  const candidates = await prisma.task.findMany({
    where: { projectId, status: { in: [...IN_PROGRESS, "FAILED"] } },
    select: { id: true },
    orderBy: { orderIndex: "asc" },
  });

  let healed = 0;
  for (const t of candidates) {
    if (await promoteTaskIfDeliverableReady(t.id)) healed += 1;
  }
  return healed;
}
