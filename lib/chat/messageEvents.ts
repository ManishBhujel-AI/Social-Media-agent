import type { Message } from "@prisma/client";
import { emitProjectEvent } from "@/lib/events/emit";

export type MessageEventPayload = {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  meta: unknown;
  createdAt: string;
};

export function messageToEventPayload(message: Message): MessageEventPayload {
  return {
    id: message.id,
    conversationId: message.conversationId,
    role: message.role,
    content: message.content,
    meta: message.meta,
    createdAt: message.createdAt.toISOString(),
  };
}

export async function emitMessageCreated(projectId: string, message: Message): Promise<void> {
  await emitProjectEvent({
    type: "message.created",
    projectId,
    payload: messageToEventPayload(message),
  });
}
