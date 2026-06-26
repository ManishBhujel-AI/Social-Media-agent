import { MODELS } from "../models.config";
import { openRouterChatJSON, openRouterChatText } from "../openrouter";
import type { ProductSummary } from "../productContext";
import {
  passesMarketingBriefQualityGate,
} from "../productContext";

export type MarketingBriefPayload = {
  whatItIs: string;
  whoItsFor: string;
  benefits: string[];
  problemsSolved: string[];
  marketingBrief: string;
  webResearchNotes?: string;
  researchQuery?: string;
};

const ANTI_HALLUCINATION_RULES = `CRITICAL RULES:
- Use ONLY facts explicitly stated in the provided context (site text, business summary, user paste).
- Do NOT invent specs, prices, service areas, audiences, or benefits.
- Do NOT describe product photos or guess from the product name alone.
- If context is too thin to write an accurate benefit-focused brief without guessing, return marketingBrief as "" and empty arrays for benefits and problemsSolved.`;

export function isMarketingSearchEnabled(): boolean {
  return process.env.MARKETING_SEARCH_ENABLED !== "0";
}

export function needsMarketingEnrichment(
  summary: ProductSummary,
  businessSummary?: unknown
): boolean {
  if (passesMarketingBriefQualityGate(summary.name, summary.marketingBrief)) return false;

  const desc = summary.description?.trim() ?? "";
  const hasBenefitLanguage = /\b(benefit|help|solve|customer|for\s+\w+|ideal\s+for|service)\b/i.test(
    desc
  );

  if (summary.descriptionSource === "vision") return true;
  if (!desc || desc.length < 60) return true;
  if ((summary.confidence ?? 0) < 0.6 && !hasBenefitLanguage) return true;
  if (!hasBenefitLanguage && !summary.marketingBrief) return true;

  const biz = businessSummary as { products?: { name: string; description?: string }[] } | null;
  const match = biz?.products?.find((p) =>
    p.name.toLowerCase().includes(summary.name.toLowerCase())
  );
  if (match?.description && match.description.length > 40) return false;

  return !hasBenefitLanguage;
}

function gatherKnownMarketingContext(
  summary: ProductSummary,
  businessSummary?: unknown,
  extraContext?: string
): string {
  const parts: string[] = [];

  const desc = summary.description?.trim() ?? "";
  if (desc && summary.descriptionSource !== "vision") {
    parts.push(`Product description: ${desc}`);
  }

  const biz = businessSummary as {
    businessName?: string;
    whatTheyDo?: string;
    narrativeSummary?: string;
    audience?: string;
    location?: string;
    products?: { name: string; description?: string }[];
  } | null;

  if (biz?.products?.length) {
    const match =
      biz.products.find((p) =>
        p.name.toLowerCase().includes(summary.name.toLowerCase())
      ) ??
      biz.products.find((p) =>
        summary.name.toLowerCase().includes(p.name.toLowerCase())
      );
    if (match?.description?.trim()) {
      parts.push(`Catalog entry (${match.name}): ${match.description.trim()}`);
    }
  }

  if (biz?.narrativeSummary?.trim()) {
    parts.push(`Business context: ${biz.narrativeSummary.trim().slice(0, 900)}`);
  } else if (biz?.whatTheyDo?.trim()) {
    parts.push(`What they do: ${biz.whatTheyDo.trim()}`);
  }

  if (biz?.audience?.trim()) parts.push(`Audience: ${biz.audience.trim()}`);
  if (biz?.location?.trim()) parts.push(`Location: ${biz.location.trim()}`);
  if (biz?.businessName?.trim()) parts.push(`Business: ${biz.businessName.trim()}`);

  if (summary.features?.length) {
    parts.push(`Features: ${summary.features.join(", ")}`);
  }
  if (summary.price?.trim()) parts.push(`Price: ${summary.price.trim()}`);

  if (extraContext?.trim()) {
    parts.push(`User-provided context: ${extraContext.trim()}`);
  }

  return parts.join("\n");
}

