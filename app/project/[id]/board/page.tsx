import { prisma } from "@/lib/db/prisma";
import { BoardView } from "@/components/board/BoardView";

export default async function BoardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tasks = await prisma.task.findMany({
    where: { projectId: id },
    orderBy: { orderIndex: "asc" },
    include: {
      generations: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  return <BoardView projectId={id} initialTasks={tasks} />;
}
