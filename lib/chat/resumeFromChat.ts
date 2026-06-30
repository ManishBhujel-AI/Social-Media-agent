import { prisma } from "@/lib/db/prisma";
import { resolveSourceImages } from "@/lib/ai/resolveSourceImages";
import { dispatchPipelineJob } from "@/lib/queue/dispatch";
import { setProjectPipelinePaused } from "@/lib/queue/pipelinePauseFlag";
import { advanceImageCollectionQueue } from "@/lib/queue/pipelineGate";
import { isPreImageRequestState } from "@/lib/ai/agents/postImageRequest";
import { updateTaskFields } from "@/lib/tasks/taskEvents";
import { emitMessageCreated } from "./messageEvents";
import {
  applyUserProductDescription,
  enrichSummaryFromUserImage,
  enrichSummaryFromUserImages,
  finalizeSummary,
  mergeAndPersistUserProductNotes,
  prepareTaskImageSubmit,
} from "@/lib/ai/agents/productAgent";
import { getProductName, hasMarketingReadySummary } from "@/lib/ai/productContext";
import { ingestUserReference } from "@/lib/content/ingestUserReference";

export type ResumeChatResult =
  | { mode: "resume"; taskId: string; message: string }
  | { mode: "planning" }
  | { mode: "error"; message: string };

function isGenerateReply(message: string): boolean {
  return /^(generate|design from scratch|from scratch|no photo|no image|let me design it)\b/i.test(
    message.trim()
  );
}

/** Build the tool-result string the post agent receives after askUser. */
export async function buildResumeToolReply(params: {
  projectId: string;
  taskId: string;
  message: string;
  imageIds?: string[];
  productNotes?: string;
  contextImageId?: string;
}): Promise<string> {
  const { projectId, taskId, message, imageIds, productNotes, contextImageId } = params;
  const trimmed = message.trim();
  const task = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    include: { project: true },
  });
  const productName = getProductName(task);

  const mergedNotes = await mergeAndPersistUserProductNotes({
    projectId,
    taskId,
    productName,
    text: productNotes,
    contextImageId,
  });

  if (imageIds?.length) {
    const urls = await resolveSourceImages(projectId, imageIds);
    if (urls.length) {
      const existing = (task.sourceImages as string[] | null) ?? [];
      const merged = [...existing];
      for (const url of urls) {
        if (!merged.includes(url)) merged.push(url);
      }

      let summary = await enrichSummaryFromUserImages(
        projectId,
        productName,
        merged,
        task.productSummary as Parameters<typeof enrichSummaryFromUserImages>[3]
      );

      summary = await finalizeSummary(taskId, summary, {
        clientUrl: task.project.clientUrl,
        businessSummary: task.businessSummary,
        imageUrl: urls[0],
        projectId: task.projectId,
      });

      await prisma.task.update({
        where: { id: taskId },
        data: {
          sourceImages: merged as object,
          productImageUrl: merged[0] ?? task.productImageUrl,
          productSummary: summary as object,
        },
      });

      if (!hasMarketingReadySummary(summary)) {
        return JSON.stringify({
          choice: "upload",
          message:
            trimmed ||
            (urls.length > 1
              ? `User uploaded ${urls.length} product photos.`
              : "User uploaded a product photo."),
          imageUrls: urls,
          needsDescription: true,
          userNotes: mergedNotes || undefined,
        });
      }

      return JSON.stringify({
        choice: "upload",
        message:
          trimmed ||
          (urls.length > 1
            ? `User uploaded ${urls.length} product photos.`
            : "User uploaded a product photo."),
        imageUrls: urls,
        description: summary.description ?? summary.webResearchNotes,
        userNotes: mergedNotes || undefined,
      });
    }
  }

  if (isGenerateReply(trimmed) || (!imageIds?.length && mergedNotes)) {
    if (mergedNotes) {
      await applyUserProductDescription(taskId, productName, mergedNotes);
    }
    return JSON.stringify({
      choice: "generate",
      message: mergedNotes || trimmed,
      description: mergedNotes || undefined,
    });
  }

  if (trimmed) {
    await applyUserProductDescription(taskId, productName, trimmed);
    return JSON.stringify({
      choice: "description",
      message: trimmed,
      description: trimmed,
    });
  }

  return trimmed || "User replied.";
}

export async function findPausedTaskForProject(projectId: string) {
  return prisma.task.findFirst({
    where: { projectId, status: "NEEDS_INFO" },
    orderBy: { orderIndex: "asc" },
  });
}

