import { ApprovalView } from "@/components/approval/ApprovalView";
import { listTasksForConversation, resolveProjectConversation } from "@/lib/conversations/conversationTasks";
import { redirect } from "next/navigation";

export default async function ApprovePage({
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
    redirect(`/project/${id}/approve?conversation=${conversationId}`);
  }

  const tasks = await listTasksForConversation(id, conversationId, {
    where: { status: { in: ["NEEDS_APPROVAL", "CHANGES_REQUESTED"] } },
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
