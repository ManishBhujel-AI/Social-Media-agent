import { prisma } from "@/lib/db/prisma";
import type { Task } from "@prisma/client";
import { emitMessageCreated } from "@/lib/chat/messageEvents";
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

/** Pause before the post agent loop — primary path when no image is assigned yet. */
export async function pauseForImageRequest(
  task: Task,
  productName: string
): Promise<{ done: false; paused: true }> {
  const question = IMAGE_REQUEST_QUESTION(productName);
  const conversationId = await getProjectConversationId(task.projectId);

  if (!(await hasImageRequestMessage(conversationId, task.id))) {
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
