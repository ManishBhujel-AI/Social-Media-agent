export type MarketingSource = "site" | "vision" | "user" | "search" | "synthesized" | "planning";

export type ResearchCitation = {
  url: string;
  title?: string;
};

export type ProductSummary = {
  name: string;
  description: string;
  features?: string[];
  price?: string;
  pageUrl?: string;
  confidence: number;
  descriptionSource?: MarketingSource;
  /** 1–2 lines from vision — graphic/grounding only, never for captions */
  visualContext?: string;
  /** Legacy synthesized brief — caption path prefers webResearchNotes or description */
  marketingBrief?: string;
  marketingSource?: MarketingSource;
  /** Raw Perplexity / Sonar notes when marketingSource is search */
  webResearchNotes?: string;
  /** Source URLs returned by Perplexity Sonar via OpenRouter annotations. */
  webResearchCitations?: ResearchCitation[];
  researchQuery?: string;
  /** True when Sonar was called this enrichment pass (even if brief came from user/local). */
  perplexityUsed?: boolean;
};

export const MIN_MARKETING_BRIEF_LENGTH = 40;
export const MIN_PRODUCT_DESCRIPTION_LENGTH = 24;
/** Raw Perplexity notes at least this long (with product/benefit signals) count as sufficient research. */
export const MIN_PRODUCT_RESEARCH_NOTES_CHARS = 200;

const BENEFIT_SIGNALS =
  /\b(benefit|help|solve|customer|client|contractor|technician|for\s+\w+\s+who|ideal\s+for|perfect\s+for|eliminates|reduces|faster|saves|save|reliable|pain|leak|callback|margin|stock|local|install|connection|fitting)\b/i;

const STOP_WORDS = new Set(["max", "service", "product", "system", "line"]);

export function productNameTokens(productName: string): string[] {
  return productName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
}

export function hasUsableWebResearch(notes: string | undefined | null): boolean {
  return (notes?.trim().length ?? 0) >= MIN_PRODUCT_RESEARCH_NOTES_CHARS;
}

export function hasSubstantialProductResearch(
  notes: string | undefined | null,
  productName: string
): boolean {
  if (!hasUsableWebResearch(notes)) return false;
  const text = notes!.trim();
  const lower = text.toLowerCase();
  const tokens = productNameTokens(productName);
  const mentionsProduct = tokens.length === 0 || tokens.some((t) => lower.includes(t));
  return mentionsProduct && BENEFIT_SIGNALS.test(text);
}

export function descriptionQuestion(productName: string): string {
  return `I couldn't find enough product info for ${productName} from web research or your saved content. In a sentence or two, what is it and who is it for for your customers?`;
}

export function isProductDescriptionQuestion(question: string | null | undefined): boolean {
  return Boolean(question?.includes("couldn't find enough product info"));
}

export function isReliableProductDescription(
  productName: string,
  description?: string | null
): boolean {
  if (!description?.trim()) return false;
  const d = description.trim();
  const dLower = d.toLowerCase();
  const nameLower = productName.trim().toLowerCase();
  if (d.length < MIN_PRODUCT_DESCRIPTION_LENGTH) return false;
  if (dLower === nameLower) return false;
  if (dLower === `${nameLower} product` || dLower === `product: ${nameLower}`) return false;
  return true;
}

export function isReliableMarketingBrief(brief?: string | null): boolean {
  if (!brief?.trim()) return false;
  return brief.trim().length >= MIN_MARKETING_BRIEF_LENGTH;
}
export function passesMarketingBriefQualityGate(
  productName: string,
  brief?: string | null
): boolean {
  if (!isReliableMarketingBrief(brief)) return false;
  const b = brief!.trim();
  if (!BENEFIT_SIGNALS.test(b)) return false;

  const nameLower = productName.trim().toLowerCase();
  const bLower = b.toLowerCase();
  if (bLower === nameLower) return false;
  if (bLower === `${nameLower} product` || bLower === `product: ${nameLower}`) return false;

  return true;
}

/** Brief must be about this product — not a generic business-wide intro. */
export function isProductFocusedBrief(productName: string, brief?: string | null): boolean {
  if (!passesMarketingBriefQualityGate(productName, brief)) return false;
  const b = brief!.toLowerCase();
  const tokens = productNameTokens(productName);
  if (!tokens.length) return true;
  return tokens.some((t) => b.includes(t));
}

