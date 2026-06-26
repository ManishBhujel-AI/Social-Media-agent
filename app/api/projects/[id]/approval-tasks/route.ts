import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const tasks = await prisma.task.findMany({
    where: { projectId, status: { in: ["NEEDS_APPROVAL", "CHANGES_REQUESTED"] } },
    orderBy: { orderIndex: "asc" },
    include: {
      generations: {
        where: { imagePath: { not: null } },
        orderBy: { createdAt: "asc" },
      },
      captionRevisions: { orderBy: { createdAt: "asc" } },
    },
  });

  return NextResponse.json(tasks);
}
