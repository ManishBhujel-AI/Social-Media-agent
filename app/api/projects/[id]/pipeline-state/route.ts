import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { collectConversationTaskIds } from "@/lib/conversations/conversationTasks";
import { isProjectPipelinePaused } from "@/lib/queue/pipelinePauseFlag";
import { countInProgressTasks } from "@/lib/tasks/pendingTask";

const IN_PROGRESS = [
  "AGENT_RUNNING",
  "WRITING_CAPTION",
  "WRITING_PROMPT",
  "GENERATING_IMAGE",
] as const;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const conversationId = req.nextUrl.searchParams.get("conversation");

  const globalPaused = await isProjectPipelinePaused(projectId);

  let tasks;
  if (conversationId) {
    tasks = await prisma.task.findMany({ where: { projectId, conversationId } });
    if (!tasks.length) {
      const scopedTaskIds = await collectConversationTaskIds(conversationId);
      tasks =
        scopedTaskIds.length > 0
          ? await prisma.task.findMany({ where: { projectId, id: { in: scopedTaskIds } } })
          : [];
    }
  } else {
    tasks = await prisma.task.findMany({ where: { projectId } });
  }

  const inProgress = countInProgressTasks(tasks);
  const pausedTasks = tasks.filter((t) => t.statusLabel === "Paused").length;
  const hasActiveWork = tasks.some(
    (t) =>
      IN_PROGRESS.includes(t.status as (typeof IN_PROGRESS)[number]) ||
      t.status === "NEEDS_INFO"
  );

  const paused = pausedTasks > 0 || (globalPaused && hasActiveWork);

  return NextResponse.json({
    paused,
    inProgress,
    pausedTasks,
  });
}
