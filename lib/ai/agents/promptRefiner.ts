import { MODELS } from "../models.config";
import { openRouterChatJSON } from "../openrouter";
import { prisma } from "@/lib/db/prisma";
import { requireMarketingCopyContext } from "../productContext";
import {
  assembleImagePromptSkeleton,
  resolveBrandKitForTask,
  type GraphicCopy,
} from "@/lib/brandKit/formatForPrompt";
import { resolvePreferenceContextFromTask } from "@/lib/brandKit/preferences";
import { generatePostContentForTask } from "../postContent";
import { getReferencesForTask } from "@/lib/content/references";
import { appendImagePromptExtras } from "../imagePromptExtras";

export type { GraphicCopy };

/** Fallback when graphic copy is missing — normally created with caption in one LLM call. */
export async function generateGraphicCopy(taskId: string): Promise<GraphicCopy> {
  const task = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    select: { graphicCopy: true, caption: true },
  });

  const existing = task.graphicCopy as GraphicCopy | null;
  if (existing?.headline && existing.subheadline && existing.cta) {
    return existing;
  }

  if (task.caption?.trim()) {
    throw new Error("Caption exists without graphic copy — re-run writeCaption to regenerate all content");
  }

  const { graphicCopy } = await generatePostContentForTask(taskId);
  return graphicCopy;
}

/** Legacy fallback when imagePrompt was not saved with writeCaption (older posts). */
export async function generateImagePrompt(taskId: string): Promise<string> {
  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
  if (task.imagePrompt?.trim()) return task.imagePrompt.trim();

  const product = requireMarketingCopyContext(task);
  const kit = await resolveBrandKitForTask(task);
  if (!kit) {
    throw new Error("Brand kit required before generating image prompt");
  }

  let graphicCopy = task.graphicCopy as GraphicCopy | null;
  if (!graphicCopy || typeof graphicCopy !== "object" || !graphicCopy.headline) {
    graphicCopy = await generateGraphicCopy(taskId);
  }

  const refs = await getReferencesForTask(task.projectId, taskId);
  const prefContext = resolvePreferenceContextFromTask(task);

  let prompt = assembleImagePromptSkeleton({
    kit,
    graphicCopy,
    productDescription: product.marketingBrief,
    context: prefContext,
  });

  prompt += appendImagePromptExtras({
    task,
    visualContext: product.summary?.visualContext,
    styleRefs: refs,
  });

  await prisma.task.update({
    where: { id: taskId },
    data: { imagePrompt: prompt },
  });
  return prompt;
}

export type FeedbackResult = {
  changeType: "minor_edit" | "full_regenerate";
  instruction: string;
  agentNoteDraft: string;
};

export async function refineFeedback(
  taskId: string,
  generationId: string,
  feedback: string,
  opts?: { feedbackReferenceCount?: number }
): Promise<FeedbackResult> {
  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
  const gen = await prisma.generation.findFirstOrThrow({
    where: { generationId, taskId },
  });

  const refNote =
    opts?.feedbackReferenceCount && opts.feedbackReferenceCount > 0
      ? opts.feedbackReferenceCount > 1
        ? ` The user attached ${opts.feedbackReferenceCount} reference images — explain in the instruction how each should be used (usually full_regenerate unless the tweak is tiny).`
        : " The user attached a reference image — incorporate it as described (usually full_regenerate unless the tweak is tiny)."
      : "";

  return openRouterChatJSON<FeedbackResult>({
    model: MODELS.promptRefiner.model,
    messages: [
      {
        role: "system",
        content: `Classify graphic feedback as minor_edit or full_regenerate.
minor_edit: small tweak (color, text size, background warmth) — preserve composition. The instruction must describe exactly ONE precise change.
full_regenerate: new concept, layout, style, start over, or adding/incorporating a user-provided reference image.
Return JSON: { "changeType": "minor_edit"|"full_regenerate", "instruction": "...", "agentNoteDraft": "..." }${refNote}`,
      },
      {
        role: "user",
        content: JSON.stringify({
          caption: task.caption,
          currentPrompt: gen.prompt,
          feedback,
          hasImage: !!gen.imagePath,
          userAttachedReferenceImages: opts?.feedbackReferenceCount ?? 0,
        }),
      },
    ],
  });
}
