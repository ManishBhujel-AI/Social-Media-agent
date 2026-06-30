import type { GraphicCopy } from "@/lib/brandKit/formatForPrompt";

/** Universal rules for on-graphic copy generation (all clients). */
export const GRAPHIC_COPY_SYSTEM_RULES = `You write on-graphic copy: HEADLINE, SUBHEADLINE, optional BULLET, CTA.
Keep it light — push detail into the caption. Headline ≤ ~6 words, benefit-led hook.
Do NOT list product specs. Do NOT describe the photo. Match brand tone.
Do NOT use em dashes (—) or en dashes (–) in any on-graphic text — use shorter phrasing or a hyphen instead.
Keep graphics from looking text-heavy — only headline, subheadline, at most one supporting line, CTA, and contact belong on the image.
Return JSON: { "headline", "subheadline", "bullet"?, "cta" }.`;

/** Caption rules injected when brand context is assembled. */
export const CAPTION_UNIVERSAL_RULES = `Never present an already-passed date as upcoming — omit it or mark it as passed.
Do not describe the product image or what the photo shows.`;

/** Image prompt rules (supplement skeleton RULES block). */
export const IMAGE_PROMPT_UNIVERSAL_RULES = [
  "Contact icon and phone number must share one accent color — never a white icon with a colored number.",
  "Never present an already-passed date as upcoming on the graphic.",
  "Do not use em dashes (—) in on-graphic copy.",
] as const;

/** Light-touch: only sanitizes graphicCopy string fields. */
export function sanitizeGraphicCopy(copy: GraphicCopy): GraphicCopy {
  const clean = (value: string) =>
    value
      .replace(/\u2014/g, "-")
      .replace(/\u2013/g, "-")
      .replace(/\s—\s/g, " - ");

  return {
    headline: clean(copy.headline),
    subheadline: clean(copy.subheadline),
    bullet: copy.bullet?.trim() ? clean(copy.bullet) : undefined,
    cta: clean(copy.cta),
  };
}
