import { BoardView } from "@/components/board/BoardView";
import { listTasksForConversation, resolveProjectConversation } from "@/lib/conversations/conversationTasks";
import { redirect } from "next/navigation";

export default async function BoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ conversation?: string }>;
}) {
  const { id } = await params;
  const { conversation: conversationParam } = await searchParams;
  const conversationId = await resolveProjectConversation(id, conversationParam);

  if (!conversationParam && conversationId) {
    redirect(`/project/${id}/board?conversation=${conversationId}`);
  }

  const tasks = await listTasksForConversation(id, conversationId, {
    include: {
      generations: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  return (
    <BoardView projectId={id} conversationId={conversationId} initialTasks={tasks} />
  );
}
