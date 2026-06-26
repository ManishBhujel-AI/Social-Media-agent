import { prisma } from "@/lib/db/prisma";
import { notFound } from "next/navigation";
import { PostDetailView } from "@/components/detail/PostDetailView";

export default async function PostDetailPage({
  params,
}: {
  params: Promise<{ id: string; taskId: string }>;
}) {
  const { id, taskId } = await params;
  const task = await prisma.task.findFirst({
    where: { id: taskId, projectId: id },
    include: {
      generations: { orderBy: { createdAt: "asc" } },
      captionRevisions: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!task) notFound();
  return <PostDetailView task={task} />;
}
