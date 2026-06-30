export function conversationQuery(conversationId: string | null | undefined): string {
  return conversationId ? `?conversation=${conversationId}` : "";
}
