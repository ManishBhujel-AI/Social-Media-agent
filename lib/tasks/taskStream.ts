import type { Task, TaskStatus } from "@prisma/client";

export type TaskWithMeta = Task & {
  generations?: { imagePath: string | null }[];
};

export type TaskStreamPayload = {
  taskId: string;
  status: TaskStatus;
  statusLabel?: string | null;
  pendingQuestion?: string | null;
  title?: string;
  orderIndex?: number;
  subject?: string;
  /** Synced from agentState — lets the chat show the photo card without full agentState. */
  preImageRequest?: boolean;
};

export function taskToStreamPayload(task: Task): TaskStreamPayload {
  const state = task.agentState as { preImageRequest?: boolean } | null;
  return {
    taskId: task.id,
    status: task.status,
    statusLabel: task.statusLabel,
    pendingQuestion: task.pendingQuestion,
    title: task.title,
    orderIndex: task.orderIndex,
    subject: task.subject,
    preImageRequest: Boolean(state?.preImageRequest),
  };
}

export function mergeTaskStreamEvent(
  tasks: TaskWithMeta[],
  type: "task.created" | "task.updated",
  payload: TaskStreamPayload
): TaskWithMeta[] {
  const idx = tasks.findIndex((t) => t.id === payload.taskId);

  if (idx >= 0) {
    const priorState = (tasks[idx].agentState as { preImageRequest?: boolean } | null) ?? {};
    const agentState =
      payload.preImageRequest !== undefined
        ? { ...priorState, preImageRequest: payload.preImageRequest }
        : tasks[idx].agentState;
    const updated = {
      ...tasks[idx],
      status: payload.status,
      statusLabel: payload.statusLabel ?? tasks[idx].statusLabel,
      pendingQuestion:
        payload.pendingQuestion !== undefined
          ? payload.pendingQuestion
          : tasks[idx].pendingQuestion,
      title: payload.title ?? tasks[idx].title,
      orderIndex: payload.orderIndex ?? tasks[idx].orderIndex,
      subject: payload.subject ?? tasks[idx].subject,
      agentState,
    };
    return tasks.map((t, i) => (i === idx ? updated : t));
  }

  if (type !== "task.created") return tasks;

  const stub: TaskWithMeta = {
    id: payload.taskId,
    projectId: "",
    title: payload.title ?? "New post",
    subject: payload.subject ?? payload.title ?? "Post",
    status: payload.status,
    statusLabel: payload.statusLabel ?? null,
    pendingQuestion: payload.pendingQuestion ?? null,
    orderIndex: payload.orderIndex ?? tasks.length,
    productInfo: null,
    businessInfo: null,
    businessSummary: null,
    logoUrl: null,
    productSummary: null,
    productImageUrl: null,
    sourceImages: null,
    caption: null,
    imagePrompt: null,
    graphicCopy: null,
    threadId: null,
    agentState: null,
    currentGenerationId: null,
    userProductNotes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    generations: [],
  };

  return [...tasks, stub].sort((a, b) => a.orderIndex - b.orderIndex);
}

export function getActiveBoardTask(tasks: Task[]): Task | undefined {
  const sorted = [...tasks].sort((a, b) => a.orderIndex - b.orderIndex);
  const inProgress = sorted.find((t) =>
    ["AGENT_RUNNING", "WRITING_CAPTION", "WRITING_PROMPT", "GENERATING_IMAGE"].includes(t.status)
  );
  if (inProgress) return inProgress;
  const needsInfo = sorted.find((t) => t.status === "NEEDS_INFO");
  if (needsInfo) return needsInfo;
  return sorted.find((t) => t.status === "NOT_STARTED");
}
