"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import type { Message, Task } from "@prisma/client";
import { GLASS_CARD, PAGE_PADDING } from "@/lib/design/tokens";
import { PostImageRequestCard } from "@/components/chat/PostImageRequestCard";
import { AgentQuestionCard } from "@/components/chat/AgentQuestionCard";
import { BrandKitQuestionCard } from "@/components/chat/BrandKitQuestionCard";
import type { BrandKitFieldName } from "@/lib/brandKit/types";
import { ChatAgentActivityRow, deriveChatStatus } from "@/components/chat/ChatStatusBar";
import {
  useProjectStream,
  type MessageStreamPayload,
} from "@/hooks/useProjectStream";
import { useProjectTasks } from "@/hooks/useProjectTasks";
import { mergeTaskStreamEvent } from "@/lib/tasks/taskStream";
import {
  filterDisplayMessages,
  mergeServerMessages,
  appendMessageIfNew,
  isDisplayableChatMessage,
} from "@/lib/chat/displayMessages";
import {
  getActivePendingTask,
  getActiveImageRequestTaskId,
  isPhotoCollectionPause,
  isImageCollectionBlocked,
  countInProgressTasks,
  countActiveInProgressTasks,
  pendingTaskReplyHint,
  shouldShowAgentQuestionCard,
} from "@/lib/tasks/pendingTask";

type MessageMeta = {
  type?: string;
  taskId?: string;
  field?: BrandKitFieldName;
  pendingQuestion?: string;
  allowSkip?: boolean;
  imageIds?: string[];
  postTitle?: string;
  productName?: string;
  orderIndex?: number;
};

function findPendingBrandKitQuestion(messages: Message[]): {
  field: BrandKitFieldName;
  pendingQuestion: string;
  allowSkip: boolean;
} | null {
  let pending: {
    field: BrandKitFieldName;
    pendingQuestion: string;
    allowSkip: boolean;
  } | null = null;

  for (const m of messages) {
    const meta = messageMeta(m);
    if (!meta) continue;
    if (meta.type === "brand_kit_reply" && meta.field) {
      if (pending?.field === meta.field) pending = null;
      continue;
    }
    if (meta.type === "brand_kit_question" && meta.field) {
      pending = {
        field: meta.field,
        pendingQuestion: meta.pendingQuestion ?? m.content,
        allowSkip: meta.allowSkip === true,
      };
    }
  }
  return pending;
}

function messageMeta(m: Message): MessageMeta | null {
  if (!m.meta || typeof m.meta !== "object") return null;
  return m.meta as MessageMeta;
}

