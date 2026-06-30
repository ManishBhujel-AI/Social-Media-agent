import type { BrandKitData } from "./types";
import { resolveBusinessSummaryNarrative } from "./businessSummaryNarrative";
import { findConfidentProductNoteKey } from "./preferences";

export type ClientResearchContext = {
  businessName: string;
  businessType: string;
  audience: string;
  location: string;
  tone: string;
  narrative: string;
  /** Explicit framing for research — same product, different audience pain points. */
  audienceFraming: string;
  productNote?: string;
};

export function buildClientResearchContext(
  kit: BrandKitData,
  productName?: string
): ClientResearchContext {
  const businessName = kit.businessName?.trim() ?? "";
  const businessType = kit.businessType?.trim() ?? "";
  const audience = kit.audience?.trim() ?? "";
  const location = kit.location?.trim() ?? "";
  const tone = kit.tone?.trim() ?? "";
  const narrative = resolveBusinessSummaryNarrative(kit).trim();

  const audienceLabel = audience || businessType || "this client's customers";
  const audienceFraming = [
    `Research and write for ${businessName || "this business"}'s audience: ${audienceLabel}.`,
    businessType ? `Business type: ${businessType}.` : "",
    "The same product means different benefits for different customers — frame pain points and value for THIS audience only, not generic consumers.",
    audience.includes("contractor") || businessType.match(/hvac|trade|wholesale|b2b/i)
      ? "Focus on job-site outcomes, reliability, margins, callbacks, and professional credibility — not homeowner lifestyle angles unless the audience is homeowners."
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  let productNote: string | undefined;
  if (productName?.trim()) {
    const key = findConfidentProductNoteKey(kit.productNotes ?? {}, productName);
    if (key) productNote = kit.productNotes[key]?.trim();
  }

  return {
    businessName,
    businessType,
    audience,
    location,
    tone,
    narrative,
    audienceFraming,
    productNote,
  };
}

export function formatClientResearchContextForPrompt(ctx: ClientResearchContext): string {
  const lines = [
    ctx.businessName ? `Business: ${ctx.businessName}` : null,
    ctx.businessType ? `Type: ${ctx.businessType}` : null,
    ctx.audience ? `Audience: ${ctx.audience}` : null,
    ctx.location ? `Location: ${ctx.location}` : null,
    ctx.tone ? `Tone: ${ctx.tone}` : null,
    ctx.narrative ? `Summary: ${ctx.narrative.slice(0, 900)}` : null,
    ctx.productNote ? `Product note: ${ctx.productNote}` : null,
    ctx.audienceFraming,
  ].filter((line): line is string => Boolean(line));
  return lines.join("\n");
}