function hasMeaningfulKnownContext(knownContext: string): boolean {
  return knownContext.trim().length >= 50;
}

function buildSearchQuery(params: {
  productName: string;
  businessSummary?: unknown;
  clientUrl?: string | null;
}): string {
  const biz = params.businessSummary as {
    businessName?: string;
    whatTheyDo?: string;
    audience?: string;
    location?: string;
  } | null;
  const audience = biz?.audience ?? biz?.whatTheyDo ?? "";
  const location = biz?.location ?? "";
  const business = biz?.businessName ?? "";
  return `${params.productName} benefits for customers ${audience} ${location} ${business}`.trim();
}

function applyBriefPayload(
  summary: ProductSummary,
  payload: MarketingBriefPayload,
  source: "synthesized" | "search"
): ProductSummary | null {
  const brief = payload.marketingBrief?.trim() ?? "";
  if (!passesMarketingBriefQualityGate(summary.name, brief)) return null;
  return {
    ...summary,
    marketingBrief: brief,
    marketingSource: source,
    ...(payload.webResearchNotes?.trim()
      ? {
          webResearchNotes: payload.webResearchNotes.trim(),
          researchQuery: payload.researchQuery?.trim() || undefined,
        }
      : {}),
  };
}

export async function searchAndSynthesizeMarketingBrief(params: {
  productName: string;
  clientUrl?: string | null;
  businessSummary?: unknown;
  existingDescription?: string;
  visualContext?: string;
  extraContext?: string;
  knownContext?: string;
}): Promise<MarketingBriefPayload> {
  const query = buildSearchQuery(params);
  let searchNotes = "";

  if (isMarketingSearchEnabled()) {
    try {
      searchNotes = await openRouterChatText({
        model: MODELS.research.model,
        max_tokens: 1024,
        messages: [
          {
            role: "system",
            content:
              "You are a research assistant. Summarize factual information about this product or service for the named business: who it helps, key benefits, problems solved. Prefer the client's own site and listings. Be concise. Do not invent specifics.",
          },
          {
            role: "user",
            content: `Research query: ${query}\nClient site: ${params.clientUrl ?? "unknown"}\nKnown context: ${params.knownContext ?? params.existingDescription ?? "none"}`,
          },
        ],
      });
    } catch (err) {
      console.warn("[marketingBrief] search failed:", err);
    }
  }

  if (!searchNotes.trim()) {
    return {
      whatItIs: params.productName,
      whoItsFor: "",
      benefits: [],
      problemsSolved: [],
      marketingBrief: "",
      researchQuery: query,
    };
  }

  const synthesized = await openRouterChatJSON<MarketingBriefPayload>({
    model: MODELS.promptRefiner.model,
    messages: [
      {
        role: "system",
        content: `Create a marketing brief for social post copy from web research + known context. Return JSON:
{ "whatItIs", "whoItsFor", "benefits": string[2-3], "problemsSolved": string[], "marketingBrief": "3-5 sentences, benefit-focused, copy-ready" }
${ANTI_HALLUCINATION_RULES}
Web research must align with the named business/client site. Discard unverified claims. Focus on customer value.`,
      },
      {
        role: "user",
        content: JSON.stringify({
          productName: params.productName,
          clientUrl: params.clientUrl,
          knownContext: params.knownContext ?? params.existingDescription,
          webResearch: searchNotes,
          userProvidedContext: params.extraContext || undefined,
          businessSummary: params.businessSummary,
        }),
      },
    ],
  });

  return {
    whatItIs: synthesized.whatItIs?.trim() ?? params.productName,
    whoItsFor: synthesized.whoItsFor?.trim() ?? "",
    benefits: synthesized.benefits ?? [],
    problemsSolved: synthesized.problemsSolved ?? [],
    marketingBrief: synthesized.marketingBrief?.trim() ?? "",
    webResearchNotes: searchNotes.trim(),
    researchQuery: query,
  };
}

