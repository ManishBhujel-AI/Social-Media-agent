import { prisma } from "@/lib/db/prisma";
import type { Task } from "@prisma/client";
import type { BrandColor, BrandKitData } from "./types";
import { getForProject } from "./store";
import { getBusinessSummaryCache } from "./mapFromSummary";
import { resolveBusinessSummaryNarrative } from "./businessSummaryNarrative";
import { formatMarketingBriefForPrompt, requireMarketingCopyContext } from "@/lib/ai/productContext";

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

export function formatBrandKitForCaptionPrompt(kit: BrandKitData): string {
  const cache = getBusinessSummaryCache(kit);
  const narrative = resolveBusinessSummaryNarrative(kit, cache);

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
  ].filter((line) => line !== null && line !== "");

  return lines.join("\n");
}

export async function resolveBrandKitForTask(task: Task): Promise<BrandKitData | null> {
  const view = await getForProject(task.projectId);
  return view?.kit ?? null;
}

export function assembleImagePromptSkeleton(params: {
  kit: BrandKitData;
  graphicCopy: GraphicCopy;
  productDescription: string;
}): string {
  const { kit, graphicCopy, productDescription } = params;
  const cache = getBusinessSummaryCache(kit);
  const narrative = resolveBusinessSummaryNarrative(kit, cache);
  const aspectRatio = kit.aspectRatio?.trim() || "1:1";
  const heritage = kit.heritage?.trim() ? `${kit.heritage.trim()}.` : "";
  const colorsLine = kit.colors.length
    ? formatColorsForImagePrompt(kit.colors)
    : "";
  const avoidLine =
    kit.avoidColors.length > 0 ? kit.avoidColors.join(", ") : "";

  const lines: string[] = [
    `Create a professional social media graphic (${aspectRatio}) for ${kit.businessName},`,
    `${kit.businessType} based in ${kit.location}. ${heritage} Their audience is ${kit.audience}.`,
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

  lines.push(
    "",
    `THIS DESIGN IS FOR: ${productDescription}`,
    "",
    "COPY TO PLACE ON THE GRAPHIC (use this text exactly — no other text):",
    `HEADLINE: "${graphicCopy.headline}"`,
    `SUBHEADLINE: "${graphicCopy.subheadline}"`
  );

  if (graphicCopy.bullet?.trim()) {
    lines.push(`BULLET: "${graphicCopy.bullet.trim()}"`);
  }

  lines.push(`CTA: "${graphicCopy.cta}"`);

  if (kit.contact?.trim()) {
    const style = kit.contactStyle?.trim() || "clearly visible, on-brand color";
    lines.push(`CONTACT: show "${kit.contact.trim()}" — ${style}.`);
  }

  lines.push(
    "",
    "DESIGN DIRECTION: Be creative with layout, composition, background, typography, and",
    "tasteful decorative elements that match this brand's personality — textures, patterns,",
    "seasonal motifs, local cues, or subtle supporting visuals when they strengthen the story.",
    "Make it visually striking, on-brand, and distinctive — not a generic template.",
    "Use your judgment to elevate the design while staying true to the brand summary above.",
    "",
    "RULES:",
    "- All specified COPY text must be fully within the frame — nothing clipped or cut off.",
    "- Normal letter spacing; let text breathe — never cramped or condensed.",
    "- Do NOT add extra marketing text beyond the HEADLINE, SUBHEADLINE, BULLET (if any), CTA,",
    "  and CONTACT lines above.",
    "- Decorative and atmospheric elements are encouraged when they reinforce the brand feel",
    "  without competing with product photos or the specified copy."
  );

  return lines.join("\n");
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
