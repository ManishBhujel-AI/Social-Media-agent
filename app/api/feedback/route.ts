import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { dispatchFeedbackJob } from "@/lib/queue/dispatch";
import { MAX_FEEDBACK_REFERENCE_IMAGES } from "@/lib/ai/imageRefs.config";
import { emitTaskUpdated } from "@/lib/tasks/taskEvents";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { taskId, generationId, feedback, target, referenceImageIds } = body as {
    taskId: string;
    generationId?: string;
    feedback: string;
    target: "caption" | "image";
    referenceImageIds?: string[];
  };

  if (!taskId || !feedback || !target) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  if (target === "image" && !generationId) {
    return NextResponse.json({ error: "generationId required for image feedback" }, { status: 400 });
  }
  if (referenceImageIds && referenceImageIds.length > MAX_FEEDBACK_REFERENCE_IMAGES) {
    return NextResponse.json(
      { error: `At most ${MAX_FEEDBACK_REFERENCE_IMAGES} reference images allowed` },
      { status: 400 }
    );
  }

  const task = await prisma.task.update({
    where: { id: taskId },
    data: { status: "CHANGES_REQUESTED" },
  });

  await emitTaskUpdated(task);

  const jobId = await dispatchFeedbackJob({
    projectId: task.projectId,
    taskId,
    payload: { taskId, generationId, feedback, target, referenceImageIds },
  });

  return NextResponse.json({ jobId }, { status: 202 });
}
