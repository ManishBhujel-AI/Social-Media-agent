import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { dispatchPipelineJob } from "@/lib/queue/dispatch";
import { advanceImageCollectionQueue } from "@/lib/queue/pipelineGate";
import { makeGraphicForTask } from "@/lib/ai/agents/graphicAgent";
import { taskHasAssignedImage } from "@/lib/ai/agents/postImageRequest";
import { updateTaskFields } from "@/lib/tasks/taskEvents";
import {
  isInProgressStatus,
  promoteTaskIfDeliverableReady,
  taskDeliverableReady,
} from "@/lib/tasks/deliverable";
import { deserializeAgentState } from "@/lib/ai/agentLoop";
import {
  finishPostFromResearchCheckpoint,
  isReadyForCaptionCheckpoint,
} from "@/lib/ai/agents/postCheckpoint";
import { formatTaskFailureLabel } from "@/lib/tasks/failureLabel";

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
  const canRetry =
    task.status === "FAILED" || isInProgressStatus(task.status);

  if (!canRetry) {
    return NextResponse.json({ error: "This post is not in a retryable state." }, { status: 400 });
  }

  const scope = task.conversationId ? { conversationId: task.conversationId } : undefined;

  if (hasCaption && hasGraphic) {
    const healed = await promoteTaskIfDeliverableReady(taskId);
    if (healed) {
      void advanceImageCollectionQueue(task.projectId, { force: true, scope });
      return NextResponse.json({ ok: true, healed: true });
    }
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
      void advanceImageCollectionQueue(task.projectId, { force: true, scope });
      return NextResponse.json({ ok: true, healed: true });
    } catch (err) {
      await updateTaskFields(taskId, {
        status: "FAILED",
        statusLabel: formatTaskFailureLabel(err instanceof Error ? err.message : String(err)),
      });
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Graphic generation failed" },
        { status: 500 }
      );
    }
  }

  const skipImageRequest = taskHasAssignedImage(task);
  const resumeFromCheckpoint = hasResumableCheckpoint(task.agentState);
  const agentState = deserializeAgentState(task.agentState);

  if (
    resumeFromCheckpoint &&
    agentState &&
    isReadyForCaptionCheckpoint(agentState) &&
    !hasCaption
  ) {
    await updateTaskFields(taskId, {
      status: "AGENT_RUNNING",
      statusLabel: "Retrying — writing caption & graphic…",
      pendingQuestion: null,
    });
    try {
      const finished = await finishPostFromResearchCheckpoint(taskId);
      if (finished) {
        await updateTaskFields(taskId, {
          status: "NEEDS_APPROVAL",
          statusLabel: null,
        });
        void advanceImageCollectionQueue(task.projectId, { force: true, scope });
        return NextResponse.json({ ok: true, healed: true });
      }
    } catch (err) {
      await updateTaskFields(taskId, {
        status: "FAILED",
        statusLabel: formatTaskFailureLabel(err instanceof Error ? err.message : String(err)),
      });
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Post generation failed" },
        { status: 500 }
      );
    }
  }

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

  void advanceImageCollectionQueue(task.projectId, { force: true, scope });

  const stillReady = await taskDeliverableReady(taskId);
  return NextResponse.json({ ok: true, resumed: !stillReady });
}
