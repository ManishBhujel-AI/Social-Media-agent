import { prisma } from "@/lib/db/prisma";
import { ChatView } from "@/components/chat/ChatView";

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let conversation = await prisma.conversation.findFirst({
    where: { projectId: id },
    orderBy: { createdAt: "desc" },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: { projectId: id },
      include: { messages: true },
    });
  }

  const tasks = await prisma.task.findMany({
    where: { projectId: id },
    orderBy: { orderIndex: "asc" },
  });

  return (
    <ChatView
      projectId={id}
      conversationId={conversation.id}
      initialMessages={conversation.messages}
      tasks={tasks}
    />
  );
}