export async function synthesizeMarketingBriefLocal(params: {
  productName: string;
  description: string;
  businessSummary?: unknown;
  extraContext?: string;
}): Promise<MarketingBriefPayload> {
  return openRouterChatJSON<MarketingBriefPayload>({
    model: MODELS.promptRefiner.model,
    messages: [
      {
        role: "system",
        content: `Turn the provided product/business context into a benefit-focused marketing brief. Return JSON:
{ "whatItIs", "whoItsFor", "benefits": string[2-3], "problemsSolved": string[], "marketingBrief": "3-5 sentences" }
${ANTI_HALLUCINATION_RULES}`,
      },
      {
        role: "user",
        content: JSON.stringify({
          productName: params.productName,
          knownContext: params.description,
          businessSummary: params.businessSummary,
          extraContext: params.extraContext,
        }),
      },
    ],
  });
}

export async function enrichProductMarketingBrief(
  summary: ProductSummary,
  opts: {
    clientUrl?: string | null;
    businessSummary?: unknown;
    extraContext?: string;
    /** Project setting — run Perplexity even when local context is enough. */
    forceWebResearch?: boolean;
  }
): Promise<ProductSummary> {
  const forceSearch = Boolean(opts.forceWebResearch) && isMarketingSearchEnabled();

  if (!forceSearch && passesMarketingBriefQualityGate(summary.name, summary.marketingBrief)) {
    return summary;
  }

  if (!forceSearch && !needsMarketingEnrichment(summary, opts.businessSummary)) {
    if (passesMarketingBriefQualityGate(summary.name, summary.description)) {
      return {
        ...summary,
        marketingBrief: summary.description.trim(),
        marketingSource: summary.descriptionSource ?? "synthesized",
      };
    }
    return summary;
  }

  const knownContext = gatherKnownMarketingContext(
    summary,
    opts.businessSummary,
    opts.extraContext
  );

  try {
    if (forceSearch) {
      const searchPayload = await searchAndSynthesizeMarketingBrief({
        productName: summary.name,
        clientUrl: opts.clientUrl,
        businessSummary: opts.businessSummary,
        existingDescription: summary.description,
        visualContext: summary.visualContext,
        extraContext: opts.extraContext,
        knownContext,
      });
      const fromSearch = applyBriefPayload(summary, searchPayload, "search");
      if (fromSearch) return fromSearch;

      if (searchPayload.webResearchNotes?.trim()) {
        return {
          ...summary,
          webResearchNotes: searchPayload.webResearchNotes.trim(),
          researchQuery: searchPayload.researchQuery,
        };
      }
    }

    if (hasMeaningfulKnownContext(knownContext)) {
      const localPayload = await synthesizeMarketingBriefLocal({
        productName: summary.name,
        description: knownContext,
        businessSummary: opts.businessSummary,
        extraContext: opts.extraContext,
      });
      const fromLocal = applyBriefPayload(summary, localPayload, "synthesized");
      if (fromLocal) return fromLocal;
    }

    if (!forceSearch && isMarketingSearchEnabled()) {
      const searchPayload = await searchAndSynthesizeMarketingBrief({
        productName: summary.name,
        clientUrl: opts.clientUrl,
        businessSummary: opts.businessSummary,
        existingDescription: summary.description,
        visualContext: summary.visualContext,
        extraContext: opts.extraContext,
        knownContext,
      });
      const fromSearch = applyBriefPayload(summary, searchPayload, "search");
      if (fromSearch) return fromSearch;

      if (searchPayload.webResearchNotes?.trim()) {
        return {
          ...summary,
          webResearchNotes: searchPayload.webResearchNotes.trim(),
          researchQuery: searchPayload.researchQuery,
        };
      }
    }

    return summary;
  } catch (err) {
    console.warn("[marketingBrief] enrichment failed:", err);
    if (
      summary.description &&
      summary.descriptionSource !== "vision" &&
      passesMarketingBriefQualityGate(summary.name, summary.description)
    ) {
      return {
        ...summary,
        marketingBrief: summary.description.trim(),
        marketingSource: "synthesized",
      };
    }
    return summary;
  }
}
