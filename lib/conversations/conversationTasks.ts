import { prisma } from "@/lib/db/prisma";
import { isPipelineActiveStatus } from "@/lib/tasks/pipelineActive";
import type { Prisma } from "@prisma/client";

function taskIdsFromMessage(role: string, content: string, meta: unknown): string[] {
  const ids: string[] = [];
  if (meta && typeof meta === "object") {
    const m = meta as { taskId?: string; name?: string };
    if (m.taskId) ids.push(m.taskId);
    if (role === "tool" && m.name === "createTasks") {
      try {
        const parsed = JSON.parse(content) as { taskIds?: string[] };
        if (Array.isArray(parsed.taskIds)) {
          ids.push(...parsed.taskIds.filter((id) => typeof id === "string"));
        }
      } catch {
        /* ignore malformed tool payload */
      }
    }
  }
  return ids;
}

/** Tasks tied to a chat — by FK or legacy message references. */
export async function collectConversationTaskIds(conversationId: string): Promise<string[]> {
  const ids = new Set<string>();

  const linked = await prisma.task.findMany({
    where: { conversationId },
    select: { id: true },
  });
  for (const t of linked) ids.add(t.id);

  // Legacy chats may reference tasks only in message meta — scan messages only when needed.
  if (ids.size === 0) {
    const messages = await prisma.message.findMany({
      where: { conversationId },
      select: { role: true, content: true, meta: true },
    });
    for (const m of messages) {
      for (const id of taskIdsFromMessage(m.role, m.content, m.meta)) {
        ids.add(id);
      }
    }
  }

  return Array.from(ids);
}

export async function resolveProjectConversation(
  projectId: string,
  conversationParam?: string | null
): Promise<string | null> {
  if (conversationParam) {
    const match = await prisma.conversation.findFirst({
      where: { id: conversationParam, projectId },
      select: { id: true },
    });
    if (match) return match.id;
  }

  const latest = await prisma.conversation.findFirst({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return latest?.id ?? null;
}

type TaskInclude = Prisma.TaskInclude;

export async function listTasksForConversation<T extends TaskInclude | undefined>(
  projectId: string,
  conversationId: string | null,
  options?: {
    where?: Prisma.TaskWhereInput;
    include?: T;
  }
) {
  if (!conversationId) return [];

  const fkTasks = await prisma.task.findMany({
    where: {
      projectId,
      conversationId,
      ...options?.where,
    },
    orderBy: { orderIndex: "asc" },
    include: options?.include,
  });

  if (fkTasks.length > 0) return fkTasks;

  const ids = await collectConversationTaskIds(conversationId);
  if (!ids.length) return [];

  return prisma.task.findMany({
    where: {
      projectId,
      id: { in: ids },
      ...options?.where,
    },
    orderBy: { orderIndex: "asc" },
    include: options?.include,
  });
}

export async function countTasksForConversation(
  projectId: string,
  conversationId: string | null
): Promise<{ taskCount: number; needsCount: number; pipelineActive: boolean }> {
  if (!conversationId) {
    return { taskCount: 0, needsCount: 0, pipelineActive: false };
  }

  const tasks = await prisma.task.findMany({
    where: { projectId, conversationId },
    select: { status: true },
  });

  if (!tasks.length) {
    const ids = await collectConversationTaskIds(conversationId);
    if (!ids.length) {
      return { taskCount: 0, needsCount: 0, pipelineActive: false };
    }

    const legacyTasks = await prisma.task.findMany({
      where: { projectId, id: { in: ids } },
      select: { status: true },
    });

    return {
      taskCount: legacyTasks.length,
      needsCount: legacyTasks.filter((t) => t.status === "NEEDS_APPROVAL").length,
      pipelineActive: legacyTasks.some((t) => isPipelineActiveStatus(t.status)),
    };
  }

  return {
    taskCount: tasks.length,
    needsCount: tasks.filter((t) => t.status === "NEEDS_APPROVAL").length,
    pipelineActive: tasks.some((t) => isPipelineActiveStatus(t.status)),
  };
}

export { conversationQuery } from "./conversationQuery";
