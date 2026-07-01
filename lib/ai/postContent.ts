import { MODELS } from "./models.config";
import { openRouterChatJSON } from "./openrouter";
import { prisma } from "@/lib/db/prisma";
import type { Task } from "@prisma/client";
import {
  formatProductInfoForPrompt,
  formatUserProductNotesForPrompt,
  formatVisualContextForPrompt,
  requireMarketingCopyContext,
} from "./productContext";
import {
  formatBrandKitForPostContentPrompt,
  resolveBrandKitForTask,
  type GraphicCopy,
} from "@/lib/brandKit/formatForPrompt";
import { resolvePreferenceContextFromTask } from "@/lib/brandKit/preferences";
import { sanitizeGraphicCopy } from "./generationRules";
import { formatCaptionCorpusForPrompt, getCaptionCorpus } from "@/lib/content/captionCorpus";
import { formatReferencesForGraphicPrompt, getReferencesForTask } from "@/lib/content/references";
import {
  isCompletePostContent,
  normalizePostContentPayload,
} from "./normalizePostContent";
import {
  POST_CONTENT_REPAIR_SUFFIX,
  POST_CONTENT_SYSTEM_PROMPT,
  POST_CONTENT_USER_FRAMING,
} from "./postContentPrompts";

export type PostContentResponse = {
  caption: string;
  graphicCopy: {
    headline: string;
    subheadline: string;
    bullet?: string;
    cta: string;
  };
  /** Creative brief only — app appends on-graphic copy and brand rules at makeGraphic. */
  imagePrompt: string;
};

export type PostContentResult = {
  caption: string;
  graphicCopy: GraphicCopy;
  imagePrompt: string;
};

export type PostContentPromptBundle = {
  systemPrompt: string;
  userContent: string;
  productName: string;
};

function uploadedPhotoHint(task: Pick<Task, "sourceImages">): string | null {
  const uploadedPhotoCount = ((task.sourceImages as string[] | null) ?? []).length;
  if (uploadedPhotoCount === 0) return null;
  return uploadedPhotoCount > 1
    ? `USER UPLOADED ${uploadedPhotoCount} PRODUCT PHOTOS for this post. Caption, graphicCopy, and imagePrompt must match what is shown in those photos. imagePrompt must compose the layout around the provided photos — do not invent a different product appearance.`
    : "USER UPLOADED A PRODUCT PHOTO for this post. Caption, graphicCopy, and imagePrompt must match what is shown in that photo. imagePrompt must compose the layout around the provided photo — do not invent a different product appearance.";
}

/** Build Sonnet system + user messages. Keeps all existing data blocks; prepends Creative Director framing. */
export async function buildPostContentPromptsForTask(
  task: Task
): Promise<PostContentPromptBundle> {
  const product = requireMarketingCopyContext(task);
  const kit = await resolveBrandKitForTask(task);
  if (!kit) {
    throw new Error("Brand kit required before generating post content");
  }

  const prefContext = resolvePreferenceContextFromTask(task);
  const corpus = await getCaptionCorpus(task.projectId);
  const pastContentBlock = formatCaptionCorpusForPrompt(corpus);
  const refs = await getReferencesForTask(task.projectId, task.id);
  const styleImageBlock = formatReferencesForGraphicPrompt(refs);
  const notesBlock = formatUserProductNotesForPrompt(task.userProductNotes);
  const visualNote = formatVisualContextForPrompt(product.summary?.visualContext);
  const brandContext = formatBrandKitForPostContentPrompt(kit, prefContext);

  const userContent = [
    POST_CONTENT_USER_FRAMING,
    formatProductInfoForPrompt({ name: product.name, summary: product.summary }),
    visualNote || null,
    brandContext
      ? `CLIENT BACKGROUND (who they are — NOT the post topic):\n${brandContext}`
      : null,
    notesBlock ? `USER-PROVIDED DETAIL FOR THIS POST:\n${notesBlock}` : null,
    uploadedPhotoHint(task),
    pastContentBlock || null,
    styleImageBlock || null,
    `POST TOPIC (write about this product only): ${product.name}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    systemPrompt: POST_CONTENT_SYSTEM_PROMPT,
    userContent,
    productName: product.name,
  };
}

/**
 * Single LLM call: caption + graphicCopy + imagePrompt.
 * imagePrompt is the creative brief only; makeGraphic appends graphic copy and brand rules.
 */
export async function generatePostContentForTask(taskId: string): Promise<PostContentResult> {
  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
  const { systemPrompt, userContent, productName } = await buildPostContentPromptsForTask(task);

  let payload = normalizePostContentPayload(
    await openRouterChatJSON<unknown>({
      model: MODELS.caption.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    }),
    productName
  );

  if (!isCompletePostContent(payload)) {
    payload = normalizePostContentPayload(
      await openRouterChatJSON<unknown>({
        model: MODELS.caption.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `${userContent}\n\n${POST_CONTENT_REPAIR_SUFFIX}` },
        ],
      }),
      productName
    );
  }

  if (!isCompletePostContent(payload)) {
    const missing: string[] = [];
    const partial = payload as PostContentResponse | null;
    if (!partial?.caption?.trim()) missing.push("caption");
    if (!partial?.graphicCopy?.headline?.trim()) missing.push("graphicCopy.headline");
    if (!partial?.graphicCopy?.subheadline?.trim()) missing.push("graphicCopy.subheadline");
    if (!partial?.graphicCopy?.cta?.trim()) missing.push("graphicCopy.cta");
    if (!partial?.imagePrompt?.trim()) missing.push("imagePrompt");
    throw new Error(
      `Post content generation returned incomplete fields: ${missing.join(", ") || "unknown"}`
    );
  }

  const caption = payload.caption.trim();
  const graphicCopy = sanitizeGraphicCopy(payload.graphicCopy);
  const imagePrompt = payload.imagePrompt.trim();

  await prisma.task.update({
    where: { id: taskId },
    data: {
      caption,
      graphicCopy: graphicCopy as object,
      imagePrompt,
    },
  });

  return { caption, graphicCopy, imagePrompt };
}