export function hasMarketingReadySummary(summary: ProductSummary | null): boolean {
  if (!summary) return false;
  if (hasUsableWebResearch(summary.webResearchNotes)) return true;
  if (summary.marketingSource === "user" && isReliableProductDescription(summary.name, summary.description)) {
    return true;
  }
  if (isProductFocusedBrief(summary.name, summary.marketingBrief)) return true;
  if (summary.descriptionSource === "vision") return false;
  return (
    isReliableProductDescription(summary.name, summary.description) &&
    BENEFIT_SIGNALS.test(summary.description)
  );
}

export function getStoredProductSummary(task: {
  productSummary: unknown;
  productInfo: unknown;
  subject: string;
  title: string;
}): ProductSummary | null {
  const summary = task.productSummary as ProductSummary | null;
  if (summary?.description || summary?.marketingBrief || summary?.webResearchNotes) return summary;

  const info = task.productInfo as { name?: string; description?: string } | null;
  if (info?.description) {
    return {
      name: info.name ?? task.subject ?? task.title,
      description: info.description,
      confidence: 0.5,
    };
  }

  return summary;
}

export function getProductName(task: {
  subject: string;
  title: string;
  productInfo: unknown;
  productSummary: unknown;
}): string {
  const summary = task.productSummary as ProductSummary | null;
  const info = task.productInfo as { name?: string } | null;
  return summary?.name ?? info?.name ?? task.subject ?? task.title;
}

export function getProductCopyContext(task: {
  subject: string;
  title: string;
  productInfo: unknown;
  productSummary: unknown;
}): {
  name: string;
  description: string | null;
  hasReliableDescription: boolean;
  summary: ProductSummary | null;
} {
  const name = getProductName(task);
  const summary = getStoredProductSummary(task);
  const description = summary?.description?.trim() ?? null;
  return {
    name,
    description,
    hasReliableDescription: isReliableProductDescription(name, description),
    summary,
  };
}

/** Short preview for agent tool results — not the full research blob passed to writeCaption. */
export function previewProductInfoForAgent(summary: ProductSummary): string {
  const notes = summary.webResearchNotes?.trim();
  if (notes && hasUsableWebResearch(notes)) {
    return notes.length > 400 ? `${notes.slice(0, 400)}…` : notes;
  }
  const desc = summary.description?.trim();
  if (desc && summary.descriptionSource !== "vision") {
    return desc.length > 400 ? `${desc.slice(0, 400)}…` : desc;
  }
  return "";
}

export function getProductInfoForCaption(summary: ProductSummary | null): string | null {
  if (!summary) return null;
  const notes = summary.webResearchNotes?.trim();
  if (notes && hasUsableWebResearch(notes)) return notes;
  if (summary.marketingSource === "user" && summary.description?.trim()) {
    return summary.description.trim();
  }
  if (summary.descriptionSource !== "vision" && isReliableProductDescription(summary.name, summary.description)) {
    return summary.description.trim();
  }
  if (summary.marketingBrief?.trim()) return summary.marketingBrief.trim();
  return null;
}

export function getMarketingBriefText(summary: ProductSummary | null): string | null {
  return getProductInfoForCaption(summary);
}

export function getMarketingCopyContext(task: {
  subject: string;
  title: string;
  productInfo: unknown;
  productSummary: unknown;
}): {
  name: string;
  marketingBrief: string | null;
  hasReliableMarketingBrief: boolean;
  summary: ProductSummary | null;
} {
  const name = getProductName(task);
  const summary = getStoredProductSummary(task);
  const marketingBrief = getMarketingBriefText(summary);
  return {
    name,
    marketingBrief,
    hasReliableMarketingBrief: hasMarketingReadySummary(summary),
    summary,
  };
}

export function formatProductContextForPrompt(ctx: {
  name: string;
  description: string;
}): string {
  return `Product name: ${ctx.name}
Product description (factual):
${ctx.description}`;
}

export function formatProductInfoForPrompt(ctx: {
  name: string;
  summary: ProductSummary | null;
}): string {
  const info = getProductInfoForCaption(ctx.summary);
  if (!info) {
    throw new MissingMarketingBriefError(ctx.name);
  }

  const fromPerplexity =
    ctx.summary?.marketingSource === "search" &&
    hasUsableWebResearch(ctx.summary.webResearchNotes);

  if (fromPerplexity) {
    return `POST TOPIC — write this post about this product/service only:
Product/service: ${ctx.name}

Product info from Perplexity research (use these facts — do not invent beyond this):
${info}`;
  }

  return `POST TOPIC — write this post about this product/service only:
Product/service: ${ctx.name}

Product info:
${info}`;
}

