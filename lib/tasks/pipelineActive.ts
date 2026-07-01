import type { TaskStatus } from "@prisma/client";

export const TERMINAL_TASK_STATUSES: TaskStatus[] = ["NEEDS_APPROVAL", "APPROVED", "FAILED"];

export function isPipelineActiveStatus(status: TaskStatus): boolean {
  return !TERMINAL_TASK_STATUSES.includes(status);
}

export function isPipelineActiveStatuses(statuses: Iterable<TaskStatus>): boolean {
  for (const status of statuses) {
    if (isPipelineActiveStatus(status)) return true;
  }
  return false;
}