export function ChatView({
  projectId,
  conversationId,
  initialMessages,
  tasks: initialTasks,
}: {
  projectId: string;
  conversationId: string;
  initialMessages: Message[];
  tasks: Task[];
}) {
  const [messages, setMessages] = useState(() => filterDisplayMessages(initialMessages));
  const { tasks, setTasks, refreshTasks: refreshProjectTasks } = useProjectTasks(initialTasks);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [imageIds, setImageIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [pipelinePaused, setPipelinePaused] = useState(false);
  const [pipelineBusy, setPipelineBusy] = useState(false);

  type QueuedMessage = { id: string; text: string; imageIds: string[] };
  const MAX_QUEUE_DEPTH = 5;
  const [messageQueue, setMessageQueue] = useState<QueuedMessage[]>([]);
  const [queueError, setQueueError] = useState<string | null>(null);
  const flushingRef = useRef(false);

  const streamingMessageIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const conversationRef = useRef(conversationId);
  const kickedPipelineRef = useRef<Set<string>>(new Set());
  const lastKickAtRef = useRef(0);
  const refreshMessagesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completionAnnouncedRef = useRef(false);

  const KICK_COOLDOWN_MS = 20_000;

  const pendingTask = getActivePendingTask(tasks);
  const activeImageRequestTaskId = getActiveImageRequestTaskId(tasks);
  const pendingImageRequestTaskId =
    pendingTask && isPhotoCollectionPause(pendingTask) ? pendingTask.id : null;
  const visibleImageRequestTaskId = activeImageRequestTaskId ?? pendingImageRequestTaskId;

  const sortedTasks = [...tasks].sort((a, b) => a.orderIndex - b.orderIndex);
  const hasActivePipeline =
    sortedTasks.length > 0 &&
    sortedTasks.some((t) =>
      [
        "NOT_STARTED",
        "AGENT_RUNNING",
        "WRITING_CAPTION",
        "WRITING_PROMPT",
        "GENERATING_IMAGE",
      ].includes(t.status)
    );
  const pipelineActive = sortedTasks.some((t) =>
    [
      "NOT_STARTED",
      "AGENT_RUNNING",
      "WRITING_CAPTION",
      "WRITING_PROMPT",
      "GENERATING_IMAGE",
      "NEEDS_INFO",
      "FAILED",
    ].includes(t.status)
  );

  const refreshMessages = useCallback(async () => {
    try {
      const [msgRes, taskData] = await Promise.all([
        fetch(`/api/conversations/${conversationId}/messages`),
        refreshProjectTasks(),
      ]);

      const pending = getActivePendingTask(taskData);
      const activeId =
        getActiveImageRequestTaskId(taskData) ??
        (pending && isPhotoCollectionPause(pending) ? pending.id : null);

      if (msgRes.ok) {
        const data = await msgRes.json();
        setMessages((prev) =>
          mergeServerMessages(
            prev,
            data.messages ?? [],
            streamingMessageIdRef.current,
            activeId,
            activeId
          )
        );
      }
    } catch {
      /* ignore */
    }
  }, [conversationId, refreshProjectTasks]);

  const scheduleRefreshMessages = useCallback(
    (delayMs = 1500) => {
      if (refreshMessagesTimerRef.current) {
        clearTimeout(refreshMessagesTimerRef.current);
      }
      refreshMessagesTimerRef.current = setTimeout(() => {
        refreshMessagesTimerRef.current = null;
        void refreshMessages();
      }, delayMs);
    },
    [refreshMessages]
  );

  const refreshTasks = useCallback(async () => {
    try {
      const stateRes = await fetch(`/api/projects/${projectId}/pipeline-state`);
      await refreshProjectTasks();
      if (stateRes.ok) {
        const state = await stateRes.json();
        setPipelinePaused(Boolean(state.paused));
      }
    } catch {
      /* ignore */
    }
  }, [projectId, refreshProjectTasks]);

  const onTaskEvent = useCallback(
    (event: { type: "task.created" | "task.updated"; payload: Parameters<typeof mergeTaskStreamEvent>[2] }) => {
      if (
        event.payload.status === "NEEDS_INFO" ||
        event.payload.status === "NEEDS_APPROVAL" ||
        event.payload.status === "FAILED"
      ) {
        scheduleRefreshMessages();
      }
    },
    [scheduleRefreshMessages]
  );

  const onMessageCreated = useCallback(
    (payload: MessageStreamPayload) => {
      const incoming = {
        id: payload.id,
        conversationId: payload.conversationId,
        role: payload.role as Message["role"],
        content: payload.content,
        meta: payload.meta as Message["meta"],
        createdAt: new Date(payload.createdAt),
      } as Message;
      if (!isDisplayableChatMessage(incoming)) return;
      setMessages((prev) => appendMessageIfNew(prev, incoming));

      const meta = payload.meta as MessageMeta | null;
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
    },
    []
  );

  const { agentActivity, clearAgentActivity } = useProjectStream(projectId, {
    onTaskEvent,
    onMessageCreated,
  });

  useEffect(() => {
    if (conversationRef.current === conversationId) return;
    conversationRef.current = conversationId;
    setMessages(filterDisplayMessages(initialMessages));
    kickedPipelineRef.current.clear();
    streamingMessageIdRef.current = null;
    completionAnnouncedRef.current = false;
    setMessageQueue([]);
    setQueueError(null);
  }, [conversationId, initialMessages]);

  const kickPipelineThrottled = useCallback(
    async (key: string) => {
      const now = Date.now();
      if (kickedPipelineRef.current.has(key)) return;
      if (now - lastKickAtRef.current < KICK_COOLDOWN_MS) return;

      kickedPipelineRef.current.add(key);
      lastKickAtRef.current = now;
      try {
        await fetch(`/api/projects/${projectId}/kick-pipeline`, { method: "POST" });
        await refreshTasks();
      } catch {
        kickedPipelineRef.current.delete(key);
      }
    },
    [projectId, refreshTasks]
  );

  useEffect(() => {
    const stalledSubmitted = tasks.filter((t) => {
      if (t.status !== "NOT_STARTED") return false;
      const urls = (t.sourceImages as string[] | null) ?? [];
      return urls.length > 0 || Boolean(t.productImageUrl);
    });
    if (stalledSubmitted.length) {
      const key = `stalled:${stalledSubmitted.map((t) => t.id).sort().join(",")}`;
      void kickPipelineThrottled(key);
      return;
    }

    if (isImageCollectionBlocked(tasks)) return;

    const stuck = tasks.filter((t) => t.status === "NOT_STARTED");
    if (!stuck.length) return;

    const key = stuck.map((t) => t.id).sort().join(",");
    void kickPipelineThrottled(key);
  }, [tasks, kickPipelineThrottled]);

  /** Worker runs in a separate process — poll messages + tasks while posts are actively running. */
  useEffect(() => {
    if (!hasActivePipeline) return;

    void refreshMessages();
    const id = window.setInterval(() => void refreshMessages(), 12_000);
    return () => {
      window.clearInterval(id);
      if (refreshMessagesTimerRef.current) {
        clearTimeout(refreshMessagesTimerRef.current);
        refreshMessagesTimerRef.current = null;
      }
    };
  }, [hasActivePipeline, refreshMessages]);

  const stopGeneration = useCallback(() => {
    if (!abortRef.current || stopping) return;
    setStopping(true);
    abortRef.current.abort();
  }, [stopping]);

  const markAssistantStopped = useCallback((assistantId: string | null) => {
    if (!assistantId) return;
    setMessages((m) =>
      m.map((msg) => {
        if (msg.id !== assistantId) return msg;
        const content = msg.content.trim();
        return {
          ...msg,
          content: content ? `${content}\n\n— Stopped` : "Stopped.",
        } as Message;
      })
    );
  }, []);

  const performSend = useCallback(
    async (payload: { text: string; imageIds: string[] }) => {
      const canSendWithImages = payload.imageIds.length > 0;
      if (!payload.text.trim() && !canSendWithImages) return;

      setLoading(true);
      setStopping(false);
      setQueueError(null);
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const userMsg =
        payload.text.trim() ||
        (canSendWithImages
          ? pendingTask
            ? "[Uploaded product photo]"
            : "[Uploaded logo]"
          : "");
      const sentImageIds = [...payload.imageIds];

      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "user",
          content: userMsg,
          meta: sentImageIds.length ? { imageIds: sentImageIds } : null,
        } as Message,
      ]);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            conversationId,
            message: userMsg.startsWith("[Uploaded") ? "" : userMsg,
            imageIds: sentImageIds.length ? sentImageIds : undefined,
          }),
          signal: controller.signal,
        });

        const contentType = res.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
          const data = await res.json();
          if (data.mode === "resume" && data.message) {
            setMessages((m) => [
              ...m,
              { id: crypto.randomUUID(), role: "assistant", content: data.message } as Message,
            ]);
          } else if (data.error) {
            setMessages((m) => [
              ...m,
              { id: crypto.randomUUID(), role: "assistant", content: data.error } as Message,
            ]);
          }
        } else {
          const assistantId = crypto.randomUUID();
          streamingMessageIdRef.current = assistantId;
          setMessages((m) => [
            ...m,
            { id: assistantId, role: "assistant", content: "" } as Message,
          ]);

          const reader = res.body?.getReader();
          const decoder = new TextDecoder();
          let text = "";

          if (reader) {
            const onAbort = () => {
              void reader.cancel();
            };
            controller.signal.addEventListener("abort", onAbort);

            try {
              while (true) {
                if (controller.signal.aborted) break;
                const { done, value } = await reader.read();
                if (done) break;
                text += decoder.decode(value, { stream: true });
                const snapshot = text;
                setMessages((m) =>
                  m.map((msg) => (msg.id === assistantId ? { ...msg, content: snapshot } : msg))
                );
              }
              if (!controller.signal.aborted) {
                text += decoder.decode();
                if (text) {
                  setMessages((m) =>
                    m.map((msg) => (msg.id === assistantId ? { ...msg, content: text } : msg))
                  );
                }
              }
            } finally {
              controller.signal.removeEventListener("abort", onAbort);
            }

            if (controller.signal.aborted) {
              markAssistantStopped(assistantId);
            }
          } else {
            text = await res.text();
            setMessages((m) =>
              m.map((msg) => (msg.id === assistantId ? { ...msg, content: text } : msg))
            );
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          markAssistantStopped(streamingMessageIdRef.current);
        } else {
          setMessages((m) => [
            ...m,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              content: "Sorry, something went wrong. Please try again.",
            } as Message,
          ]);
        }
      } finally {
        abortRef.current = null;
        streamingMessageIdRef.current = null;
        setStopping(false);
        clearAgentActivity();
        setLoading(false);
        await refreshTasks();
        await refreshMessages();
      }
    },
    [
      projectId,
      conversationId,
      pendingTask,
      markAssistantStopped,
      clearAgentActivity,
      refreshTasks,
      refreshMessages,
    ]
  );

  const chatBusy = loading || stopping || Boolean(agentActivity);

  const enqueueOrSend = useCallback(() => {
    const canSendWithImages = imageIds.length > 0;
    if (!input.trim() && !canSendWithImages) return;

    if (chatBusy) {
      if (messageQueue.length >= MAX_QUEUE_DEPTH) {
        setQueueError(`Queue is full (${MAX_QUEUE_DEPTH} messages). Remove one or wait for the agent to finish.`);
        return;
      }
      setMessageQueue((q) => [
        ...q,
        { id: crypto.randomUUID(), text: input.trim(), imageIds: [...imageIds] },
      ]);
      setInput("");
      setImageIds([]);
      setQueueError(null);
      return;
    }

    const text = input.trim();
    const ids = [...imageIds];
    setInput("");
    setImageIds([]);
    void performSend({ text, imageIds: ids });
  }, [input, imageIds, chatBusy, messageQueue.length, performSend]);

  const removeQueuedMessage = useCallback((id: string) => {
    setMessageQueue((q) => q.filter((m) => m.id !== id));
    setQueueError(null);
  }, []);

  useEffect(() => {
    if (chatBusy || flushingRef.current || messageQueue.length === 0) return;

    const [next, ...rest] = messageQueue;
    flushingRef.current = true;
    setMessageQueue(rest);
    void performSend({ text: next.text, imageIds: next.imageIds }).finally(() => {
      flushingRef.current = false;
    });
  }, [chatBusy, messageQueue, performSend]);

  const onUpload = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("projectId", projectId);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (data.imageId) setImageIds((ids) => [...ids, data.imageId]);
    } finally {
      setUploading(false);
    }
  };

  const onImageCardResponded = useCallback(async (ack?: string) => {
    if (ack?.trim()) {
      setMessages((m) => [
        ...m,
        { id: crypto.randomUUID(), role: "assistant", content: ack.trim() } as Message,
      ]);
    }
    await refreshTasks();
    await refreshMessages();
  }, [refreshMessages, refreshTasks]);

  const onQuestionCardResponded = useCallback(
    async (ack?: string, userMessage?: string) => {
      if (userMessage?.trim()) {
        setMessages((m) => [
          ...m,
          { id: crypto.randomUUID(), role: "user", content: userMessage.trim() } as Message,
        ]);
      }
      if (ack?.trim()) {
        const isError =
          ack.includes("Could not") ||
          ack.includes("Try again") ||
          ack.includes("Resume work");
        setMessages((m) => [
          ...m,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: ack.trim(),
          } as Message,
        ]);
        if (isError) {
          await refreshTasks();
          return;
        }
      }
      await refreshTasks();
      await refreshMessages();
    },
    [refreshMessages, refreshTasks]
  );

  const pausePipeline = useCallback(async () => {
    if (pipelineBusy || pipelinePaused) return;
    setPipelineBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/pause-pipeline`, { method: "POST" });
      if (res.ok) setPipelinePaused(true);
      await refreshTasks();
    } finally {
      setPipelineBusy(false);
    }
  }, [projectId, pipelineBusy, pipelinePaused, refreshTasks]);

  const resumePipeline = useCallback(async () => {
    if (pipelineBusy || !pipelinePaused) return;
    setPipelineBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/resume-pipeline`, { method: "POST" });
      if (res.ok) setPipelinePaused(false);
      await refreshTasks();
    } finally {
      setPipelineBusy(false);
    }
  }, [projectId, pipelineBusy, pipelinePaused, refreshTasks]);

  const stopAllWork = useCallback(async () => {
    if (loading || agentActivity) {
      stopGeneration();
    }
    if (!pipelinePaused && !pipelineBusy && pipelineActive) {
      await pausePipeline();
    }
  }, [
    loading,
    agentActivity,
    pipelinePaused,
    pipelineBusy,
    pipelineActive,
    pausePipeline,
    stopGeneration,
  ]);

  const displayMessages = filterDisplayMessages(
    messages,
    activeImageRequestTaskId,
    pendingImageRequestTaskId
  );

  const isPlanning = Boolean(stopping || loading || agentActivity);
  const planningLabel = stopping ? "Stopping…" : agentActivity ?? "Thinking…";
  const lastDisplay = displayMessages[displayMessages.length - 1];
  const streamingAssistantPlaceholder =
    isPlanning &&
    lastDisplay?.role === "assistant" &&
    !lastDisplay.content.trim();

  const pendingBrandKitQuestion = findPendingBrandKitQuestion(displayMessages);

  const chatStatus = deriveChatStatus({
    loading,
    stopping,
    pipelinePaused,
    agentActivity,
    tasks: sortedTasks,
    pendingTask,
    activeImageRequestTaskId,
    pendingBrandKitQuestion,
  });

  const hasPendingCard = Boolean(
    pendingTask &&
      displayMessages.some((msg) => {
        const msgMeta = messageMeta(msg);
        return (
          msgMeta?.taskId === pendingTask.id &&
          (msgMeta?.type === "image_request" || msgMeta?.type === "agent_question")
        );
      })
  );

  const inProgressCount = countInProgressTasks(sortedTasks);
  const activeInProgressCount = countActiveInProgressTasks(sortedTasks);
  const readyForApprovalCount = sortedTasks.filter((t) => t.status === "NEEDS_APPROVAL").length;
  const failedCount = sortedTasks.filter((t) => t.status === "FAILED").length;
  const allPostsFinished =
    sortedTasks.length > 0 &&
    sortedTasks.every((t) =>
      ["NEEDS_APPROVAL", "APPROVED", "FAILED"].includes(t.status)
    );
  const showCompletionMessage = allPostsFinished && readyForApprovalCount > 0;

  useEffect(() => {
    if (!showCompletionMessage || completionAnnouncedRef.current) return;
    completionAnnouncedRef.current = true;

    const failedSuffix =
      failedCount > 0
        ? ` ${failedCount} post${failedCount === 1 ? "" : "s"} failed — retry on the task board.`
        : "";
    const content =
      readyForApprovalCount === sortedTasks.length
        ? `All done — ${readyForApprovalCount} post${readyForApprovalCount === 1 ? " is" : "s are"} ready for your review. Open Approvals to review captions and graphics.${failedSuffix}`
        : `${readyForApprovalCount} post${readyForApprovalCount === 1 ? " is" : "s are"} ready for your review.${failedSuffix}`;

    setMessages((m) =>
      appendMessageIfNew(m, {
        id: crypto.randomUUID(),
        conversationId,
        role: "assistant",
        content,
        meta: { type: "pipeline_complete" },
        createdAt: new Date(),
      } as Message)
    );
  }, [showCompletionMessage, readyForApprovalCount, failedCount, sortedTasks.length, conversationId]);

  useEffect(() => {
    if (allPostsFinished) {
      clearAgentActivity();
    }
  }, [allPostsFinished, clearAgentActivity]);

  const showStopButton =
    loading ||
    stopping ||
    pipelineBusy ||
    Boolean(agentActivity) ||
    (!pipelinePaused && (activeInProgressCount > 0 || Boolean(activeImageRequestTaskId)));
  const showBackgroundRow =
    !isPlanning && !pipelinePaused && activeInProgressCount > 0 && Boolean(activeImageRequestTaskId);

  const showPlanningRow = isPlanning && !streamingAssistantPlaceholder;
  const showPipelineRow =
    !isPlanning &&
    !activeImageRequestTaskId &&
    chatStatus != null &&
    (chatStatus.tone === "working" || (chatStatus.tone === "waiting" && !hasPendingCard));

  return (
    <div className={`flex justify-center h-full ${PAGE_PADDING} gap-6`}>
      <div className="flex-1 max-w-[820px] min-w-0 flex flex-col">
        <div className={`${GLASS_CARD} flex-1 flex flex-col min-h-0 overflow-hidden`}>
          <div className="flex-1 overflow-auto px-7 py-6 flex flex-col gap-4">
            {displayMessages.length === 0 && !isPlanning && (
              <p className="text-sm text-slate-500 text-center py-8">
                Tell the agent what to create — paste a URL, list products, or drop images.
              </p>
            )}

            {displayMessages.map((m) => {
              const meta = messageMeta(m);
              const linkedTask = meta?.taskId
                ? tasks.find((t) => t.id === meta.taskId)
                : undefined;
              const isImageRequest = meta?.type === "image_request";
              const isAgentQuestion = meta?.type === "agent_question";
              const isBrandKitQuestion = meta?.type === "brand_kit_question";
              const replyImages = meta?.imageIds?.length;
              const cardActive = Boolean(
                pendingTask &&
                  meta?.taskId === pendingTask.id &&
                  pendingTask.status === "NEEDS_INFO"
              );

              if (isImageRequest && meta?.taskId === visibleImageRequestTaskId) {
                const postTitle = meta.postTitle ?? linkedTask?.title ?? "Post";
                const productName = meta.productName ?? linkedTask?.subject ?? "Product";
                const orderIndex = meta.orderIndex ?? linkedTask?.orderIndex ?? 0;

                return (
                  <div key={m.id} className="flex gap-3 animate-blfade">
                    <div className="w-[30px] h-[30px] rounded-[10px] flex-none flex items-center justify-center text-[13px] font-bold text-white bg-gradient-to-br from-orange-500 to-amber-600">
                      📷
                    </div>
                    <PostImageRequestCard
                      projectId={projectId}
                      conversationId={conversationId}
                      taskId={meta.taskId}
                      postTitle={postTitle}
                      productName={productName}
                      orderIndex={orderIndex}
                      active={Boolean(cardActive)}
                      onResponded={onImageCardResponded}
                    />
                  </div>
                );
              }

              if (isBrandKitQuestion && meta?.field) {
                const question = meta.pendingQuestion ?? m.content;
                const active =
                  pendingBrandKitQuestion?.field === meta.field &&
                  !pendingTask;
                return (
                  <div key={m.id} className="flex gap-3 animate-blfade">
                    <div className="w-[30px] h-[30px] rounded-[10px] flex-none flex items-center justify-center text-[13px] font-bold text-white bg-gradient-to-br from-violet-500 to-indigo-600">
                      ✦
                    </div>
                    <BrandKitQuestionCard
                      projectId={projectId}
                      conversationId={conversationId}
                      field={meta.field}
                      question={question}
                      allowSkip={meta.allowSkip === true}
                      active={active}
                      onResponded={onQuestionCardResponded}
                    />
                  </div>
                );
              }

              if (isAgentQuestion && shouldShowAgentQuestionCard(linkedTask, pendingTask)) {
                const question =
                  meta?.pendingQuestion ?? linkedTask!.pendingQuestion ?? m.content;
                return (
                  <div key={m.id} className="flex gap-3 animate-blfade">
                    <div className="w-[30px] h-[30px] rounded-[10px] flex-none flex items-center justify-center text-[13px] font-bold text-white bg-gradient-to-br from-orange-500 to-amber-600">
                      ?
                    </div>
                    <AgentQuestionCard
                      projectId={projectId}
                      conversationId={conversationId}
                      task={linkedTask!}
                      question={question}
                      active={Boolean(cardActive)}
                      onResponded={onQuestionCardResponded}
                    />
                  </div>
                );
              }

              return (
                <div
                  key={m.id}
                  className={`flex gap-3 animate-blfade ${m.role === "user" ? "flex-row-reverse" : ""}`}
                >
                  <div
                    className={`w-[30px] h-[30px] rounded-[10px] flex-none flex items-center justify-center text-[13px] font-bold text-white ${
                      m.role === "user"
                        ? "bg-gradient-to-br from-amber-500 to-red-500"
                        : "bg-gradient-to-br from-blue-500 to-indigo-500"
                    }`}
                  >
                    {m.role === "user" ? "RC" : "✦"}
                  </div>
                  <div
                    className={`max-w-[74%] px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                      m.role === "user"
                        ? "bg-blue-500/10 border border-blue-500/20"
                        : "bg-white/85 border border-white/90"
                    }`}
                  >
                    {m.role === "assistant" && !m.content.trim() && isPlanning ? (
                      <div className="flex items-center gap-2.5 text-slate-600">
                        <span
                          className="inline-block w-4 h-4 flex-none rounded-full border-2 border-indigo-400/30 border-t-indigo-600 animate-spin"
                          aria-hidden
                        />
                        <span>{planningLabel}</span>
                      </div>
                    ) : (
                      m.content
                    )}
                    {replyImages ? (
                      <div className="mt-2 text-[11px] text-slate-500">
                        📎 {meta!.imageIds!.length} image
                        {meta!.imageIds!.length === 1 ? "" : "s"} attached
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}

            {showPlanningRow ? (
              <ChatAgentActivityRow label={planningLabel} tone="planning" />
            ) : null}

            {showBackgroundRow ? (
              <ChatAgentActivityRow
                label={`${inProgressCount} post${inProgressCount === 1 ? "" : "s"} being created in parallel`}
                detail="Submit photos for the remaining posts below — each post starts as soon as you upload"
                tone="working"
              />
            ) : null}

            {showPipelineRow && chatStatus ? (
              <ChatAgentActivityRow
                label={chatStatus.label}
                detail={chatStatus.detail}
                tone={chatStatus.tone}
                spinning={chatStatus.spinning !== false}
              />
            ) : null}

            {sortedTasks.length > 0 && pipelineActive && (
              <div className="animate-blfade flex flex-wrap items-center gap-2">
                <Link
                  href={`/project/${projectId}/board`}
                  className="inline-flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-[13px] font-semibold text-green-800 bg-green-500/12 border border-green-500/25 hover:bg-green-500/18 transition-colors"
                >
                  {!pipelinePaused && activeInProgressCount > 0 ? (
                    <span
                      className="inline-block w-3.5 h-3.5 rounded-full border-2 border-green-500 border-t-transparent animate-spin"
                      aria-hidden
                    />
                  ) : null}
                  View live task board →
                </Link>
                {inProgressCount > 0 || pipelinePaused ? (
                  pipelinePaused ? (
                    <button
                      type="button"
                      onClick={resumePipeline}
                      disabled={pipelineBusy}
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold text-green-800 bg-green-500/12 border border-green-500/25 hover:bg-green-500/18 disabled:opacity-50 transition-colors"
                    >
                      {pipelineBusy ? "Resuming…" : "▶ Resume work"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={pausePipeline}
                      disabled={pipelineBusy}
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold text-slate-700 bg-slate-200/80 border border-slate-300/70 hover:bg-slate-300/80 disabled:opacity-50 transition-colors"
                    >
                      {pipelineBusy ? "Pausing…" : "⏸ Pause work"}
                    </button>
                  )
                ) : null}
              </div>
            )}

            {pipelinePaused && (
              <div className="animate-blfade px-4 py-2.5 rounded-xl text-[12px] text-amber-900 bg-amber-500/12 border border-amber-500/25">
                Work is stopped. Tap <span className="font-semibold">Resume work</span> to continue, or
                use <span className="font-semibold">New brief</span> in the sidebar to start fresh.
              </div>
            )}

            {showCompletionMessage && (
              <div className="animate-blfade flex flex-wrap items-center gap-2">
                <Link
                  href={`/project/${projectId}/approve`}
                  className="inline-flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-[13px] font-semibold text-green-800 bg-green-500/12 border border-green-500/25 hover:bg-green-500/18 transition-colors"
                >
                  Review {readyForApprovalCount} post{readyForApprovalCount === 1 ? "" : "s"} in Approvals →
                </Link>
              </div>
            )}

          </div>
          <div className="flex-none p-4 border-t border-white/70">
            {pendingTask &&
              pendingTask.status === "NEEDS_INFO" &&
              !displayMessages.some((msg) => {
                const msgMeta = messageMeta(msg);
                return (
                  (msgMeta?.type === "image_request" || msgMeta?.type === "agent_question") &&
                  msgMeta.taskId === pendingTask.id
                );
              }) && (
                <div className="mb-3 px-3 py-2 rounded-xl text-[12px] leading-snug text-amber-900 bg-amber-500/15 border border-amber-500/25">
                  <span className="font-semibold">Waiting on you:</span> {pendingTask.title}
                  {pendingTask.pendingQuestion ? (
                    <span className="block mt-0.5 text-amber-800/80">{pendingTask.pendingQuestion}</span>
                  ) : null}
                  <span className="block mt-1 text-[11px] text-amber-800/70">
                    {pendingTaskReplyHint(pendingTask)}
                  </span>
                </div>
              )}
            {messageQueue.length > 0 && (
              <div className="mb-2 flex flex-col gap-1.5">
                {messageQueue.map((item, index) => (
                  <div
                    key={item.id}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-[11px] text-violet-800 bg-violet-500/10 border border-violet-500/20"
                  >
                    <span className="flex-1 truncate">
                      {index + 1} message queued — sends when agent finishes
                      {item.text ? `: ${item.text.slice(0, 60)}${item.text.length > 60 ? "…" : ""}` : ""}
                      {item.imageIds.length ? ` (${item.imageIds.length} attachment${item.imageIds.length === 1 ? "" : "s"})` : ""}
                    </span>
                    <button
                      type="button"
                      className="text-violet-500 hover:text-violet-800 shrink-0"
                      onClick={() => removeQueuedMessage(item.id)}
                      aria-label="Remove queued message"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            {queueError && (
              <p className="mb-2 text-[11px] text-red-700">{queueError}</p>
            )}
            {imageIds.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {imageIds.map((id) => (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-medium text-violet-700 bg-violet-500/10 border border-violet-500/20"
                  >
                    📎 {pendingTask ? "Photo attached" : "Logo attached"}
                    <button
                      type="button"
                      className="text-violet-500 hover:text-violet-800"
                      onClick={() => setImageIds((ids) => ids.filter((x) => x !== id))}
                      aria-label="Remove attachment"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2.5 px-2 py-2 pl-4 rounded-2xl bg-white/70 border border-white/90">
              <label className="w-[30px] h-[30px] rounded-[9px] flex items-center justify-center text-base text-slate-400 bg-white/80 border border-black/5 cursor-pointer">
                +
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
                />
              </label>
              <input
                className="flex-1 text-sm bg-transparent outline-none placeholder:text-slate-400"
                placeholder={
                  chatBusy
                    ? "Type now — message queues until agent finishes…"
                    : pendingTask
                      ? pendingTaskReplyHint(pendingTask).replace(/^Reply here, /, "")
                      : "Message the agent, paste a URL, or attach your logo…"
                }
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    enqueueOrSend();
                  }
                }}
              />
              {showStopButton && (
                <button
                  type="button"
                  onClick={() => void stopAllWork()}
                  disabled={stopping || pipelineBusy}
                  aria-label="Stop agent and post generation"
                  title="Stop all work"
                  className="h-[34px] px-3 rounded-[10px] flex items-center justify-center gap-1.5 text-[12px] font-semibold text-red-800 bg-red-500/15 border border-red-500/30 hover:bg-red-500/25 disabled:opacity-60 transition-colors"
                >
                  <span className="inline-block w-2.5 h-2.5 bg-red-600 rounded-[2px]" aria-hidden />
                  {stopping || pipelineBusy ? "Stopping…" : "Stop"}
                </button>
              )}
              <button
                type="button"
                onClick={enqueueOrSend}
                disabled={uploading}
                aria-label={chatBusy ? "Queue message" : "Send message"}
                title={chatBusy ? "Queue message" : "Send message"}
                className="w-[34px] h-[34px] rounded-[10px] flex items-center justify-center text-white bg-gradient-to-br from-violet-500 to-violet-800 shadow-[0_5px_14px_rgba(124,58,237,0.4)] disabled:opacity-50"
              >
                {chatBusy ? "⏳" : "↑"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
