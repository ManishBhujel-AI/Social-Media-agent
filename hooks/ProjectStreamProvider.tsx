"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import type { TaskStatus } from "@prisma/client";
import { mergeTaskStreamEvent, type TaskWithMeta } from "@/lib/tasks/taskStream";
import type { TaskStreamPayload } from "@/lib/tasks/taskStream";
import type { MessageStreamPayload, TaskStreamEvent } from "@/hooks/useProjectStream";

type TaskListener = (event: TaskStreamEvent) => void;
type MessageListener = (message: MessageStreamPayload) => void;

const IN_PROGRESS_STATUSES: TaskStatus[] = [
  "NOT_STARTED",
  "AGENT_RUNNING",
  "WRITING_CAPTION",
  "WRITING_PROMPT",
  "GENERATING_IMAGE",
];

type ProjectStreamContextValue = {
  agentActivity: string | null;
  clearAgentActivity: () => void;
  tasks: TaskWithMeta[];
  setTasks: Dispatch<SetStateAction<TaskWithMeta[]>>;
  refreshTasks: () => Promise<TaskWithMeta[]>;
  hydrateProjectTasks: (initial: TaskWithMeta[]) => void;
  subscribeTaskEvents: (listener: TaskListener) => () => void;
  subscribeMessages: (listener: MessageListener) => () => void;
};

const ProjectStreamContext = createContext<ProjectStreamContextValue | null>(null);

