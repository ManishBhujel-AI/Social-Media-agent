import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tasks = await prisma.task.findMany({
    where: { projectId: id },
    orderBy: { orderIndex: "asc" },
    include: {
      generations: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  const etag = tasks.map((t) => `${t.id}:${t.updatedAt.getTime()}:${t.status}`).join("|");
  return NextResponse.json(tasks, {
    headers: { ETag: `"${etag}"` },
  });
}
