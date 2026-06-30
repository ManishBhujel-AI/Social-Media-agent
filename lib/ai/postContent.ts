import { MODELS } from "./models.config";
import { openRouterChatJSON } from "./openrouter";
import { prisma } from "@/lib/db/prisma";
import {
  formatProductInfoForPrompt,
  formatUserProductNotesForPrompt,
  formatVisualContextForPrompt,
  requireMarketingCopyContext,
} from "./productContext";
import {
  assembleFinalImagePrompt,
  formatBrandKitForPostContentPrompt,
  resolveBrandKitForTask,
  type GraphicCopy,
} from "@/lib/brandKit/formatForPrompt";
import { resolvePreferenceContextFromTask } from "@/lib/brandKit/preferences";
import {
  CAPTION_UNIVERSAL_RULES,
  GRAPHIC_COPY_SYSTEM_RULES,
  sanitizeGraphicCopy,
} from "./generationRules";
import {
  formatCaptionCorpusForPrompt,
  getCaptionCorpus,
  hashtagGuidanceFromCorpus,
} from "@/lib/content/captionCorpus";
import { formatReferencesForGraphicPrompt, getReferencesForTask } from "@/lib/content/references";
import { appendImagePromptExtras } from "./imagePromptExtras";
import {
  isCompletePostContent,
  normalizePostContentPayload,
} from "./normalizePostContent";

export type PostContentResponse = {
  caption: string;
  graphicCopy: {
    headline: string;
    subheadline: string;
    bullet?: string;
    cta: string;
  };
  /** Creative scene only — background, mood, product arrangement. No hex codes, contact, or rules. */
  imagePrompt: string;
};

export type PostContentResult = {
  caption: string;
  graphicCopy: GraphicCopy;
  imagePrompt: string;
};

const POST_TOPIC_RULES = `POST TOPIC RULES (highest priority):
- Write about the product/service named in POST TOPIC only.
- Do not write about other products the client carries, even if they appear in CLIENT BACKGROUND or past captions.
- Graphic headline, subheadline, bullet, and caption must all be about the POST TOPIC product.`;

const POST_CONTENT_SYSTEM_PROMPT = `You write a complete social post package in one pass for ONE post only.

OUTPUT FORMAT (critical):
- Reply with a single raw JSON object — no markdown, no code fences, no preamble, no arrays of posts.
- Exactly these top-level keys: { "caption", "graphicCopy": { "headline", "subheadline", "bullet"?, "cta" }, "imagePrompt" }

${POST_TOPIC_RULES}

CAPTION:
${CAPTION_UNIVERSAL_RULES}
Open with a hook, lead with customer benefit, include a light CTA, end with hashtags.
Do NOT describe the product image — the graphic handles visuals.
Do NOT invent specs not in the product info or client detail.

GRAPHIC COPY (on-image text):
${GRAPHIC_COPY_SYSTEM_RULES}
Keep on-graphic text light — push detail into the caption. Headline and subheadline must align with the caption and the POST TOPIC product.

IMAGE PROMPT (creative scene only — 2-4 sentences):
Describe background, mood, layout, and product arrangement for THIS specific post so the design feels fresh, not templated.
Do NOT include hex color codes, contact phone numbers, brand rules, or the exact on-graphic copy text — the app appends those deterministically.
Focus on: setting, atmosphere, how product photos are composed, decorative elements, local/seasonal cues when relevant.`;

const REPAIR_SUFFIX =
  "Return exactly ONE JSON object for this post only. Keys required: caption (non-empty string), graphicCopy { headline, subheadline, cta, bullet? }, imagePrompt (non-empty string). No markdown, no arrays, no multiple posts.";

/**
 * Single LLM call: caption + graphicCopy + creative imagePrompt.
 * Final image prompt = LLM creative scene + code-appended brand scaffold.
 */
export async function generatePostContentForTask(taskId: string): Promise<PostContentResult> {
  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
  const product = requireMarketingCopyContext(task);
  const kit = await resolveBrandKitForTask(task);
  if (!kit) {
    throw new Error("Brand kit required before generating post content");
  }

  const prefContext = resolvePreferenceContextFromTask(task);
  const corpus = await getCaptionCorpus(task.projectId);
  const pastContentBlock = formatCaptionCorpusForPrompt(corpus);
  const refs = await getReferencesForTask(task.projectId, taskId);
  const styleImageBlock = formatReferencesForGraphicPrompt(refs);
  const notesBlock = formatUserProductNotesForPrompt(task.userProductNotes);
  const visualNote = formatVisualContextForPrompt(product.summary?.visualContext);
  const brandContext = formatBrandKitForPostContentPrompt(kit, prefContext);
  const uploadedPhotoCount = ((task.sourceImages as string[] | null) ?? []).length;
  const uploadedPhotoHint =
    uploadedPhotoCount > 0
      ? uploadedPhotoCount > 1
        ? `USER UPLOADED ${uploadedPhotoCount} PRODUCT PHOTOS for this post. Caption, graphicCopy, and imagePrompt must match what is shown in those photos. imagePrompt must compose the layout around the provided photos — do not invent a different product appearance.`
        : "USER UPLOADED A PRODUCT PHOTO for this post. Caption, graphicCopy, and imagePrompt must match what is shown in that photo. imagePrompt must compose the layout around the provided photo — do not invent a different product appearance."
      : null;

  const systemPrompt = `${POST_CONTENT_SYSTEM_PROMPT}\n\n${hashtagGuidanceFromCorpus(corpus)}`;
  const userContent = [
    formatProductInfoForPrompt({ name: product.name, summary: product.summary }),
    visualNote || null,
    brandContext
      ? `CLIENT BACKGROUND (who they are — NOT the post topic):\n${brandContext}`
      : null,
    notesBlock ? `USER-PROVIDED DETAIL FOR THIS POST:\n${notesBlock}` : null,
    uploadedPhotoHint,
    pastContentBlock || null,
    styleImageBlock || null,
    `POST TOPIC (write about this product only): ${product.name}`,
    "Write caption, graphicCopy, and imagePrompt together so they complement each other.",
  ]
    .filter(Boolean)
    .join("\n\n");

  let payload = normalizePostContentPayload(
    await openRouterChatJSON<unknown>({
      model: MODELS.caption.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    }),
    product.name
  );

  if (!isCompletePostContent(payload)) {
    payload = normalizePostContentPayload(
      await openRouterChatJSON<unknown>({
        model: MODELS.caption.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `${userContent}\n\n${REPAIR_SUFFIX}` },
        ],
      }),
      product.name
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
  const creativeScene = payload.imagePrompt.trim();

  let imagePrompt = assembleFinalImagePrompt({
    creativeScene,
    kit,
    graphicCopy,
    productDescription: product.marketingBrief,
    context: prefContext,
  });

  imagePrompt += appendImagePromptExtras({
    task,
    visualContext: product.summary?.visualContext,
    styleRefs: refs,
  });

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
