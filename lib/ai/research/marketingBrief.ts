import { MODELS } from "../models.config";
import { openRouterChatTextWithCitations, type OpenRouterCitation } from "../openrouter";
import type { ProductSummary } from "../productContext";
import { isReliableProductDescription } from "../productContext";
import type { ClientResearchContext } from "@/lib/brandKit/clientResearchContext";
import { formatClientResearchContextForPrompt } from "@/lib/brandKit/clientResearchContext";

const PRODUCT_RESEARCH_RULES = `You are researching ONE specific product/service for ONE client's social post — not writing a general business overview.

SINGLE PRODUCT ONLY (critical):
- Research ONLY the one product/service named in the user message.
- Do NOT write social posts, captions, or finished marketing copy.
- Do NOT return a multi-product roundup, numbered posts, or sections for other products from the client's catalog.
- Output factual research notes (short paragraphs and bullets) for copywriters — not a ready-to-publish post.

Answer for this client and their audience only:
1. What is this product/service?
2. How does this client (the named business) offer, stock, or position it?
3. How does it help this client's customers in their real work or buying decisions?
4. What pain points, risks, or frustrations does it solve for those customers?

The same product means different pain points for different audiences (e.g. air filters for HVAC contractors = job quality, fewer callbacks, reliable stock; for homeowners = indoor air comfort).
Prefer the client's own site and listings. Do not invent specs, prices, or claims.`;

export function isMarketingSearchEnabled(): boolean {
  return process.env.MARKETING_SEARCH_ENABLED !== "0";
}

function gatherProductFactsContext(
  summary: ProductSummary,
  businessSummary?: unknown,
  productHints?: string
): string {
  const parts: string[] = [];

  const desc = summary.description?.trim() ?? "";
  if (desc && summary.descriptionSource !== "vision") {
    parts.push(`Product page/catalog description: ${desc}`);
  }

  const biz = businessSummary as {
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

  if (summary.features?.length) {
    parts.push(`Features: ${summary.features.join(", ")}`);
  }
  if (summary.price?.trim()) parts.push(`Price: ${summary.price.trim()}`);
  if (productHints?.trim()) parts.push(productHints.trim());

  return parts.join("\n");
}

function buildSearchQuery(params: {
  productName: string;
  brandKitContext?: ClientResearchContext;
  businessSummary?: unknown;
  clientUrl?: string | null;
}): string {
  const ctx = params.brandKitContext;
  const biz = params.businessSummary as {
    businessName?: string;
    whatTheyDo?: string;
    audience?: string;
    location?: string;
  } | null;

  const businessName = ctx?.businessName || biz?.businessName || "";
  const audience = ctx?.audience || biz?.audience || biz?.whatTheyDo || "";
  const businessType = ctx?.businessType || "";
  const location = ctx?.location || biz?.location || "";

  return [
    params.productName,
    "what is",
    businessName ? `at ${businessName}` : "",
    "how helps",
    audience ? `${audience} customers` : "customers",
    "pain points benefits",
    businessType,
    location,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
}

async function runProductWebResearch(params: {
  productName: string;
  clientUrl?: string | null;
  brandKitContext?: ClientResearchContext;
  knownContext?: string;
}): Promise<{
  notes: string;
  query: string;
  citations: OpenRouterCitation[];
  perplexityUsed: boolean;
}> {
  const query = buildSearchQuery(params);
  const clientBlock = params.brandKitContext
    ? formatClientResearchContextForPrompt(params.brandKitContext)
    : "";

  if (!isMarketingSearchEnabled()) {
    return { notes: "", query, citations: [], perplexityUsed: false };
  }

  try {
    const { text, citations } = await openRouterChatTextWithCitations({
      model: MODELS.research.model,
      max_tokens: 1024,
      messages: [
        {
          role: "system",
          content: `You are a research assistant. ${PRODUCT_RESEARCH_RULES}`,
        },
        {
          role: "user",
          content: [
            `Product/service to research: ${params.productName}`,
            clientBlock
              ? `Client (frame research for their business and customers):\n${clientBlock}`
              : "",
            `Research questions (for "${params.productName}" ONLY — ignore other products):
- What is "${params.productName}"?
- How does ${clientBlock ? "this client" : "the named business"} relate to or offer it?
- How does it help their customers?
- What pain points does it solve for those customers?`,
            `Client site: ${params.clientUrl ?? "unknown"}`,
            `Already known about "${params.productName}" only (not other catalog items): ${params.knownContext ?? "none"}`,
            `Return research notes for "${params.productName}" only. No captions. No posts for other products.`,
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ],
    });
    return { notes: text.trim(), query, citations, perplexityUsed: true };
  } catch (err) {
    console.warn("[marketingBrief] search failed:", err);
    return { notes: "", query, citations: [], perplexityUsed: true };
  }
}

export async function enrichProductMarketingBrief(
  summary: ProductSummary,
  opts: {
    clientUrl?: string | null;
    businessSummary?: unknown;
    brandKitContext?: ClientResearchContext;
    clientReferencesContext?: string;
    userProductNotes?: string;
  }
): Promise<ProductSummary> {
  const productFacts = gatherProductFactsContext(
    summary,
    opts.businessSummary,
    [opts.clientReferencesContext?.trim(), opts.userProductNotes?.trim()]
      .filter(Boolean)
      .join("\n\n")
  );

  try {
    if (isMarketingSearchEnabled()) {
      const { notes, query, citations, perplexityUsed } = await runProductWebResearch({
        productName: summary.name,
        clientUrl: opts.clientUrl,
        brandKitContext: opts.brandKitContext,
        knownContext: productFacts,
      });

      if (notes) {
        return {
          ...summary,
          webResearchNotes: notes,
          webResearchCitations: citations.length ? citations : undefined,
          researchQuery: query,
          perplexityUsed,
          marketingSource: "search",
        };
      }

      if (perplexityUsed) {
        return {
          ...summary,
          researchQuery: query,
          webResearchCitations: citations.length ? citations : undefined,
          perplexityUsed: true,
        };
      }
    }

    if (
      summary.description?.trim() &&
      summary.descriptionSource !== "vision" &&
      isReliableProductDescription(summary.name, summary.description)
    ) {
      return {
        ...summary,
        marketingSource: summary.marketingSource ?? summary.descriptionSource ?? "site",
      };
    }

    return summary;
  } catch (err) {
    console.warn("[marketingBrief] enrichment failed:", err);
    return summary;
  }
}
