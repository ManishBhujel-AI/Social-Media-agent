import { prisma } from "@/lib/db/prisma";
import { ChatView } from "@/components/chat/ChatView";
import { listTasksForConversation } from "@/lib/conversations/conversationTasks";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ChatPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ conversation?: string }>;
}) {
  const { id } = await params;
  const { conversation: conversationParam } = await searchParams;

  const project = await prisma.project.findUnique({ where: { id }, select: { id: true } });
  if (!project) redirect("/");

  const conversations = await prisma.conversation.findMany({
    where: { projectId: id },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { messages: true } },
    },
  });

  let conversation =
    (conversationParam
      ? conversations.find((c) => c.id === conversationParam)
      : null) ?? conversations[0];

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: { projectId: id },
      include: { _count: { select: { messages: true } } },
    });
  }

  if (!conversationParam) {
    redirect(`/project/${id}/chat?conversation=${conversation.id}`);
  }

  const messages = await prisma.message.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "asc" },
  });

  const tasks = await listTasksForConversation(id, conversation.id);

  const conversationSummaries = conversations.map((c) => ({
    id: c.id,
    createdAt: c.createdAt.toISOString(),
    messageCount: c._count.messages,
  }));

  if (conversationSummaries.every((c) => c.id !== conversation!.id)) {
    conversationSummaries.unshift({
      id: conversation.id,
      createdAt: conversation.createdAt.toISOString(),
      messageCount: messages.length,
    });
  }

  return (
    <ChatView
      projectId={id}
      conversationId={conversation.id}
      initialMessages={messages}
      tasks={tasks}
      conversations={conversationSummaries}
    />
  );
}
