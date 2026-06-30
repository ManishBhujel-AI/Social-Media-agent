import { prisma } from "@/lib/db/prisma";
import type { Task } from "@prisma/client";
import type { BrandColor, BrandKitData } from "./types";
import {
  formatPreferencesForPrompt,
  formatProductNotesForPrompt,
  formatSecondaryContactsForCaption,
  type PreferenceContext,
} from "./preferences";
import { CAPTION_UNIVERSAL_RULES, IMAGE_PROMPT_UNIVERSAL_RULES } from "@/lib/ai/generationRules";
import { getForProject } from "./store";
import { getBusinessSummaryCache } from "./mapFromSummary";
import { resolveBusinessSummaryNarrative } from "./businessSummaryNarrative";
import { requireMarketingCopyContext } from "@/lib/ai/productContext";

export type GraphicCopy = {
  headline: string;
  subheadline: string;
  bullet?: string;
  cta: string;
};

export function formatColorsForImagePrompt(colors: BrandColor[]): string {
  return colors
    .map((c) => (c.hex ? `${c.name} ${c.hex}` : c.name))
    .join(", ");
}

/** Slim brand context for post content generation — voice and rules, not full product catalog. */
export function formatBrandKitForPostContentPrompt(
  kit: BrandKitData,
  context: PreferenceContext = {}
): string {
  const preferencesBlock = formatPreferencesForPrompt(kit, context);
  const productNotesBlock = formatProductNotesForPrompt(kit, context.product);

  const lines = [
    "BRAND DETAILS:",
    kit.businessName ? `Business: ${kit.businessName}` : null,
    kit.businessType ? `Type: ${kit.businessType}` : null,
    kit.audience ? `Audience: ${kit.audience}` : null,
    kit.tone ? `Tone: ${kit.tone}` : null,
    kit.heritage ? `Heritage: ${kit.heritage}` : null,
    kit.themeWords ? `Theme / feel: ${kit.themeWords}` : null,
    kit.location ? `Location: ${kit.location}` : null,
    preferencesBlock || null,
    productNotesBlock || null,
    "",
    CAPTION_UNIVERSAL_RULES,
  ].filter((line): line is string => line !== null && line !== "");

  return lines.join("\n");
}

export function formatBrandKitForCaptionPrompt(
  kit: BrandKitData,
  context: PreferenceContext = {}
): string {
  const cache = getBusinessSummaryCache(kit);
  const narrative = resolveBusinessSummaryNarrative(kit, cache);
  const preferencesBlock = formatPreferencesForPrompt(kit, context);
  const productNotesBlock = formatProductNotesForPrompt(kit, context.product);
  const contactsBlock = formatSecondaryContactsForCaption(kit);

  const lines = [
    narrative ? `BUSINESS SUMMARY:\n${narrative}` : null,
    "",
    "BRAND DETAILS:",
    `Business: ${kit.businessName}`,
    kit.businessType ? `Type: ${kit.businessType}` : null,
    kit.tone ? `Tone: ${kit.tone}` : null,
    kit.audience ? `Audience: ${kit.audience}` : null,
    kit.heritage ? `Heritage: ${kit.heritage}` : null,
    kit.themeWords ? `Theme / feel: ${kit.themeWords}` : null,
    kit.location ? `Location: ${kit.location}` : null,
    preferencesBlock || null,
    productNotesBlock || null,
    contactsBlock || null,
    "",
    CAPTION_UNIVERSAL_RULES,
  ].filter((line) => line !== null && line !== "");

  return lines.join("\n");
}

export async function resolveBrandKitForTask(task: Task): Promise<BrandKitData | null> {
  const view = await getForProject(task.projectId);
  return view?.kit ?? null;
}