/** @deprecated Use formatProductInfoForPrompt */
export function formatMarketingBriefForPrompt(ctx: {
  name: string;
  marketingBrief: string;
}): string {
  return `POST TOPIC — write this post about this product/service only:
Product/service: ${ctx.name}

Product info:
${ctx.marketingBrief}`;
}

/** Graphic/image agents only — never pass to caption path. */
export function formatVisualContextForPrompt(visualContext?: string | null): string {
  if (!visualContext?.trim()) return "";
  return `Visual reference (internal — match product in graphic only, do not put in caption text):
${visualContext.trim()}`;
}

export function formatUserProductNotesForPrompt(notes?: string | null): string {
  if (!notes?.trim()) return "";
  return `POST-SPECIFIC USER NOTES (this post only — treat as facts; do not invent beyond this):
${notes.trim()}`;
}

export class MissingProductDescriptionError extends Error {
  constructor(productName: string) {
    super(`No reliable product description for "${productName}" — ask the user first`);
    this.name = "MissingProductDescriptionError";
  }
}

export class MissingMarketingBriefError extends Error {
  constructor(productName: string) {
    super(`No marketing brief for "${productName}" — ask the user or enrich context first`);
    this.name = "MissingMarketingBriefError";
  }
}

export function requireProductCopyContext(task: {
  subject: string;
  title: string;
  productInfo: unknown;
  productSummary: unknown;
}): { name: string; description: string; summary: ProductSummary | null } {
  const ctx = getProductCopyContext(task);
  if (!ctx.hasReliableDescription || !ctx.description) {
    throw new MissingProductDescriptionError(ctx.name);
  }
  return { name: ctx.name, description: ctx.description, summary: ctx.summary };
}

export function requireMarketingCopyContext(task: {
  subject: string;
  title: string;
  productInfo: unknown;
  productSummary: unknown;
}): { name: string; marketingBrief: string; summary: ProductSummary | null } {
  const ctx = getMarketingCopyContext(task);
  const productInfo = getProductInfoForCaption(ctx.summary);
  if (!ctx.hasReliableMarketingBrief || !productInfo) {
    throw new MissingMarketingBriefError(ctx.name);
  }
  return { name: ctx.name, marketingBrief: productInfo, summary: ctx.summary };
}

export type ProductResearchInfo = {
  title: string;
  source: MarketingSource | "none";
  query?: string;
  citations?: ResearchCitation[];
  notes?: string;
  brief?: string;
  detail?: string;
};

const MARKETING_SOURCE_LABELS: Record<MarketingSource, string> = {
  search: "Perplexity Sonar",
  site: "Client website",
  user: "Your reply",
  planning: "Saved client content",
  synthesized: "Site + business context",
  vision: "Photo vision only",
};

export function getProductResearchInfo(productSummary: unknown): ProductResearchInfo | null {
  const summary = productSummary as ProductSummary | null;
  if (!summary) return null;

  const notes = summary.webResearchNotes?.trim();
  const query = summary.researchQuery?.trim();
  const citations = summary.webResearchCitations?.length
    ? summary.webResearchCitations
    : undefined;
  const brief = summary.marketingBrief?.trim();
  const source = summary.marketingSource;
  const perplexityRan = Boolean(notes || citations?.length || summary.perplexityUsed);

  if (perplexityRan) {
    const briefSource = source && source !== "search" ? MARKETING_SOURCE_LABELS[source] : null;
    return {
      title: "Perplexity research",
      source: "search",
      query,
      citations,
      notes,
      brief,
      detail: briefSource
        ? `Perplexity ran for research; product info from ${briefSource}.`
        : notes
          ? undefined
          : "Perplexity ran but returned no usable notes.",
    };
  }

  if (source === "search") {
    return {
      title: "Perplexity research",
      source: "search",
      query,
      citations,
      notes,
      brief,
      detail: notes
        ? undefined
        : brief
          ? "Perplexity was used; raw notes were not saved for this post (re-run the post to capture them)."
          : "Perplexity ran but returned no usable notes.",
    };
  }

  if (source) {
    return {
      title: "Product research",
      source,
      brief,
      detail: `No Perplexity call — brief from ${MARKETING_SOURCE_LABELS[source]}.`,
    };
  }

  if (brief) {
    return {
      title: "Product research",
      source: "none",
      brief,
      detail: "Marketing brief saved (source not recorded).",
    };
  }

  return null;
}
