"use client";

import { useState, useCallback } from "react";
import { GLASS_CARD } from "@/lib/design/tokens";
import { PostThumbnail } from "@/components/posts/PostThumbnail";
import { MAX_POST_SOURCE_IMAGES } from "@/lib/ai/imageRefs.config";

export type PhotoCardDraft = {
  attachedImageIds: string[];
  contextImageId: string | null;
  productNotes: string;
};

const EMPTY_DRAFT: PhotoCardDraft = {
  attachedImageIds: [],
  contextImageId: null,
  productNotes: "",
};

export function PostImageRequestCard({
  projectId,
  conversationId,
  taskId,
  postTitle,
  productName,
  orderIndex,
  active,
  draft,
  onDraftChange,
  onResponded,
}: {
  projectId: string;
  conversationId: string;
  taskId: string;
  postTitle: string;
  productName: string;
  orderIndex: number;
  active: boolean;
  draft?: PhotoCardDraft;
  onDraftChange?: (draft: PhotoCardDraft) => void;
  onResponded?: (ackMessage?: string, taskId?: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadingContext, setUploadingContext] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [localDraft, setLocalDraft] = useState<PhotoCardDraft>(EMPTY_DRAFT);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const cardDraft = draft ?? localDraft;
  const { attachedImageIds, contextImageId, productNotes } = cardDraft;

  const updateDraft = useCallback(
    (patch: Partial<PhotoCardDraft>) => {
      const next = { ...cardDraft, ...patch };
      if (onDraftChange) {
        onDraftChange(next);
      } else {
        setLocalDraft(next);
      }
    },
    [cardDraft, onDraftChange]
  );

  const respond = useCallback(
    async (body: {
      message?: string;
      imageIds?: string[];
      productNotes?: string;
      contextImageId?: string;
    }) => {
      if (!active || submitting) return;

      const photoCount = body.imageIds?.length ?? 0;
      const notes = body.productNotes?.trim();
      const optimisticAck = photoCount
        ? `Got it — creating this post with ${photoCount} photo${photoCount === 1 ? "" : "s"} in the background.${notes ? " I'll use your notes for this post." : ""}`
        : notes
          ? `Got it — designing this post from scratch. I'll use your notes.`
          : `Got it — designing this post from scratch.`;

      setSubmitting(true);
      setUploadError(null);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            conversationId,
            taskId,
            message: body.message ?? "",
            imageIds: body.imageIds,
            productNotes: body.productNotes,
            contextImageId: body.contextImageId,
          }),
        });
        const contentType = res.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
          const data = (await res.json()) as {
            mode?: string;
            message?: string;
            error?: string;
          };
          if (data.error) {
            onResponded?.(data.error, taskId);
            setUploadError(data.error);
            return;
          }
          onResponded?.(
            data.mode === "resume" && data.message?.trim()
              ? data.message.trim()
              : optimisticAck,
            taskId
          );
          return;
        }
        if (!res.ok) {
          onResponded?.("Could not submit — try again.", taskId);
          setUploadError("Could not submit — try again.");
          return;
        }
        onResponded?.(optimisticAck, taskId);
      } catch {
        onResponded?.("Could not submit — try again.", taskId);
        setUploadError("Could not submit — try again.");
      } finally {
        setSubmitting(false);
      }
    },
    [active, submitting, projectId, conversationId, taskId, onResponded]
  );

  const uploadFile = async (file: File): Promise<string | null> => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("projectId", projectId);
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    const data = (await res.json()) as { imageId?: string; error?: string };
    if (!res.ok || !data.imageId) {
      setUploadError(data.error ?? "Could not upload image.");
      return null;
    }
    return data.imageId;
  };

  const onUpload = async (files: FileList | File[]) => {
    if (!active || uploading || submitting) return;
    const room = MAX_POST_SOURCE_IMAGES - attachedImageIds.length;
    if (room <= 0) {
      setUploadError(`You can attach up to ${MAX_POST_SOURCE_IMAGES} photos.`);
      return;
    }

    const toUpload = Array.from(files).slice(0, room);
    if (!toUpload.length) return;

    setUploading(true);
    setUploadError(null);
    const newIds: string[] = [];
    try {
      for (const file of toUpload) {
        const imageId = await uploadFile(file);
        if (!imageId) break;
        newIds.push(imageId);
      }
      if (newIds.length) {
        updateDraft({
          attachedImageIds: [...attachedImageIds, ...newIds].slice(0, MAX_POST_SOURCE_IMAGES),
        });
      }
    } catch {
      setUploadError("Could not upload image.");
    } finally {
      setUploading(false);
    }
  };

  const onContextImageUpload = async (file: File) => {
    if (!active || uploadingContext || submitting) return;
    setUploadingContext(true);
    setUploadError(null);
    try {
      const imageId = await uploadFile(file);
      if (imageId) updateDraft({ contextImageId: imageId });
    } catch {
      setUploadError("Could not upload info image.");
    } finally {
      setUploadingContext(false);
    }
  };

  const removeImage = (imageId: string) => {
    updateDraft({
      attachedImageIds: attachedImageIds.filter((id) => id !== imageId),
    });
    setUploadError(null);
  };

  const onSubmit = () => {
    const notes = productNotes.trim();
    const payload = {
      productNotes: notes || undefined,
      contextImageId: contextImageId ?? undefined,
    };

    if (attachedImageIds.length) {
      void respond({ ...payload, imageIds: attachedImageIds });
    } else {
      void respond({ ...payload, message: "generate" });
    }
  };

  const busy = uploading || uploadingContext || submitting;
  const atLimit = attachedImageIds.length >= MAX_POST_SOURCE_IMAGES;

  return (
    <div
      className={`${GLASS_CARD} max-w-[420px] overflow-hidden ${
        active ? "ring-2 ring-amber-400/40" : "opacity-75"
      }`}
    >
      <div className="px-4 py-3 border-b border-white/70 bg-amber-500/8">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">
          Post {orderIndex + 1} · Photos needed
        </div>
        <div className="text-[15px] font-bold text-slate-800 mt-0.5 leading-snug">{postTitle}</div>
        <div className="text-[12px] text-slate-500 mt-0.5">{productName}</div>
      </div>

      <div className="p-4 flex flex-col gap-3">
        <p className="text-sm text-slate-600 leading-relaxed">
          Upload photos for <span className="font-semibold text-slate-800">{productName}</span> — all
          attached images will be used when designing the graphic. Or submit without photos and
          I&apos;ll design from scratch.
        </p>

        <label
          className={`flex flex-col items-center justify-center gap-2 px-4 py-6 rounded-2xl border-2 border-dashed transition-colors ${
            active && !busy && !atLimit
              ? "border-amber-400/50 bg-white/50 hover:bg-white/70 cursor-pointer"
              : "border-slate-200/80 bg-white/30 cursor-not-allowed"
          }`}
        >
          <div className="w-12 h-12 rounded-xl overflow-hidden opacity-80">
            <PostThumbnail seed={orderIndex} height="48px" label={null} />
          </div>
          <span className="text-[13px] font-semibold text-slate-700">
            {uploading
              ? "Uploading…"
              : attachedImageIds.length
                ? `Add more photos (${attachedImageIds.length}/${MAX_POST_SOURCE_IMAGES})`
                : "Drop or click to upload photos"}
          </span>
          <span className="text-[11px] text-slate-400">
            Up to {MAX_POST_SOURCE_IMAGES} images · product photos only
          </span>
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            disabled={!active || busy || atLimit}
            onChange={(e) => {
              const files = e.target.files;
              if (files?.length) void onUpload(files);
              e.target.value = "";
            }}
          />
        </label>

        {attachedImageIds.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {attachedImageIds.map((id, i) => (
              <div
                key={id}
                className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-[12px] text-green-800 bg-green-500/10 border border-green-500/20"
              >
                <span className="font-medium">Photo {i + 1} attached</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => removeImage(id)}
                  className="text-green-700 hover:text-green-900 font-semibold disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="pt-1 border-t border-slate-200/60 flex flex-col gap-2">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Additional info (optional)
          </label>
          <textarea
            className="w-full min-h-[72px] px-3 py-2 rounded-xl text-[13px] text-slate-800 bg-white/70 border border-slate-200/80 resize-y outline-none focus:ring-2 focus:ring-violet-400/30 placeholder:text-slate-400"
            placeholder="Offers, who it's for, specs, or anything that helps write this post…"
            value={productNotes}
            disabled={!active || busy}
            onChange={(e) => updateDraft({ productNotes: e.target.value })}
          />
          <div className="flex items-center gap-2">
            <label
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-colors ${
                active && !busy && !contextImageId
                  ? "text-slate-600 bg-white/70 border-slate-200/80 cursor-pointer hover:bg-white"
                  : "text-slate-400 bg-white/40 border-slate-200/50 cursor-not-allowed"
              }`}
            >
              {uploadingContext ? "Uploading…" : contextImageId ? "Info image attached" : "+ Info image"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={!active || busy || Boolean(contextImageId)}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void onContextImageUpload(file);
                  e.target.value = "";
                }}
              />
            </label>
            {contextImageId ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => updateDraft({ contextImageId: null })}
                className="text-[11px] text-slate-500 hover:text-slate-800 disabled:opacity-50"
              >
                Remove info image
              </button>
            ) : (
              <span className="text-[10px] text-slate-400">Brochure, label, or spec sheet — facts only</span>
            )}
          </div>
        </div>

        {uploadError ? (
          <div className="px-3 py-2 rounded-xl text-[12px] text-red-800 bg-red-500/10 border border-red-500/20">
            {uploadError}
          </div>
        ) : null}

        <button
          type="button"
          disabled={!active || busy}
          onClick={onSubmit}
          className="w-full py-2.5 rounded-xl text-[13px] font-semibold text-white bg-gradient-to-br from-violet-600 to-indigo-500 hover:from-violet-700 hover:to-indigo-600 disabled:opacity-50 transition-colors"
        >
          {submitting
            ? "Submitting…"
            : attachedImageIds.length
              ? `Submit ${attachedImageIds.length} photo${attachedImageIds.length === 1 ? "" : "s"}`
              : "Submit without photos"}
        </button>
      </div>
    </div>
  );
}
