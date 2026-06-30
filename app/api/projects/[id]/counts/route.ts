import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  countTasksForConversation,
  resolveProjectConversation,
} from "@/lib/conversations/conversationTasks";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const conversationParam = req.nextUrl.searchParams.get("conversation");
  const conversationId = await resolveProjectConversation(projectId, conversationParam);

  if (conversationParam && conversationId) {
    const counts = await countTasksForConversation(projectId, conversationId);
    return NextResponse.json(counts);
  }

  const tasks = await prisma.task.findMany({
    where: { projectId },
    select: { status: true },
  });

  return NextResponse.json({
    taskCount: tasks.length,
    needsCount: tasks.filter((t) => t.status === "NEEDS_APPROVAL").length,
  });
}