export async function routeChatToPausedTask(params: {
  projectId: string;
  conversationId: string;
  message: string;
  imageIds?: string[];
  taskId?: string;
  productNotes?: string;
  contextImageId?: string;
}): Promise<ResumeChatResult> {
  const paused = params.taskId
    ? await prisma.task.findFirst({
        where: {
          id: params.taskId,
          projectId: params.projectId,
          status: "NEEDS_INFO",
        },
      })
    : await findPausedTaskForProject(params.projectId);
  if (!paused) return { mode: "planning" };

  const wasImagePause = isPreImageRequestState(paused.agentState);

  const hasProductPhotos = Boolean(params.imageIds?.length);

  const hasCardNotes = Boolean(params.productNotes?.trim() || params.contextImageId);

  let toolReply: string;
  try {
    toolReply = wasImagePause
      ? await prepareTaskImageSubmit({
          projectId: params.projectId,
          taskId: paused.id,
          imageIds: params.imageIds,
          productNotes: params.productNotes,
          contextImageId: params.contextImageId,
          message: params.message,
        })
      : await buildResumeToolReply({
          projectId: params.projectId,
          taskId: paused.id,
          message: params.message,
          imageIds: params.imageIds,
          productNotes: params.productNotes,
          contextImageId: params.contextImageId,
        });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not attach your photos — try again.";
    return { mode: "error", message };
  }

  if (hasProductPhotos) {
    const verified = await prisma.task.findUnique({
      where: { id: paused.id },
      select: { sourceImages: true },
    });
    const savedCount = ((verified?.sourceImages as string[] | null) ?? []).length;
    if (savedCount === 0) {
      return {
        mode: "error",
        message: "Photos could not be attached — please upload again and submit.",
      };
    }
  }

  const userMessage = await prisma.message.create({
    data: {
      conversationId: params.conversationId,
      role: "user",
      content:
        params.productNotes?.trim() ||
        params.message.trim() ||
        (hasProductPhotos
          ? params.imageIds!.length > 1
            ? `[Uploaded ${params.imageIds!.length} product photos]`
            : "[Uploaded product photo]"
          : ""),
      meta: {
        taskId: paused.id,
        type: "task_reply",
        imageIds: params.imageIds ?? [],
        productNotes: params.productNotes?.trim() || undefined,
        contextImageId: params.contextImageId,
      },
    },
  });
  await emitMessageCreated(params.projectId, userMessage);

  const skipReferenceIngest = hasProductPhotos && !params.message.trim();
  if (
    !skipReferenceIngest &&
    (params.message.trim().length > 80 || (params.imageIds?.length && !params.taskId))
  ) {
    try {
      await ingestUserReference({
        projectId: params.projectId,
        conversationId: params.conversationId,
        messageId: userMessage.id,
        text: params.message,
        imageIds: params.imageIds,
      });
    } catch {
      /* references saved silently; post agent handles reply */
    }
  }

  await setProjectPipelinePaused(params.projectId, false);

  const dispatch = await dispatchPipelineJob({
    type: "RESUME_TASK_AGENT",
    taskId: paused.id,
    projectId: params.projectId,
    payload: {
      taskId: paused.id,
      userReply: toolReply,
      fromImageRequest: wasImagePause,
    },
  });

  if (!dispatch.ok) {
    if (dispatch.reason === "already_running") {
      return {
        mode: "resume",
        taskId: paused.id,
        message: `“${paused.title}” is already being created.`,
      };
    }
    return {
      mode: "error",
      message: "Could not resume that post. Tap Resume work in chat, then try again.",
    };
  }

  if (wasImagePause) {
    await updateTaskFields(paused.id, {
      status: "AGENT_RUNNING",
      statusLabel: hasProductPhotos
        ? "Creating post — photo received…"
        : "Creating post — designing from scratch…",
      pendingQuestion: null,
    });
  }

  const scope = params.conversationId ? { conversationId: params.conversationId } : undefined;
  void advanceImageCollectionQueue(params.projectId, { force: true, scope }).catch((err) => {
    console.warn("[routeChatToPausedTask] advanceImageCollectionQueue failed:", err);
  });

  const notesSuffix = hasCardNotes ? " I'll use your notes for this post." : "";

  const ack = wasImagePause
    ? hasProductPhotos
      ? `Got it — creating “${paused.title}” with ${params.imageIds!.length} photo${params.imageIds!.length === 1 ? "" : "s"} in the background.${notesSuffix}`
      : `Got it — designing “${paused.title}” from scratch.${notesSuffix}`
    : hasProductPhotos
      ? `Got your photo${params.imageIds!.length === 1 ? "" : "s"} for “${paused.title}” — resuming that post now.${notesSuffix}`
      : isGenerateReply(params.message)
        ? `Designing “${paused.title}” from scratch — resuming now.${notesSuffix}`
        : `Got it — resuming “${paused.title}”.${notesSuffix}`;

  const message = ack;

  return { mode: "resume", taskId: paused.id, message };
}
