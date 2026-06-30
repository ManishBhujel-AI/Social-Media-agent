import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { setProjectPipelinePaused } from "@/lib/queue/pipelinePauseFlag";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = await prisma.project.findUnique({ where: { id }, select: { id: true } });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const conversations = await prisma.conversation.findMany({
    where: { projectId: id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      _count: { select: { messages: true } },
    },
  });

  return NextResponse.json({
    conversations: conversations.map((c) => ({
      id: c.id,
      createdAt: c.createdAt.toISOString(),
      messageCount: c._count.messages,
    })),
  });
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = await prisma.project.findUnique({ where: { id }, select: { id: true } });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const conversation = await prisma.conversation.create({
    data: { projectId: id },
  });

  // Fresh workspace should not inherit a paused pipeline from another chat.
  await setProjectPipelinePaused(id, false);

  return NextResponse.json({
    id: conversation.id,
    createdAt: conversation.createdAt.toISOString(),
  });
}
