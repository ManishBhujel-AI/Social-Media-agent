import { prisma } from "@/lib/db/prisma";
import type { Task } from "@prisma/client";
import { emitMessageCreated } from "@/lib/chat/messageEvents";
import { isPhotoCollectionPause } from "@/lib/tasks/pendingTask";
import { updateTaskFields } from "@/lib/tasks/taskEvents";

export const IMAGE_REQUEST_QUESTION = (productName: string) =>
  `Upload one or more photos for ${productName}, or submit without any and I'll design from scratch.`;

export { taskHasAssignedImage } from "@/lib/tasks/taskPauseState";

async function getProjectConversationId(projectId: string): Promise<string> {
  const conv = await prisma.conversation.findFirst({
    where: { projectId },
    orderBy: { createdAt: "desc" },
  });
  if (!conv) {
    const created = await prisma.conversation.create({ data: { projectId } });
    return created.id;
  }
  return conv.id;
}

async function hasImageRequestMessage(conversationId: string, taskId: string): Promise<boolean> {
  const recent = await prisma.message.findMany({
    where: { conversationId, role: "assistant" },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { meta: true },
  });
  return recent.some((m) => {
    if (!m.meta || typeof m.meta !== "object") return false;
    const meta = m.meta as { type?: string; taskId?: string };
    return meta.type === "image_request" && meta.taskId === taskId;
  });
}

function normalizeProductName(name: string): string {
  return name.trim().toLowerCase();
}

async function hasActiveImageRequestForProduct(
  conversationId: string,
  productName: string,
  excludeTaskId: string
): Promise<boolean> {
  const recent = await prisma.message.findMany({
    where: { conversationId, role: "assistant" },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { meta: true },
  });
  const key = normalizeProductName(productName);
  for (const m of recent) {
    if (!m.meta || typeof m.meta !== "object") continue;
    const meta = m.meta as { type?: string; productName?: string; taskId?: string };
    if (meta.type !== "image_request") continue;
    if (normalizeProductName(meta.productName ?? "") !== key) continue;
    if (meta.taskId === excludeTaskId) continue;
    if (!meta.taskId) return true;
    const linked = await prisma.task.findUnique({
      where: { id: meta.taskId },
      select: { status: true, agentState: true, pendingQuestion: true, statusLabel: true },
    });
    if (linked && linked.status === "NEEDS_INFO" && isPhotoCollectionPause(linked)) {
      return true;
    }
  }
  return false;
}

/** Pause before the post agent loop — primary path when no image is assigned yet. */
export async function pauseForImageRequest(
  task: Task,
  productName: string
): Promise<{ done: false; paused: true }> {
  const question = IMAGE_REQUEST_QUESTION(productName);
  const conversationId =
    task.conversationId ?? (await getProjectConversationId(task.projectId));

  if (!(await hasImageRequestMessage(conversationId, task.id))) {
    if (await hasActiveImageRequestForProduct(conversationId, productName, task.id)) {
      await updateTaskFields(task.id, {
        status: "FAILED",
        statusLabel: "Duplicate post",
        pendingQuestion: null,
        agentState: null,
      });
      return { done: false, paused: true };
    }

    const agentMessage = await prisma.message.create({
      data: {
        conversationId,
        role: "assistant",
        content: question,
        meta: {
          type: "image_request",
          taskId: task.id,
          postTitle: task.title,
          productName,
          orderIndex: task.orderIndex,
        },
      },
    });
    await emitMessageCreated(task.projectId, agentMessage);
  }

  await updateTaskFields(task.id, {
    status: "NEEDS_INFO",
    statusLabel: "Waiting for photo…",
    pendingQuestion: question,
    agentState: {
      messages: [],
      stepCount: 0,
      preImageRequest: true,
    },
  });

  return { done: false, paused: true };
}

export { isPreImageRequestState } from "@/lib/tasks/taskPauseState";
