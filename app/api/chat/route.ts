import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { streamChat } from "@/lib/ai/agents/chatAgent";
import { routeChatToPausedTask, findPausedTaskForProject } from "@/lib/chat/resumeFromChat";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    conversationId,
    projectId,
    message,
    imageIds,
    taskId,
    productNotes,
    contextImageId,
  } = body;
  const imageIdList = Array.isArray(imageIds) ? (imageIds as string[]) : undefined;
  const trimmed = typeof message === "string" ? message.trim() : "";
  const notes = typeof productNotes === "string" ? productNotes.trim() : "";
  const contextImage =
    typeof contextImageId === "string" && contextImageId.trim()
      ? contextImageId.trim()
      : undefined;

  if (!conversationId || !projectId) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const paused = typeof taskId === "string"
    ? await prisma.task.findFirst({
        where: { id: taskId, projectId, status: "NEEDS_INFO" },
      })
    : await findPausedTaskForProject(projectId);

  if (paused) {
    if (!trimmed && !imageIdList?.length && !notes && !contextImage) {
      return NextResponse.json({ error: "Reply, upload photos, or add product info" }, { status: 400 });
    }
    const resume = await routeChatToPausedTask({
      projectId,
      conversationId,
      message: trimmed,
      imageIds: imageIdList,
      taskId: typeof taskId === "string" ? taskId : undefined,
      productNotes: notes || undefined,
      contextImageId: contextImage,
    });
    if (resume.mode === "error") {
      return NextResponse.json({ error: resume.message }, { status: 409 });
    }
    return NextResponse.json(resume);
  }

  if (!trimmed && !imageIdList?.length) {
    return NextResponse.json({ error: "Missing message" }, { status: 400 });
  }

  const stream = streamChat({
    projectId,
    conversationId,
    userMessage: trimmed || (imageIdList?.length ? "Here is the logo" : ""),
    imageIds: imageIdList,
    signal: req.signal,
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
