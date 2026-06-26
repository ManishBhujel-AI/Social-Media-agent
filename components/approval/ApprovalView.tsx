"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Generation, Task } from "@prisma/client";
import { GLASS_CARD, PAGE_PADDING } from "@/lib/design/tokens";
import { PostThumbnail } from "@/components/posts/PostThumbnail";
import { useProjectStream } from "@/hooks/useProjectStream";
import { MAX_FEEDBACK_REFERENCE_IMAGES } from "@/lib/ai/imageRefs.config";

type TaskFull = Task & {
  generations: Generation[];
  captionRevisions: { caption: string; feedback: string | null }[];
};

function ImageAttachIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={className}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 19.5h16.5A1.5 1.5 0 0 0 21.75 18V6A1.5 1.5 0 0 0 20.25 4.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"
      />
    </svg>
  );
}

export function ApprovalView({ projectId, tasks: initialTasks }: { projectId: string; tasks: TaskFull[] }) {
  const [tasks, setTasks] = useState(initialTasks);
  const [revisingIds, setRevisingIds] = useState<Set<string>>(() => new Set());
  const projectIdRef = useRef(projectId);

  useEffect(() => {
    if (projectIdRef.current !== projectId) {
      projectIdRef.current = projectId;
      setTasks(initialTasks);
      setRevisingIds(new Set());
    }
  }, [projectId, initialTasks]);

  const markRevising = useCallback((taskId: string) => {
    setRevisingIds((prev) => new Set(prev).add(taskId));
  }, []);

  const refreshTasks = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/approval-tasks?_=${Date.now()}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as TaskFull[];
      setTasks(data);
      setRevisingIds((prev) => {
        const next = new Set(prev);
        for (const task of data) {
          if (task.status === "NEEDS_APPROVAL") next.delete(task.id);
        }
        return next;
      });
    } catch {
      /* ignore */
    }
  }, [projectId]);

  const onTaskEvent = useCallback(() => {
    void refreshTasks();
  }, [refreshTasks]);

  useProjectStream(projectId, { onTaskEvent });

  const awaitingRevision =
    tasks.some((t) => t.status === "CHANGES_REQUESTED") || revisingIds.size > 0;

  useEffect(() => {
    if (!awaitingRevision) return;
    void refreshTasks();
    const id = window.setInterval(() => void refreshTasks(), 1500);
    return () => window.clearInterval(id);
  }, [awaitingRevision, refreshTasks]);

  if (!tasks.length) {
    return (
      <div className={`${PAGE_PADDING} flex flex-col items-center justify-center min-h-[50vh] text-center`}>
        <div className="text-[15px] font-semibold text-slate-700">Nothing to approve yet</div>
        <p className="mt-2 text-sm text-slate-500 max-w-md">
          Posts land here when they&apos;re ready for your review. Check the task board for progress.
        </p>
      </div>
    );
  }

  return (
    <div className={`${PAGE_PADDING} grid gap-5 max-w-[1100px]`}>
      {tasks.map((task) => (
        <ApprovalCard
          key={task.id}
          projectId={projectId}
          task={task}
          onTasksChanged={refreshTasks}
          onRevisionStarted={markRevising}
        />
      ))}
    </div>
  );
}

