import { publishProjectEvent } from "@/lib/events/publish";

export const PROJECT_CHANNEL = (projectId: string) => `project:${projectId}`;

export type ProjectEvent = {
  type:
    | "task.created"
    | "task.updated"
    | "task.deleted"
    | "task.deliverable.updated"
    | "job.failed"
    | "project.updated"
    | "message.created"
    | "agent.activity";
  projectId: string;
  payload: Record<string, unknown>;
};

/** @deprecated Use ProjectEvent */
export type TaskEvent = ProjectEvent;

export async function emitProjectEvent(event: ProjectEvent) {
  try {
    await publishProjectEvent(event);
  } catch (err) {
    console.warn("emitProjectEvent failed (Redis may be unavailable):", err);
  }
}
