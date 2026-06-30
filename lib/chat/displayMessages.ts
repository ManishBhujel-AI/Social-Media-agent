import type { Message } from "@prisma/client";

type MessageMeta = {
  type?: string;
  taskId?: string;
};

/** Hide tool traces and internal JSON blobs from the chat UI. */
export function looksLikeInternalJson(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return false;
    return (
      "status" in parsed ||
      "taskIds" in parsed ||
      "ok" in parsed ||
      "paused" in parsed ||
      "choice" in parsed ||
      "count" in parsed ||
      "visionMatches" in parsed ||
      "autoAttachedImage" in parsed ||
      "logoUrl" in parsed ||
      "imageUrl" in parsed ||
      "imageId" in parsed
    );
  } catch {
    return false;
  }
}

export function isDisplayableChatMessage(m: Message): boolean {
  if (m.role === "tool") return false;
  if (m.role !== "user" && m.role !== "assistant") return false;
  if (m.role === "assistant" && looksLikeInternalJson(m.content)) return false;
  return true;
}

/** Collapse model output that repeats the same photo-card instructions many times. */
export function collapseRepeatedAssistantProse(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return content;

  const parts = trimmed
    .split(/(?=(?:Of course!|Absolutely\.|Great, I'll|Great, I will|Just a heads-up|Just so you know))/i)
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length <= 1) return content;

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const part of parts) {
    const norm = part.replace(/\s+/g, " ").toLowerCase().slice(0, 160);
    if (seen.has(norm)) continue;
    seen.add(norm);
    unique.push(part);
  }

  return unique.length === 1 ? unique[0]! : unique.join("\n\n");
}

/** Keep only the latest image_request card per post — older duplicates are hidden. */
function dedupeImageRequestMessages(messages: Message[]): Message[] {
  const latestIdByTask = new Map<string, string>();
  for (const m of messages) {
    if (!m.meta || typeof m.meta !== "object") continue;
    const meta = m.meta as { type?: string; taskId?: string };
    if (meta.type === "image_request" && meta.taskId) {
      latestIdByTask.set(meta.taskId, m.id);
    }
  }
  if (!latestIdByTask.size) return messages;

  return messages.filter((m) => {
    if (!m.meta || typeof m.meta !== "object") return true;
    const meta = m.meta as { type?: string; taskId?: string };
    if (meta.type !== "image_request" || !meta.taskId) return true;
    return latestIdByTask.get(meta.taskId) === m.id;
  });
}

/** Keep only the latest agent_question card per post — older duplicates are hidden. */
function dedupeAgentQuestionMessages(messages: Message[]): Message[] {
  const latestIdByTask = new Map<string, string>();
  for (const m of messages) {
    if (!m.meta || typeof m.meta !== "object") continue;
    const meta = m.meta as { type?: string; taskId?: string };
    if (meta.type === "agent_question" && meta.taskId) {
      latestIdByTask.set(meta.taskId, m.id);
    }
  }
  if (!latestIdByTask.size) return messages;

  return messages.filter((m) => {
    if (!m.meta || typeof m.meta !== "object") return true;
    const meta = m.meta as { type?: string; taskId?: string };
    if (meta.type !== "agent_question" || !meta.taskId) return true;
    return latestIdByTask.get(meta.taskId) === m.id;
  });
}

export function filterDisplayMessages(
  messages: Message[],
  activeImageRequestTaskId?: string | null,
  /** Fallback when SSE has not yet synced preImageRequest (lowest-order NEEDS_INFO task). */
  pendingImageRequestTaskId?: string | null
): Message[] {
  const visibleImageRequestId = activeImageRequestTaskId ?? pendingImageRequestTaskId;

  const filtered = dedupeDisplayableMessages(messages).filter((m) => {
    if (m.meta && typeof m.meta === "object") {
      const type = (m.meta as { type?: string; taskId?: string }).type;
      const taskId = (m.meta as { taskId?: string }).taskId;
      if (type === "image_request") {
        return Boolean(visibleImageRequestId && taskId === visibleImageRequestId);
      }
    }
    return true;
  });

  return filtered;
}

function dedupeDisplayableMessages(messages: Message[]): Message[] {
  const displayable = messages.filter(isDisplayableChatMessage);
  return dedupeAgentQuestionMessages(dedupeImageRequestMessages(displayable));
}

/**
 * Merge server messages with local state without dropping an in-flight streamed reply.
 * Visibility filtering (active photo card) happens at render time — not here — so
 * background task refreshes do not strip image_request messages from state.
 */
export function mergeServerMessages(
  local: Message[],
  server: Message[],
  streamingMessageId?: string | null
): Message[] {
  const fromServer = dedupeDisplayableMessages(server);

  if (!streamingMessageId) {
    return fromServer;
  }

  const streaming = local.find((m) => m.id === streamingMessageId);
  if (!streaming) {
    return fromServer;
  }

  const onServer = fromServer.some(
    (m) =>
      m.id === streaming.id ||
      (m.role === "assistant" &&
        streaming.role === "assistant" &&
        m.content === streaming.content &&
        m.content.length > 0)
  );

  if (onServer) {
    return fromServer;
  }

  return [...fromServer, streaming];
}

export function appendMessageIfNew(messages: Message[], incoming: Message): Message[] {
  if (!isDisplayableChatMessage(incoming)) return messages;
  if (messages.some((m) => m.id === incoming.id)) return messages;
  return [...messages, incoming];
}

export function messageMetaType(m: Message): string | undefined {
  if (!m.meta || typeof m.meta !== "object") return undefined;
  return (m.meta as MessageMeta).type;
}