function ApprovalCard({
  projectId,
  task,
  onTasksChanged,
  onRevisionStarted,
}: {
  projectId: string;
  task: TaskFull;
  onTasksChanged: () => Promise<void>;
  onRevisionStarted: (taskId: string) => void;
}) {
  const router = useRouter();
  const [captionMode, setCaptionMode] = useState(false);
  const [graphicMode, setGraphicMode] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [referenceImageIds, setReferenceImageIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedNotice, setSubmittedNotice] = useState<string | null>(null);
  const [updatedNotice, setUpdatedNotice] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState(task.generations.length - 1);
  const prevStatusRef = useRef(task.status);

  const isRevising = task.status === "CHANGES_REQUESTED";

  useEffect(() => {
    const wasRevising = prevStatusRef.current === "CHANGES_REQUESTED";
    prevStatusRef.current = task.status;

    if (task.status === "NEEDS_APPROVAL" && wasRevising) {
      setSubmittedNotice(null);
      setUpdatedNotice(true);
    }

    setSelectedVersion(Math.max(0, task.generations.length - 1));
  }, [task.status, task.generations, task.caption, task.id]);

  const gens = task.generations;
  const current = gens[selectedVersion] ?? gens[gens.length - 1];
  const latestNote = gens.find((g) => g.agentNote)?.agentNote;
  const canSend =
    !submitting &&
    !uploading &&
    (feedback.trim().length > 0 || (graphicMode && referenceImageIds.length > 0));

  const closeFeedback = () => {
    setCaptionMode(false);
    setGraphicMode(false);
    setReferenceImageIds([]);
    setError(null);
  };

  const onUploadReference = async (files: FileList | File[]) => {
    if (uploading || submitting) return;
    const room = MAX_FEEDBACK_REFERENCE_IMAGES - referenceImageIds.length;
    if (room <= 0) {
      setError(`You can attach up to ${MAX_FEEDBACK_REFERENCE_IMAGES} images.`);
      return;
    }
    const toUpload = Array.from(files).slice(0, room);
    if (!toUpload.length) return;

    setUploading(true);
    setError(null);
    const newIds: string[] = [];
    try {
      for (const file of toUpload) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("projectId", projectId);
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        const data = (await res.json()) as { imageId?: string; error?: string };
        if (!res.ok || !data.imageId) {
          setError(data.error ?? "Could not upload image.");
          break;
        }
        newIds.push(data.imageId);
      }
      if (newIds.length) {
        setReferenceImageIds((prev) =>
          [...prev, ...newIds].slice(0, MAX_FEEDBACK_REFERENCE_IMAGES)
        );
      }
    } catch {
      setError("Could not upload image.");
    } finally {
      setUploading(false);
    }
  };

  const removeReference = (imageId: string) => {
    setReferenceImageIds((prev) => prev.filter((id) => id !== imageId));
  };

  const submitFeedback = async (target: "caption" | "image") => {
    const trimmed = feedback.trim();
    const hasReference = target === "image" && referenceImageIds.length > 0;
    if ((!trimmed && !hasReference) || submitting) return;

    if (target === "image" && !current?.generationId) {
      setError("No graphic version is available to edit yet.");
      return;
    }

    const feedbackText =
      trimmed ||
      (hasReference
        ? referenceImageIds.length > 1
          ? `Incorporate the ${referenceImageIds.length} attached reference images into this graphic.`
          : "Incorporate the attached reference image into this graphic."
        : "");

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: task.id,
          generationId: current?.generationId,
          feedback: feedbackText,
          target,
          referenceImageIds: hasReference ? referenceImageIds : undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not send feedback. Please try again.");
        return;
      }

      setFeedback("");
      setReferenceImageIds([]);
      setSubmittedNotice(
        target === "image"
          ? "Graphic feedback submitted — agent is revising your graphic."
          : "Caption feedback submitted — agent is updating your caption."
      );
      onRevisionStarted(task.id);
      closeFeedback();
      await onTasksChanged();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const approve = async () => {
    await fetch("/api/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: task.id }),
    });
    router.refresh();
  };

  return (
    <div className={`${GLASS_CARD} overflow-hidden animate-blfade`}>
      <div className="flex items-stretch min-h-0">
        <div className="w-[46%] flex-none p-4 flex flex-col justify-center">
          <div className="w-full aspect-square relative">
            <PostThumbnail
              seed={task.orderIndex}
              height="100%"
              label={current ? `graphic v${selectedVersion + 1}` : undefined}
              imageUrl={current?.imagePath}
              imageKey={current?.generationId ?? current?.id}
            />
          </div>
          {gens.length > 1 && (
            <div className="mt-2 flex gap-1.5">
              {gens.map((g, i) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setSelectedVersion(i)}
                  className={`flex-1 py-1.5 rounded-[9px] text-[11px] font-semibold text-center ${
                    i === selectedVersion
                      ? "text-blue-600 bg-blue-500/12 border border-blue-500/25"
                      : "text-slate-400 bg-white/60 border border-white/85"
                  }`}
                >
                  v{i + 1}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0 min-h-0 py-4 pr-4 pl-1 flex flex-col">
          <div className="flex justify-between gap-2 flex-none">
            <div className="text-[15px] font-bold">{task.title}</div>
            <span className="text-[11px] font-semibold text-slate-400">Post {task.orderIndex + 1}</span>
          </div>
          <div className="mt-2.5 flex-1 min-h-0 overflow-y-auto text-[13px] leading-relaxed text-slate-700 whitespace-pre-wrap pr-1">
            {task.caption ?? "Caption pending…"}
          </div>
          {latestNote && (
            <div className="my-2 flex-none px-3 py-2.5 rounded-xl text-xs leading-relaxed text-green-700 bg-green-500/10 border border-green-500/20">
              <strong>✦ Agent: </strong>
              {latestNote}
            </div>
          )}
          {(captionMode || graphicMode) ? (
            <div className="flex-none relative z-10 mt-3 flex flex-col gap-2.5 animate-blfade">
              <div className="p-3 rounded-[13px] bg-white/70 border border-white/90">
                <div className="text-xs text-slate-400 mb-1.5">
                  {graphicMode ? "Small tweak, or a different graphic?" : "What should change in the caption?"}
                </div>
                <div className="relative">
                  <textarea
                    className={`w-full text-sm text-slate-600 min-h-[52px] max-h-[140px] bg-transparent outline-none resize-y ${
                      graphicMode ? "pb-9" : ""
                    }`}
                    value={feedback}
                    onChange={(e) => {
                      setFeedback(e.target.value);
                      if (error) setError(null);
                    }}
                    placeholder={
                      graphicMode
                        ? "Describe the change — e.g. add these logos to the graphic…"
                        : "Describe the change…"
                    }
                    disabled={submitting}
                    autoFocus
                  />
                  {graphicMode ? (
                    <div className="absolute left-0 bottom-0 right-0 flex flex-wrap items-center gap-1.5">
                      <label
                        title={`Attach reference images (up to ${MAX_FEEDBACK_REFERENCE_IMAGES})`}
                        className={`flex items-center justify-center flex-none transition-opacity ${
                          !submitting &&
                          !uploading &&
                          referenceImageIds.length < MAX_FEEDBACK_REFERENCE_IMAGES
                            ? "text-neutral-900 hover:opacity-70 cursor-pointer"
                            : "text-neutral-300 cursor-not-allowed"
                        }`}
                      >
                        {uploading ? (
                          <span className="text-[11px] font-medium">…</span>
                        ) : (
                          <ImageAttachIcon />
                        )}
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          className="hidden"
                          disabled={
                            submitting ||
                            uploading ||
                            referenceImageIds.length >= MAX_FEEDBACK_REFERENCE_IMAGES
                          }
                          onChange={(e) => {
                            const files = e.target.files;
                            if (files?.length) void onUploadReference(files);
                            e.target.value = "";
                          }}
                        />
                      </label>
                      {referenceImageIds.length > 0 ? (
                        <>
                          {referenceImageIds.map((id, i) => (
                            <span
                              key={id}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium text-neutral-700 bg-neutral-100"
                            >
                              <ImageAttachIcon className="w-3.5 h-3.5" />
                              {referenceImageIds.length > 1 ? `#${i + 1}` : "Attached"}
                              <button
                                type="button"
                                disabled={submitting || uploading}
                                onClick={() => removeReference(id)}
                                className="text-neutral-500 hover:text-neutral-900 disabled:opacity-50"
                                aria-label={`Remove reference image ${i + 1}`}
                              >
                                ×
                              </button>
                            </span>
                          ))}
                          {referenceImageIds.length < MAX_FEEDBACK_REFERENCE_IMAGES ? (
                            <span className="text-[10px] text-neutral-400">
                              {referenceImageIds.length}/{MAX_FEEDBACK_REFERENCE_IMAGES}
                            </span>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
              {error ? (
                <div className="px-3 py-2 rounded-xl text-[12px] text-red-700 bg-red-500/10 border border-red-500/20">
                  {error}
                </div>
              ) : null}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => submitFeedback(captionMode ? "caption" : "image")}
                  disabled={!canSend}
                  className="px-4 py-2 rounded-[11px] text-[13px] font-semibold text-white cursor-pointer bg-gradient-to-br from-violet-600 to-indigo-500 disabled:opacity-45 disabled:cursor-not-allowed hover:from-violet-700 hover:to-indigo-600 transition-colors"
                >
                  {submitting ? "Sending…" : "Send to agent"}
                </button>
                <button
                  type="button"
                  onClick={closeFeedback}
                  disabled={submitting}
                  className="px-4 py-2 rounded-[11px] text-[13px] font-semibold text-slate-500 cursor-pointer bg-white/60 border border-white/85 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : isRevising || submittedNotice ? (
            <div className="flex-none relative z-10 mt-3 animate-blfade">
              <div className="px-3 py-2.5 rounded-xl text-[12px] text-violet-800 bg-violet-500/10 border border-violet-500/25 flex items-center gap-2.5">
                <span
                  className="inline-block w-3.5 h-3.5 flex-none rounded-full border-2 border-violet-500/30 border-t-violet-600 animate-spin"
                  aria-hidden
                />
                <span className="font-medium leading-snug">
                  {submittedNotice ?? "Feedback submitted — agent is updating this post…"}
                </span>
              </div>
            </div>
          ) : (
            <>
              {updatedNotice ? (
                <div className="flex-none relative z-10 mt-3 animate-blfade">
                  <div className="px-3 py-2.5 rounded-xl text-[12px] text-green-800 bg-green-500/10 border border-green-500/25 flex items-center gap-2.5">
                    <span className="font-medium leading-snug">
                      Updated — review the new version below.
                    </span>
                    <button
                      type="button"
                      onClick={() => setUpdatedNotice(false)}
                      className="ml-auto text-green-700 hover:text-green-900 font-semibold"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ) : null}
              <div className="flex-none relative z-10 flex flex-wrap gap-2 mt-3">
              <button
                type="button"
                onClick={approve}
                className="flex-1 min-w-[120px] text-center px-4 py-2.5 rounded-[11px] text-[13px] font-semibold text-white cursor-pointer bg-gradient-to-br from-green-500 to-green-600 shadow-[0_5px_14px_rgba(34,197,94,0.32)]"
              >
                ✓ Approve
              </button>
              <button
                type="button"
                onClick={() => {
                  setCaptionMode(true);
                  setGraphicMode(false);
                  setError(null);
                }}
                className="px-4 py-2.5 rounded-[11px] text-[13px] font-semibold text-slate-600 cursor-pointer bg-white/60 border border-white/85"
              >
                Edit caption
              </button>
              <button
                type="button"
                onClick={() => {
                  setGraphicMode(true);
                  setCaptionMode(false);
                  setError(null);
                }}
                className="px-4 py-2.5 rounded-[11px] text-[13px] font-semibold text-slate-600 cursor-pointer bg-white/60 border border-white/85"
              >
                Edit graphic
              </button>
            </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
