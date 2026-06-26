import type { Task, TaskStatus } from "@prisma/client";
import { isAgentQuestionPause, isPreImageRequestState, isUserPausedTask, taskHasAssignedImage } from "@/lib/tasks/taskPauseState";

const IN_PROGRESS_STATUSES: TaskStatus[] = [
  "AGENT_RUNNING",
  "WRITING_CAPTION",
  "WRITING_PROMPT",
  "GENERATING_IMAGE",
];

/** Block the next image card only while a post is waiting on photo upload — not agent clarifications. */
export function isImageCollectionBlocked(
  tasks: Pick<Task, "status" | "agentState" | "pendingQuestion" | "statusLabel">[]
): boolean {
  return tasks.some((t) => t.status === "NEEDS_INFO" && isPhotoCollectionPause(t));
}

/** @deprecated Use isImageCollectionBlocked */
export function isPipelineBlocked(tasks: Pick<Task, "status" | "agentState" | "pendingQuestion" | "statusLabel">[]): boolean {
  return isImageCollectionBlocked(tasks);
}

export function countInProgressTasks(tasks: Task[]): number {
  return tasks.filter((t) => IN_PROGRESS_STATUSES.includes(t.status)).length;
}

/** In-progress tasks that are still actively running (not user-paused). */
export function countActiveInProgressTasks(tasks: Task[]): number {
  return tasks.filter(
    (t) => IN_PROGRESS_STATUSES.includes(t.status) && !isUserPausedTask(t)
  ).length;
}

/** Lowest-order post waiting on the user — only one image card active at a time. */
export function getActivePendingTask(tasks: Task[]): Task | undefined {
  return [...tasks]
    .filter((t) => t.status === "NEEDS_INFO")
    .sort((a, b) => a.orderIndex - b.orderIndex)[0];
}

export function isPhotoCollectionPause(
  task: Pick<Task, "status" | "statusLabel" | "pendingQuestion" | "agentState">
): boolean {
  if (task.status !== "NEEDS_INFO") return false;
  if (isPreImageRequestState(task.agentState)) return true;
  const q = task.pendingQuestion ?? "";
  if (q.includes("Upload a photo") || q.includes("Upload one or more photos")) return true;
  const label = task.statusLabel ?? "";
  return /waiting for photo/i.test(label);
}

export function getActiveImageRequestTaskId(tasks: Task[]): string | null {
  const photoPause = [...tasks]
    .filter((t) => t.status === "NEEDS_INFO" && isPhotoCollectionPause(t))
    .sort((a, b) => a.orderIndex - b.orderIndex)[0];
  return photoPause?.id ?? null;
}

export function allImagesCollected(tasks: Task[]): boolean {
  if (!tasks.length) return false;
  return !tasks.some((t) => t.status === "NOT_STARTED" || t.status === "NEEDS_INFO");
}

export function pendingTaskReplyHint(
  task: Pick<
    Task,
    "status" | "agentState" | "pendingQuestion" | "statusLabel" | "sourceImages" | "productImageUrl"
  >
): string {
  if (isPhotoCollectionPause(task)) {
    return "Use the photo card above, or type generate to design from scratch.";
  }
  if (isAgentQuestionPause(task) && taskHasAssignedImage(task)) {
    return "Photos are saved. Reply with a short product description, or type generate…";
  }
  return 'Reply here, upload a photo, or type "generate" to design from scratch.';
}

/** Show agent question card when the message targets the active pending post. */
export function shouldShowAgentQuestionCard(
  linkedTask: Pick<Task, "id" | "status" | "pendingQuestion" | "agentState"> | undefined,
  pendingTask: Pick<Task, "id"> | undefined
): boolean {
  if (!linkedTask) return false;
  if (pendingTask?.id === linkedTask.id) return true;
  return linkedTask.status === "NEEDS_INFO" && isAgentQuestionPause(linkedTask);
}
