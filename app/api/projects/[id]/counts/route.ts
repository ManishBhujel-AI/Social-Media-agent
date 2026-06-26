import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const tasks = await prisma.task.findMany({
    where: { projectId },
    select: { status: true },
  });

  return NextResponse.json({
    taskCount: tasks.length,
    needsCount: tasks.filter((t) => t.status === "NEEDS_APPROVAL").length,
  });
}