export function ProjectStreamProvider({
  projectId,
  conversationId = null,
  children,
}: {
  projectId: string;
  conversationId?: string | null;
  children: ReactNode;
}) {
  const [agentActivity, setAgentActivity] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskWithMeta[]>([]);
  const [usePolling, setUsePolling] = useState(false);
  const errors = useRef(0);
  const taskListeners = useRef(new Set<TaskListener>());
  const messageListeners = useRef(new Set<MessageListener>());

  const clearAgentActivity = useCallback(() => setAgentActivity(null), []);

  const tasksQuery = conversationId ? `?conversation=${conversationId}` : "";

  const refreshTasks = useCallback(async (): Promise<TaskWithMeta[]> => {
    try {
      const res = await fetch(`/api/projects/${projectId}/tasks${tasksQuery}`);
      if (!res.ok) return [];
      const data = (await res.json()) as TaskWithMeta[];
      setTasks(data);
      return data;
    } catch {
      return [];
    }
  }, [projectId, tasksQuery]);

  const hydrateProjectTasks = useCallback(
    (initial: TaskWithMeta[]) => {
      setTasks((prev) => (prev.length > 0 ? prev : initial));
      void refreshTasks();
    },
    [refreshTasks]
  );

  useEffect(() => {
    setTasks([]);
    setUsePolling(false);
    errors.current = 0;
  }, [projectId, conversationId]);

  const subscribeTaskEvents = useCallback((listener: TaskListener) => {
    taskListeners.current.add(listener);
    return () => {
      taskListeners.current.delete(listener);
    };
  }, []);

  const subscribeMessages = useCallback((listener: MessageListener) => {
    messageListeners.current.add(listener);
    return () => {
      messageListeners.current.delete(listener);
    };
  }, []);

  const emitTaskEvent = useCallback((event: TaskStreamEvent) => {
    taskListeners.current.forEach((listener) => listener(event));
  }, []);

  const emitMessage = useCallback((message: MessageStreamPayload) => {
    messageListeners.current.forEach((listener) => listener(message));
  }, []);

  const applyTaskEvent = useCallback(
    (event: TaskStreamEvent) => {
      if (
        conversationId &&
        event.payload.conversationId &&
        event.payload.conversationId !== conversationId
      ) {
        return;
      }
      setTasks((prev) => mergeTaskStreamEvent(prev, event.type, event.payload));
      emitTaskEvent(event);
    },
    [conversationId, emitTaskEvent]
  );

  const handleEvent = useCallback(
    (raw: string) => {
      try {
        const data = JSON.parse(raw) as {
          type?: string;
          payload?: TaskStreamPayload & { label?: string } & MessageStreamPayload;
        };

        if (data.type === "agent.activity" && typeof data.payload?.label === "string") {
          setAgentActivity(data.payload.label);
          return;
        }

        if (data.type === "message.created" && data.payload?.id) {
          const payload = data.payload as MessageStreamPayload;
          const meta = payload.meta as {
            type?: string;
            taskId?: string;
            pendingQuestion?: string;
          } | null;

          if (meta?.type === "agent_question" && meta.taskId) {
            setTasks((prev) =>
              mergeTaskStreamEvent(prev, "task.updated", {
                taskId: meta.taskId!,
                status: "NEEDS_INFO",
                pendingQuestion: meta.pendingQuestion ?? payload.content,
                statusLabel: "Creating post — need your input…",
              })
            );
          } else if (meta?.type === "image_request" && meta.taskId) {
            setTasks((prev) =>
              mergeTaskStreamEvent(prev, "task.updated", {
                taskId: meta.taskId!,
                status: "NEEDS_INFO",
                pendingQuestion: payload.content,
                statusLabel: "Waiting for photo…",
                preImageRequest: true,
              })
            );
          }

          emitMessage(payload);
          return;
        }

        if (data.type === "task.deleted" && Array.isArray((data.payload as { taskIds?: string[] })?.taskIds)) {
          const removed = new Set((data.payload as { taskIds: string[] }).taskIds);
          setTasks((prev) => prev.filter((t) => !removed.has(t.id)));
          return;
        }

        if (
          (data.type === "task.created" || data.type === "task.updated") &&
          data.payload?.taskId
        ) {
          applyTaskEvent({ type: data.type, payload: data.payload });
          return;
        }

        if (data.type === "task.deliverable.updated" && data.payload?.taskId) {
          applyTaskEvent({
            type: "task.updated",
            payload: {
              taskId: data.payload.taskId as string,
              status: data.payload.status as TaskStreamPayload["status"],
            },
          });
          void refreshTasks();
        }
      } catch {
        /* ignore malformed events */
      }
    },
    [applyTaskEvent, emitMessage, refreshTasks]
  );

  useEffect(() => {
    if (usePolling) return;

    const es = new EventSource(`/api/stream/${projectId}`);
    let timeout: ReturnType<typeof setTimeout>;

    const armFallback = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        errors.current += 1;
        if (errors.current >= 1) {
          es.close();
          setUsePolling(true);
        }
      }, 8000);
    };

    es.onmessage = (ev) => {
      errors.current = 0;
      armFallback();
      handleEvent(ev.data);
    };
    es.onerror = () => {
      errors.current += 1;
      if (errors.current >= 2) {
        es.close();
        setUsePolling(true);
      }
    };

    armFallback();
    return () => {
      es.close();
      clearTimeout(timeout);
    };
  }, [projectId, usePolling, handleEvent]);

  const pipelineActive = tasks.some((t) => IN_PROGRESS_STATUSES.includes(t.status));

  useEffect(() => {
    if (!pipelineActive && !usePolling) return;

    const intervalMs = usePolling ? 10_000 : 12_000;
    const id = window.setInterval(() => void refreshTasks(), intervalMs);
    return () => window.clearInterval(id);
  }, [pipelineActive, usePolling, refreshTasks]);

  useEffect(() => {
    if (!usePolling) return;
    void refreshTasks();
  }, [usePolling, refreshTasks]);

  const value = useMemo(
    () => ({
      agentActivity,
      clearAgentActivity,
      tasks,
      setTasks,
      refreshTasks,
      hydrateProjectTasks,
      subscribeTaskEvents,
      subscribeMessages,
    }),
    [
      agentActivity,
      clearAgentActivity,
      tasks,
      refreshTasks,
      hydrateProjectTasks,
      subscribeTaskEvents,
      subscribeMessages,
    ]
  );

  return (
    <ProjectStreamContext.Provider value={value}>{children}</ProjectStreamContext.Provider>
  );
}

export function useProjectStreamContext() {
  return useContext(ProjectStreamContext);
}
