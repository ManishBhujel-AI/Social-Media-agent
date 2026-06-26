import { prisma } from "@/lib/db/prisma";
import { ApprovalView } from "@/components/approval/ApprovalView";

export default async function ApprovePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tasks = await prisma.task.findMany({
    where: { projectId: id, status: { in: ["NEEDS_APPROVAL", "CHANGES_REQUESTED"] } },
    orderBy: { orderIndex: "asc" },
    include: {
      generations: {
        where: { imagePath: { not: null } },
        orderBy: { createdAt: "asc" },
      },
      captionRevisions: { orderBy: { createdAt: "asc" } },
    },
  });
  return <ApprovalView projectId={id} tasks={tasks} />;
}
