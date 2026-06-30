import { prisma } from "@/lib/db/prisma";
import { publishProjectEvent } from "@/lib/events/publish";
import { collectConversationTaskIds } from "@/lib/conversations/conversationTasks";

export { collectConversationTaskIds };

async function reindexProjectTasks(projectId: string): Promise<void> {
  const remaining = await prisma.task.findMany({
    where: { projectId },
    orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }],
    select: { id: true, orderIndex: true },
  });

  for (let i = 0; i < remaining.length; i++) {
    const task = remaining[i]!;
    if (task.orderIndex !== i) {
      await prisma.task.update({
        where: { id: task.id },
        data: { orderIndex: i },
      });
    }
  }
}

async function emitTasksDeleted(projectId: string, taskIds: string[]): Promise<void> {
  if (!taskIds.length) return;
  try {
    await publishProjectEvent({
      type: "task.deleted",
      projectId,
      payload: { taskIds },
    });
  } catch (err) {
    console.warn("emitTasksDeleted failed:", err);
  }
}

export type DeleteConversationResult = {
  projectId: string;
  deletedId: string;
  deletedTaskIds: string[];
};

export async function deleteConversationWithTasks(
  conversationId: string
): Promise<DeleteConversationResult | null> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, projectId: true },
  });
  if (!conversation) return null;

  const taskIds = await collectConversationTaskIds(conversationId);

  if (taskIds.length > 0) {
    await prisma.job.deleteMany({ where: { taskId: { in: taskIds } } });
    await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
    await reindexProjectTasks(conversation.projectId);
    await emitTasksDeleted(conversation.projectId, taskIds);
  }

  await prisma.conversation.delete({ where: { id: conversationId } });

  return {
    projectId: conversation.projectId,
    deletedId: conversationId,
    deletedTaskIds: taskIds,
  };
}
