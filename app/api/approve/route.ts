import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { emitTaskUpdated } from "@/lib/tasks/taskEvents";

export async function POST(req: NextRequest) {
  const { taskId } = await req.json();
  if (!taskId) return NextResponse.json({ error: "taskId required" }, { status: 400 });

  const task = await prisma.task.update({
    where: { id: taskId },
    data: { status: "APPROVED", statusLabel: null, pendingQuestion: null },
  });

  await emitTaskUpdated(task);

  return NextResponse.json({ task });
}
