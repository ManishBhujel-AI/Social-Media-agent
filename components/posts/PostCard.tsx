"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import type { Task } from "@prisma/client";
import {
  IN_PROGRESS_STATUSES,
  taskStatusToKey,
  taskSubLabel,
} from "@/lib/design/tokens";
import { PostThumbnail, StatusChip } from "./PostThumbnail";
import { ProductResearchPanel } from "./ProductResearchPanel";
import { ImagePromptPanel } from "./ImagePromptPanel";

export function PostCard({
  task,
  compact = false,
  projectId,
}: {
  task: Task & { generations?: { imagePath: string | null; prompt?: string | null }[] };
  compact?: boolean;
  projectId: string;
}) {
  const router = useRouter();
  const key = taskStatusToKey(task.status);
  const inProg = IN_PROGRESS_STATUSES.includes(task.status as (typeof IN_PROGRESS_STATUSES)[number]);
  const needsInfo = task.status === "NEEDS_INFO";
  const sub = taskSubLabel(task.status, {
    statusLabel: task.statusLabel,
    pendingQuestion: task.pendingQuestion,
  });
  const thumb = task.generations?.[0]?.imagePath;
  const imagePrompt = task.generations?.[0]?.prompt ?? task.imagePrompt;
  const hasDeliverable = Boolean(task.caption?.trim() && thumb);
  const showImagePrompt =
    Boolean(imagePrompt?.trim()) &&
    (task.status === "NEEDS_APPROVAL" ||
      task.status === "CHANGES_REQUESTED" ||
      task.status === "APPROVED" ||
      (inProg && Boolean(task.imagePrompt?.trim())));
  const href =
    task.status === "NEEDS_APPROVAL"
      ? `/project/${projectId}/approve`
      : `/project/${projectId}/post/${task.id}`;

  const retry = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await fetch(`/api/tasks/${task.id}/retry`, { method: "POST" });
    router.refresh();
  };

  const activeBorder = inProg
    ? "border-blue-400/40 shadow-[0_10px_26px_rgba(59,130,246,0.22)]"
    : needsInfo
      ? "border-orange-400/40 shadow-[0_10px_26px_rgba(234,88,12,0.18)]"
      : task.status === "FAILED"
        ? "border-red-400/35"
        : "border-white/85 shadow-[0_6px_18px_rgba(30,41,59,0.08)]";

  return (
    <motion.div
      layout
      layoutId={task.id}
      initial={{ opacity: 0, scale: 0.96, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, y: -8 }}
      transition={{ type: "spring", stiffness: 420, damping: 32 }}
    >
      <Link
        href={href}
        className={`block relative rounded-[18px] p-3 cursor-pointer bg-white/60 backdrop-blur-xl backdrop-saturate-150 border animate-blfade ${activeBorder} ${
          compact ? "flex flex-row gap-3" : "flex flex-col"
        }`}
      >
        <div className={`flex-none ${compact ? "w-12 h-12" : "w-full h-[108px]"}`}>
          <PostThumbnail
            seed={task.orderIndex}
            height={compact ? "48px" : "108px"}
            label={compact ? null : task.subject}
            imageUrl={thumb}
          />
        </div>
        <div className={`flex-1 min-w-0 flex flex-col gap-1.5 ${compact ? "" : "px-1 pt-2.5"}`}>
          <div className="text-[13.5px] font-semibold leading-snug line-clamp-2">{task.title}</div>
          {(inProg || needsInfo) && sub ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <div
                  className={`w-3.5 h-3.5 rounded-full border-2 animate-blspin ${
                    needsInfo
                      ? "border-orange-400/25 border-t-orange-500"
                      : "border-blue-400/25 border-t-blue-500"
                  }`}
                />
                <span
                  className={`text-xs font-semibold line-clamp-2 ${
                    needsInfo ? "text-orange-600" : "text-blue-600"
                  }`}
                >
                  {sub}
                </span>
              </div>
              {inProg ? (
                <button
                  type="button"
                  onClick={retry}
                  className="self-start px-3 py-1.5 rounded-[10px] text-xs font-semibold text-blue-700 bg-blue-500/10 border border-blue-500/25"
                >
                  {hasDeliverable ? "↻ Move to approval" : "↻ Retry generation"}
                </button>
              ) : null}
            </div>
          ) : task.status === "FAILED" ? (
            <div className="flex flex-col gap-1.5">
              {sub ? (
                <p className="text-xs leading-snug text-red-600/90 line-clamp-3">{sub}</p>
              ) : null}
              <button
                type="button"
                onClick={retry}
                className="self-start mt-0.5 px-3 py-1.5 rounded-[10px] text-xs font-semibold text-red-600 bg-red-500/10 border border-red-500/25"
              >
                ↻ Retry generation
              </button>
            </div>
          ) : (
            <StatusChip statusKey={key} />
          )}
          {showImagePrompt ? (
            <ImagePromptPanel prompt={imagePrompt} compact={compact} />
          ) : null}
          <ProductResearchPanel productSummary={task.productSummary} compact={compact} />
        </div>
      </Link>
    </motion.div>
  );
}
