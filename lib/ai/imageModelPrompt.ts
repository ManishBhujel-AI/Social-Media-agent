import type { GraphicCopy } from "@/lib/brandKit/formatForPrompt";
import { formatColorsForImagePrompt } from "@/lib/brandKit/formatForPrompt";
import type { BrandKitData } from "@/lib/brandKit/types";
import type { ResolvedReference } from "./buildImageRefs";

export function formatOnGraphicCopyBlock(graphicCopy: GraphicCopy): string {
  const lines = [
    "ON GRAPHIC COPY",
    "",
    `Headline:\n${graphicCopy.headline}`,
    "",
    `Subheadline:\n${graphicCopy.subheadline}`,
  ];
  if (graphicCopy.bullet?.trim()) {
    lines.push("", `Bullet:\n${graphicCopy.bullet.trim()}`);
  }
  lines.push("", `CTA:\n${graphicCopy.cta}`);
  return lines.join("\n");
}

export function formatImageBrandRules(
  kit: BrandKitData,
  refs: ResolvedReference[]
): string {
  const lines = ["BRAND RULES", ""];

  const logoIdx = refs.findIndex((r) => r.role === "logo");
  if (logoIdx >= 0) {
    lines.push(`Logo:\n(reference image ${logoIdx + 1})`);
  } else if (kit.businessName?.trim()) {
    lines.push(
      `Logo:\nNo logo attached — use clean typography for "${kit.businessName.trim()}".`
    );
  }

  if (kit.colors.length) {
    lines.push("", `Brand Colors:\n${formatColorsForImagePrompt(kit.colors)}`);
  }
  if (kit.avoidColors.length) {
    lines.push(
      "",
      `Avoid Colors:\nDo not use ${kit.avoidColors.join(", ")} anywhere — not in text, fonts, or accents.`
    );
  }
  if (kit.contact?.trim()) {
    const style = kit.contactStyle?.trim() ? ` — ${kit.contactStyle.trim()}` : "";
    lines.push("", `Phone:\n${kit.contact.trim()}${style}`);
  }

  const productRefs = refs
    .map((r, i) => ({ r, n: i + 1 }))
    .filter(({ r }) => r.role === "product" || r.role === "extra");
  if (productRefs.length) {
    const labels = productRefs.map(({ n }) => `reference image ${n}`).join(", ");
    lines.push(
      "",
      `Product photos:\nUse ${labels} exactly as provided — do not redraw, recolor, or alter.`
    );
  }

  return lines.join("\n");
}

/** Sonnet creative brief + app-owned graphic copy and brand rules → image model prompt. */
export function assembleImageModelPrompt(params: {
  creativeBrief: string;
  graphicCopy: GraphicCopy;
  kit: BrandKitData;
  refs: ResolvedReference[];
}): string {
  const brief = params.creativeBrief.trim();
  const appendix = [
    formatOnGraphicCopyBlock(params.graphicCopy),
    formatImageBrandRules(params.kit, params.refs),
  ].join("\n\n");
  return `${brief}\n\n${appendix}`;
}
