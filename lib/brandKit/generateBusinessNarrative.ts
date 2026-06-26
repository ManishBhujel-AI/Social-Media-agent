import { MODELS } from "@/lib/ai/models.config";
import { openRouterChatText } from "@/lib/ai/openrouter";
import type { BusinessSummary } from "@/lib/ai/agents/summarizeBusiness";
import type { BrandKitData } from "./types";
import { composeNarrativeFromKitFields } from "./businessSummaryNarrative";

/** Target length for agent-facing business context. */
export const MIN_BUSINESS_SUMMARY_CHARS = 400;

export const BUSINESS_SUMMARY_WRITING_INSTRUCTIONS = `Write 2–3 paragraphs (200–350 words) in flowing plain prose — no bullet points, no section headings.

You MUST weave in all of the following (skip only what is truly unknown from the source material):

1. CUSTOMERS — Who actually buys from them or uses their services? (e.g. HVAC contractors, homeowners, commercial builders, property managers — be specific.)

2. PRODUCTS & SERVICES — What do they actually sell or do? Name real categories, product lines, equipment types, and services — not vague "solutions."

3. LOCATIONS — Where are they based? What cities, islands, regions, or service areas do they cover?

4. DIFFERENTIATORS — What sets them apart from competitors? (e.g. family-owned since a specific year, in-house manufacturing, local stock depth, certifications, speed, expertise.)

5. BRAND VOICE — How should social content sound for this brand?

6. HERITAGE & TRUST — Years in business, reputation, or credibility signals when known.

Be specific and concrete. Use real details from the source material. Never write empty filler like "committed to quality" without naming what they actually do.`;

export function isBusinessSummaryTooShort(text: string | null | undefined): boolean {
  const trimmed = text?.trim() ?? "";
  return trimmed.length < MIN_BUSINESS_SUMMARY_CHARS;
}

/** Re-expand summaries that are long enough but missing key business context. */
export function isBusinessSummaryIncomplete(text: string | null | undefined): boolean {
  const trimmed = text?.trim() ?? "";
  if (!trimmed) return true;
  if (isBusinessSummaryTooShort(trimmed)) return true;

  const hasCustomers =
    /\b(customer|client|contractor|homeowner|business(es)?|audience|serve|serving|for\s+\w+)/i.test(
      trimmed
    );
  const hasOfferings =
    /\b(sell|offer|provide|supply|stock|distribut|install|service|product|equipment|material|manufactur)/i.test(
      trimmed
    );
  const hasLocation =
    /\b(based in|located|location|serving|area|region|island|county|statewide|throughout)\b/i.test(
      trimmed
    ) || /\b[A-Z][a-z]+(?:,\s*[A-Z]{2})?\b/.test(trimmed);
  const hasDifferentiator =
    /\b(since|family|only|first|custom|specializ|unique|trusted|leading|years|heritage|different|unlike|exclusive|in-house)/i.test(
      trimmed
    );

  const coverage = [hasCustomers, hasOfferings, hasLocation, hasDifferentiator].filter(Boolean).length;
  return coverage < 4;
}

export async function generateDetailedBusinessNarrative(params: {
  kit: Pick<
    BrandKitData,
    | "businessName"
    | "businessType"
    | "audience"
    | "location"
    | "tone"
    | "heritage"
    | "themeWords"
    | "contact"
    | "businessSummary"
  >;
  summary?: BusinessSummary | null;
  pageText?: string;
  website?: string;
}): Promise<string> {
  const { kit, summary, pageText, website } = params;
  const fallback = composeNarrativeFromKitFields(kit, summary ?? undefined);

  const context = {
    website,
    businessName: kit.businessName || summary?.businessName,
    businessType: kit.businessType || summary?.industry,
    location: kit.location || summary?.location,
    audience: kit.audience || summary?.audience,
    tone: kit.tone || summary?.tone,
    heritage: kit.heritage,
    themeWords: kit.themeWords,
    contact: kit.contact,
    tagline: summary?.whatTheyDo,
    existingSummary: kit.businessSummary || summary?.narrativeSummary || summary?.whatTheyDo,
    products: summary?.products ?? [],
    pageExcerpt: pageText?.slice(0, 12_000),
  };

  try {
    const narrative = await openRouterChatText({
      model: MODELS.promptRefiner.model,
      messages: [
        {
          role: "system",
          content: `You write detailed business summaries for a social media content team.\n\n${BUSINESS_SUMMARY_WRITING_INSTRUCTIONS}`,
        },
        {
          role: "user",
          content: JSON.stringify(context, null, 2),
        },
      ],
    });

    const trimmed = narrative.trim();
    if (trimmed.length >= MIN_BUSINESS_SUMMARY_CHARS && !isBusinessSummaryIncomplete(trimmed)) {
      return trimmed;
    }
    if (trimmed.length > fallback.length) return trimmed;
  } catch {
    /* fall through */
  }

  return fallback;
}

export async function ensureDetailedBusinessSummaryOnKit(
  kit: BrandKitData,
  summary?: BusinessSummary | null,
  opts?: { pageText?: string; website?: string; force?: boolean }
): Promise<BrandKitData> {
  const current = kit.businessSummary?.trim() ?? "";
  const userWritten =
    kit.sources.businessSummary === "user" &&
    current.length >= MIN_BUSINESS_SUMMARY_CHARS &&
    !isBusinessSummaryIncomplete(current);

  if (userWritten && !opts?.force) return kit;
  if (!opts?.force && !isBusinessSummaryTooShort(current) && !isBusinessSummaryIncomplete(current)) {
    return kit;
  }

  const narrative = await generateDetailedBusinessNarrative({
    kit,
    summary,
    pageText: opts?.pageText,
    website: opts?.website,
  });

  if (!narrative.trim() || (current.length >= narrative.length && !opts?.force)) {
    return kit;
  }

  return {
    ...kit,
    businessSummary: narrative.trim(),
    sources: {
      ...kit.sources,
      businessSummary: userWritten ? "user" : "site",
    },
  };
}
