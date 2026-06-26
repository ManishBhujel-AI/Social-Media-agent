import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { isProjectPipelinePaused } from "@/lib/queue/pipelinePauseFlag";
import { countInProgressTasks } from "@/lib/tasks/pendingTask";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;

  const tasks = await prisma.task.findMany({ where: { projectId } });
  const paused = await isProjectPipelinePaused(projectId);
  const inProgress = countInProgressTasks(tasks);
  const pausedTasks = tasks.filter((t) => t.statusLabel === "Paused").length;

  return NextResponse.json({
    paused: paused || pausedTasks > 0,
    inProgress,
    pausedTasks,
  });
}
