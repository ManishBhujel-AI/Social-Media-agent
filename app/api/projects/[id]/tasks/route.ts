import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  collectConversationTaskIds,
  resolveProjectConversation,
} from "@/lib/conversations/conversationTasks";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const conversationParam = req.nextUrl.searchParams.get("conversation");
  const conversationId = await resolveProjectConversation(id, conversationParam);

  let tasks;
  if (conversationParam && conversationId) {
    tasks = await prisma.task.findMany({
      where: { projectId: id, conversationId },
      orderBy: { orderIndex: "asc" },
      include: {
        generations: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });

    if (!tasks.length) {
      const ids = await collectConversationTaskIds(conversationId);
      tasks =
        ids.length > 0
          ? await prisma.task.findMany({
              where: { projectId: id, id: { in: ids } },
              orderBy: { orderIndex: "asc" },
              include: {
                generations: { orderBy: { createdAt: "desc" }, take: 1 },
              },
            })
          : [];
    }
  } else {
    tasks = await prisma.task.findMany({
      where: { projectId: id },
      orderBy: { orderIndex: "asc" },
      include: {
        generations: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
  }

  const etag = tasks.map((t) => `${t.id}:${t.updatedAt.getTime()}:${t.status}`).join("|");
  return NextResponse.json(tasks, {
    headers: { ETag: `"${etag}"` },
  });
}