export function assembleImageBrandScaffold(params: {
  kit: BrandKitData;
  graphicCopy: GraphicCopy;
  productDescription: string;
  context?: PreferenceContext;
}): string {
  const { kit, graphicCopy, productDescription, context = {} } = params;
  const cache = getBusinessSummaryCache(kit);
  const narrative = resolveBusinessSummaryNarrative(kit, cache);
  const preferencesBlock = formatPreferencesForPrompt(kit, context);
  const productNotesBlock = formatProductNotesForPrompt(kit, context.product);
  const aspectRatio = kit.aspectRatio?.trim() || "1:1";
  const heritage = kit.heritage?.trim() ? `${kit.heritage.trim()}.` : "";
  const colorsLine = kit.colors.length
    ? formatColorsForImagePrompt(kit.colors)
    : "";
  const avoidLine =
    kit.avoidColors.length > 0 ? kit.avoidColors.join(", ") : "";

  const lines: string[] = [
    "BRAND SCAFFOLD (mandatory — apply exactly):",
    `Format: professional social media graphic (${aspectRatio}) for ${kit.businessName},`,
    `${kit.businessType} based in ${kit.location}. ${heritage} Audience: ${kit.audience}.`,
    "",
    "BRAND CONTEXT:",
  ];

  if (narrative) {
    lines.push(narrative);
    lines.push("");
  }

  if (colorsLine) {
    lines.push(`- Colors to use: ${colorsLine}`);
  }
  if (avoidLine) {
    lines.push(`- DO NOT use ${avoidLine} anywhere — not in text, fonts, or accents.`);
  }
  if (kit.themeWords?.trim()) {
    lines.push(`- Theme / feel: ${kit.themeWords.trim()}`);
  }
  if (kit.tone?.trim()) {
    lines.push(`- Tone: ${kit.tone.trim()}`);
  }
  if (preferencesBlock) {
    lines.push("");
    lines.push(preferencesBlock);
  }
  if (productNotesBlock) {
    lines.push("");
    lines.push(productNotesBlock);
  }

  lines.push(
    "",
    `THIS DESIGN IS FOR: ${productDescription}`,
    "",
    "ON-GRAPHIC TEXT (typeset as a professional social graphic — render ONLY the quoted strings below,",
    "never the role labels like headline or subheadline):",
    `- Hero headline (largest text): "${graphicCopy.headline}"`,
    `- Subheadline (smaller, below headline): "${graphicCopy.subheadline}"`
  );

  if (graphicCopy.bullet?.trim()) {
    lines.push(`- Supporting line (regular weight, not bold): "${graphicCopy.bullet.trim()}"`);
  }

  lines.push(`- Call to action: "${graphicCopy.cta}"`);

  if (kit.contact?.trim()) {
    const style = kit.contactStyle?.trim() || "clearly visible, on-brand color";
    lines.push(
      `- Phone / contact (icon + number same accent color): "${kit.contact.trim()}" — ${style}.`
    );
  }

  lines.push(
    "",
    "RULES:",
    "- All on-graphic text above must be fully within the frame — nothing clipped or cut off.",
    "- Normal letter spacing; let text breathe — never cramped or condensed.",
    "- Do NOT print metadata labels (HEADLINE, SUBHEADLINE, BULLET, CTA, CONTACT) on the image.",
    "- Do NOT add extra marketing text beyond the quoted lines above.",
    ...IMAGE_PROMPT_UNIVERSAL_RULES.map((rule) => `- ${rule}`),
    "- Decorative and atmospheric elements are encouraged when they reinforce the brand feel",
    "  without competing with product photos or the specified copy."
  );

  return lines.join("\n");
}

const DEFAULT_CREATIVE_SCENE =
  "Visually striking composition with thoughtful layout, background, and product placement. " +
  "Tasteful decorative elements that match the brand — textures, local cues, or seasonal motifs when they strengthen the story.";

/** Final image model prompt: LLM creative scene + code-owned brand scaffold. */
export function assembleFinalImagePrompt(params: {
  creativeScene: string;
  kit: BrandKitData;
  graphicCopy: GraphicCopy;
  productDescription: string;
  context?: PreferenceContext;
}): string {
  const creative = params.creativeScene.trim() || DEFAULT_CREATIVE_SCENE;
  const scaffold = assembleImageBrandScaffold(params);
  return `${creative}\n\n${scaffold}`;
}

export function assembleImagePromptSkeleton(params: {
  kit: BrandKitData;
  graphicCopy: GraphicCopy;
  productDescription: string;
  context?: PreferenceContext;
}): string {
  return assembleFinalImagePrompt({
    ...params,
    creativeScene: DEFAULT_CREATIVE_SCENE,
  });
}

export async function loadGraphicCopyForTask(taskId: string): Promise<GraphicCopy | null> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { graphicCopy: true },
  });
  if (!task?.graphicCopy || typeof task.graphicCopy !== "object") return null;
  const gc = task.graphicCopy as Record<string, unknown>;
  if (typeof gc.headline !== "string" || typeof gc.subheadline !== "string" || typeof gc.cta !== "string") {
    return null;
  }
  return {
    headline: gc.headline,
    subheadline: gc.subheadline,
    bullet: typeof gc.bullet === "string" ? gc.bullet : undefined,
    cta: gc.cta,
  };
}

export function productOneLinerFromTask(task: { subject: string; title: string; productInfo?: unknown; productSummary?: unknown }): string {
  try {
    const product = requireMarketingCopyContext(task as Parameters<typeof requireMarketingCopyContext>[0]);
    return product.marketingBrief.slice(0, 200);
  } catch {
    return task.subject || task.title;
  }
}
