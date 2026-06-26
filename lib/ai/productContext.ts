export type MarketingSource = "site" | "vision" | "user" | "search" | "synthesized" | "planning";

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
  /** Benefit-focused copy input for caption and graphic agents */
  marketingBrief?: string;
  marketingSource?: MarketingSource;
  /** Raw Perplexity / Sonar notes when marketingSource is search */
  webResearchNotes?: string;
  researchQuery?: string;
};

export const MIN_PRODUCT_DESCRIPTION_LENGTH = 24;
const MIN_MARKETING_BRIEF_LENGTH = 40;

const BENEFIT_SIGNALS =
  /\b(benefit|help|solve|customer|client|contractor|rent|rental|service|for\s+\w+\s+who|ideal\s+for|perfect\s+for)\b/i;

export function descriptionQuestion(productName: string): string {
  return `Tell me briefly what ${productName} is so I describe it correctly.`;
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

/** Stricter than length-only — blocks generic or name-only briefs before captions run. */
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

/** Vision-only descriptions must not satisfy the marketing gate. */
export function hasMarketingReadySummary(summary: ProductSummary | null): boolean {
  if (!summary) return false;
  if (passesMarketingBriefQualityGate(summary.name, summary.marketingBrief)) return true;
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
  if (summary?.description || summary?.marketingBrief) return summary;

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

export function getMarketingBriefText(summary: ProductSummary | null): string | null {
  if (!summary) return null;
  if (summary.marketingBrief?.trim()) return summary.marketingBrief.trim();
  if (summary.descriptionSource === "vision") return null;
  if (isReliableProductDescription(summary.name, summary.description)) {
    return summary.description.trim();
  }
  return null;
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

export function formatMarketingBriefForPrompt(ctx: {
  name: string;
  marketingBrief: string;
}): string {
  return `Product/service: ${ctx.name}
Marketing brief (use for benefit-led copy — do NOT describe the product photo):
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
  if (!ctx.hasReliableMarketingBrief || !ctx.marketingBrief) {
    throw new MissingMarketingBriefError(ctx.name);
  }
  return { name: ctx.name, marketingBrief: ctx.marketingBrief, summary: ctx.summary };
}

export type ProductResearchInfo = {
  title: string;
  source: MarketingSource | "none";
  query?: string;
  notes?: string;
  brief?: string;
  detail?: string;
};

const MARKETING_SOURCE_LABELS: Record<MarketingSource, string> = {
  search: "Perplexity Sonar",
  site: "Client website",
  user: "Your reply",
  planning: "Brief / planning",
  synthesized: "Site + business context",
  vision: "Photo vision only",
};

export function getProductResearchInfo(productSummary: unknown): ProductResearchInfo | null {
  const summary = productSummary as ProductSummary | null;
  if (!summary) return null;

  const notes = summary.webResearchNotes?.trim();
  const query = summary.researchQuery?.trim();
  const brief = summary.marketingBrief?.trim();
  const source = summary.marketingSource;

  if (source === "search") {
    return {
      title: "Perplexity research",
      source: "search",
      query,
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
