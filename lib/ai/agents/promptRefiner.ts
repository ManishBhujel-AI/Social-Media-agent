import { MODELS } from "../models.config";
import { openRouterChatJSON } from "../openrouter";
import { prisma } from "@/lib/db/prisma";
import {
  formatMarketingBriefForPrompt,
  formatUserProductNotesForPrompt,
  formatVisualContextForPrompt,
  requireMarketingCopyContext,
} from "../productContext";
import {
  assembleImagePromptSkeleton,
  formatBrandKitForCaptionPrompt,
  resolveBrandKitForTask,
  type GraphicCopy,
} from "@/lib/brandKit/formatForPrompt";
import { formatReferencesForGraphicPrompt, getReferencesForTask } from "@/lib/content/references";

export type { GraphicCopy };

export async function generateGraphicCopy(taskId: string): Promise<GraphicCopy> {
  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
  const product = requireMarketingCopyContext(task);
  const kit = await resolveBrandKitForTask(task);
  const refs = await getReferencesForTask(task.projectId, taskId);
  const refBlock = formatReferencesForGraphicPrompt(refs);
  const notesBlock = formatUserProductNotesForPrompt(task.userProductNotes);
  const summary = product.summary;
  const visualNote = formatVisualContextForPrompt(summary?.visualContext);

  const copy = await openRouterChatJSON<GraphicCopy>({
    model: MODELS.promptRefiner.model,
    messages: [
      {
        role: "system",
        content:
          'You write on-graphic copy: HEADLINE, SUBHEADLINE, optional BULLET, CTA. Keep it light — push detail into the caption. Headline ≤ ~6 words, benefit-led hook. Do NOT list product specs. Do NOT describe the photo. Match brand tone. Return JSON: { "headline", "subheadline", "bullet"?, "cta" }.',
      },
      {
        role: "user",
        content: `${formatMarketingBriefForPrompt(product)}${visualNote ? `\n\n${visualNote}` : ""}\n\nPost caption:\n${task.caption ?? ""}\n\n${kit ? formatBrandKitForCaptionPrompt(kit) : "Brand tone: professional"}${notesBlock ? `\n\n${notesBlock}` : ""}${refBlock ? `\n\n${refBlock}` : ""}`,
      },
    ],
  });

  await prisma.task.update({
    where: { id: taskId },
    data: { graphicCopy: copy as object },
  });

  return copy;
}

export async function generateImagePrompt(taskId: string): Promise<string> {
  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
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
  const styleBlock = formatReferencesForGraphicPrompt(refs);
  const notesBlock = formatUserProductNotesForPrompt(task.userProductNotes);
  const visualNote = formatVisualContextForPrompt(product.summary?.visualContext);

  const productDescription = product.marketingBrief;

  let prompt = assembleImagePromptSkeleton({
    kit,
    graphicCopy,
    productDescription,
  });

  const sourceImageCount = ((task.sourceImages as string[] | null) ?? []).length;
  if (sourceImageCount > 1) {
    prompt += `\n\nUser provided ${sourceImageCount} product photos. The graphic must visibly include all ${sourceImageCount} uploaded product shots in the composition.`;
  }

  if (visualNote) prompt += `\n\n${visualNote}`;
  if (notesBlock) prompt += `\n\n${notesBlock}`;
  if (styleBlock) prompt += `\n\n${styleBlock}`;

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
