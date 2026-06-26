import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { dispatchPipelineJob } from "@/lib/queue/dispatch";
import { makeGraphicForTask } from "@/lib/ai/agents/graphicAgent";
import { taskHasAssignedImage } from "@/lib/ai/agents/postImageRequest";
import { updateTaskFields } from "@/lib/tasks/taskEvents";

function hasResumableCheckpoint(agentState: unknown): boolean {
  if (!agentState || typeof agentState !== "object") return false;
  const state = agentState as { messages?: unknown[] };
  return Array.isArray(state.messages) && state.messages.length > 0;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;
  const task = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    include: { generations: { orderBy: { createdAt: "desc" }, take: 1 } },
  });

  const hasCaption = Boolean(task.caption?.trim());
  const hasGraphic = Boolean(task.generations[0]?.imagePath);

  if (task.status === "FAILED" && hasCaption && hasGraphic) {
    await prisma.task.update({
      where: { id: taskId },
      data: { status: "NEEDS_APPROVAL", statusLabel: null, pendingQuestion: null },
    });
    return NextResponse.json({ ok: true, healed: true });
  }

  if (task.status === "FAILED" && hasCaption && !hasGraphic) {
    await updateTaskFields(taskId, {
      status: "GENERATING_IMAGE",
      statusLabel: "Creating post — designing graphic…",
      pendingQuestion: null,
    });
    try {
      await makeGraphicForTask(taskId);
      await updateTaskFields(taskId, {
        status: "NEEDS_APPROVAL",
        statusLabel: null,
      });
      return NextResponse.json({ ok: true, healed: true });
    } catch (err) {
      await updateTaskFields(taskId, {
        status: "FAILED",
        statusLabel: err instanceof Error ? err.message : "Graphic generation failed — retry",
      });
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Graphic generation failed" },
        { status: 500 }
      );
    }
  }

  const skipImageRequest = taskHasAssignedImage(task);
  const resumeFromCheckpoint = hasResumableCheckpoint(task.agentState);

  await prisma.task.update({
    where: { id: taskId },
    data: {
      status: "AGENT_RUNNING",
      statusLabel: "Retrying…",
      pendingQuestion: null,
    },
  });

  if (resumeFromCheckpoint) {
    await dispatchPipelineJob({
      type: "RESUME_TASK_AGENT",
      taskId,
      projectId: task.projectId,
      payload: { taskId, userReply: "", resumeCheckpoint: true },
    });
  } else {
    await dispatchPipelineJob({
      type: "RUN_TASK_AGENT",
      taskId,
      projectId: task.projectId,
      payload: { taskId, remainingTaskIds: [], skipImageRequest },
    });
  }

  return NextResponse.json({ ok: true });
}
