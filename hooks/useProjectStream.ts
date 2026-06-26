"use client";

import { useEffect } from "react";
import type { TaskStreamPayload } from "@/lib/tasks/taskStream";
import { useProjectStreamContext } from "@/hooks/ProjectStreamProvider";

export type { TaskWithMeta } from "@/lib/tasks/taskStream";

export type TaskStreamEvent = {
  type: "task.created" | "task.updated";
  payload: TaskStreamPayload;
};

export type MessageStreamPayload = {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  meta: unknown;
  createdAt: string;
};

/** Subscribe to the shared project SSE stream — no polling, no automatic API refresh. */
export function useProjectStream(
  _projectId: string,
  options?: {
    onTaskEvent?: (event: TaskStreamEvent) => void;
    onMessageCreated?: (message: MessageStreamPayload) => void;
  }
) {
  const ctx = useProjectStreamContext();
  const { onTaskEvent, onMessageCreated } = options ?? {};

  useEffect(() => {
    if (!ctx) return;
    const unsubscribers: Array<() => void> = [];
    if (onTaskEvent) unsubscribers.push(ctx.subscribeTaskEvents(onTaskEvent));
    if (onMessageCreated) unsubscribers.push(ctx.subscribeMessages(onMessageCreated));
    return () => {
      unsubscribers.forEach((unsub) => unsub());
    };
  }, [ctx, onTaskEvent, onMessageCreated]);

  return {
    agentActivity: ctx?.agentActivity ?? null,
    clearAgentActivity: ctx?.clearAgentActivity ?? (() => {}),
  };
}
