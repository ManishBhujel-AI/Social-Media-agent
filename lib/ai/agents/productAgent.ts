import { MODELS } from "../models.config";
import { openRouterChatJSON } from "../openrouter";
import { prisma } from "@/lib/db/prisma";
import { getStorage } from "@/lib/storage";
import { createPageFetchCache, type PageFetchCache } from "@/lib/web/pageFetchCache";
import { analyzeHtmlPageWithBudget, withTimeBudget } from "@/lib/web/htmlParse";
import { isUsableProductImage } from "../productImageQuality";
import {
  descriptionQuestion,
  hasMarketingReadySummary,
  hasUsableWebResearch,
  isReliableProductDescription,
  previewProductInfoForAgent,
  type ProductSummary,
} from "../productContext";
import { enrichProductMarketingBrief } from "../research/marketingBrief";
import { getCaptionCorpus, extractProductRelevantFromCorpus } from "@/lib/content/captionCorpus";
import {
  collectMarketingResearchFromReferences,
  getReferencesForTask,
} from "@/lib/content/references";
import { getForProject } from "@/lib/brandKit/store";
import { buildClientResearchContext } from "@/lib/brandKit/clientResearchContext";
import { describeProductImage, extractProductContextFromImage } from "./visionAgent";
import { resolveSourceImages } from "@/lib/ai/resolveSourceImages";

export type { ProductSummary };

export type FindProductResult =
  | {
      found: true;
      summary: ProductSummary;
      imageUrl: string;
      imageSource: "user" | "site";
    }
  | {
      found: true;
      summary: ProductSummary;
      noUsableImage: true;
      reason: string;
      suggestedQuestion: string;
    }
  | {
      found: true;
      summary: ProductSummary;
      needsDescription: true;
      suggestedQuestion: string;
      imageUrl?: string;
      imageSource?: "user" | "site";
    }
  | { found: false; confidence: number; reason: string };

const FIND_PRODUCT_BUDGET_MS = 45_000;
const FIND_PRODUCT_WITH_IMAGES_BUDGET_MS = 30_000;
const RESEARCH_SETTLE_WAIT_MS = 12_000;
const MAX_PRODUCT_PAGES = 2;

const NO_IMAGE_QUESTION =
  'I couldn\'t find a good product photo on the website for this item. Upload a photo of this product, or reply "generate" and I\'ll design one from scratch.';

function buildNoImageResult(summary: ProductSummary, reason: string): FindProductResult {
  if (!hasMarketingReadySummary(summary)) {
    return buildNeedsDescriptionResult(summary);
  }
  return {
    found: true,
    summary,
    noUsableImage: true,
    reason,
    suggestedQuestion: NO_IMAGE_QUESTION,
  };
}

function buildNeedsDescriptionResult(
  summary: ProductSummary,
  opts?: { imageUrl?: string; imageSource?: "user" | "site" }
): FindProductResult {
  return {
    found: true,
    summary,
    needsDescription: true,
    suggestedQuestion: descriptionQuestion(summary.name),
    imageUrl: opts?.imageUrl,
    imageSource: opts?.imageSource,
  };
}

/** Agent-facing JSON — omits full webResearchNotes; writeCaption reads saved productSummary from DB. */
export function serializeFindProductResultForAgent(result: FindProductResult): object {
  if (!result.found) {
    return {
      found: false,
      readyForCaption: false,
      confidence: result.confidence,
      reason: result.reason,
    };
  }

  const ready = hasMarketingReadySummary(result.summary);
  const notesChars = result.summary.webResearchNotes?.trim().length ?? 0;
  const compact = {
    name: result.summary.name,
    productInfoPreview: previewProductInfoForAgent(result.summary),
    webResearchNotesChars: notesChars,
    marketingSource: result.summary.marketingSource,
    perplexityUsed: result.summary.perplexityUsed ?? false,
  };

  if ("needsDescription" in result && result.needsDescription) {
    return {
      found: true,
      readyForCaption: false,
      needsDescription: true,
      suggestedQuestion: result.suggestedQuestion,
      summary: compact,
      imageUrl: result.imageUrl,
      imageSource: result.imageSource,
    };
  }

  if ("noUsableImage" in result && result.noUsableImage) {
    return {
      found: true,
      readyForCaption: ready,
      noUsableImage: true,
      reason: result.reason,
      suggestedQuestion: result.suggestedQuestion,
      summary: compact,
      ...(ready
        ? { nextStep: "Product info is ready — after the user uploads a photo, call writeCaption() then makeGraphic()." }
        : {}),
    };
  }

  const withImage = result as Extract<FindProductResult, { imageUrl: string }>;
  return {
    found: true,
    readyForCaption: ready,
    needsDescription: false,
    productName: result.summary.name,
    productInfoSource: result.summary.marketingSource ?? "unknown",
    webResearchNotesChars: notesChars,
    hasUsableWebResearch: hasUsableWebResearch(result.summary.webResearchNotes),
    productInfoPreview: compact.productInfoPreview,
    imageUrl: withImage.imageUrl,
    imageSource: withImage.imageSource,
    nextStep: ready
      ? "Call writeCaption() then makeGraphic() now. Do NOT call askUser — product info is already saved."
      : undefined,
  };
}

async function persistProductSummary(
  taskId: string,
  summary: ProductSummary,
  imageUrl?: string | null
) {
  await prisma.task.update({
    where: { id: taskId },
    data: {
      productSummary: summary as object,
      ...(imageUrl !== undefined ? { productImageUrl: imageUrl } : {}),
    },
  });
}

async function resolveProductResearchHints(
  projectId: string,
  taskId: string,
  productName: string
): Promise<string> {
  const [corpus, taskRefs, brandKitView] = await Promise.all([
    getCaptionCorpus(projectId),
    getReferencesForTask(projectId, taskId),
    getForProject(projectId),
  ]);

  const parts: string[] = [];

  const productCorpus = extractProductRelevantFromCorpus(corpus, productName);
  if (productCorpus) {
    parts.push(
      `Past captions mentioning this product (facts only — not a substitute for product research):\n${productCorpus}`
    );
  }

  const snippetContext = collectMarketingResearchFromReferences(
    taskRefs.filter((r) => r.kind === "copy_snippet")
  );
  if (snippetContext.trim()) parts.push(snippetContext);

  if (brandKitView?.kit) {
    const ctx = buildClientResearchContext(brandKitView.kit, productName);
    if (ctx.productNote) parts.push(`Product note: ${ctx.productNote}`);
  }

  return parts.join("\n\n");
}

export async function finalizeSummary(
  taskId: string,
  summary: ProductSummary,
  opts: {
    clientUrl?: string | null;
    businessSummary?: unknown;
    imageUrl?: string | null;
    projectId?: string;
  }
): Promise<ProductSummary> {
  const taskRow = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      userProductNotes: true,
      project: { select: { id: true } },
    },
  });

  let clientReferencesContext = "";
  const projectId = opts.projectId ?? taskRow?.project.id;
  if (projectId) {
    clientReferencesContext = await resolveProductResearchHints(
      projectId,
      taskId,
      summary.name
    );
  }

  const brandKitView = projectId ? await getForProject(projectId) : null;
  const brandKitContext = brandKitView
    ? buildClientResearchContext(brandKitView.kit, summary.name)
    : undefined;

  const userProductNotes = taskRow?.userProductNotes?.trim() || undefined;

  const enriched = await enrichProductMarketingBrief(summary, {
    clientUrl: opts.clientUrl,
    businessSummary: opts.businessSummary,
    brandKitContext,
    clientReferencesContext: clientReferencesContext || undefined,
    userProductNotes,
  });
  await persistProductSummary(taskId, enriched, opts.imageUrl);
  return enriched;
}

/** Use saved captions, notes, and business context before slow vision/search. */
async function tryBriefFromSavedContext(
  taskId: string,
  productName: string,
  enrichOpts: {
    clientUrl?: string | null;
    businessSummary?: unknown;
    projectId?: string;
    imageUrl?: string | null;
  }
): Promise<ProductSummary> {
  return finalizeSummary(
    taskId,
    { name: productName, description: "", confidence: 0 },
    enrichOpts
  );
}

export async function mergeAndPersistUserProductNotes(params: {
  projectId: string;
  taskId: string;
  productName: string;
  text?: string;
  contextImageId?: string;
}): Promise<string> {
  const parts: string[] = [];
  if (params.text?.trim()) parts.push(params.text.trim());

  if (params.contextImageId) {
    const urls = await resolveSourceImages(params.projectId, [params.contextImageId]);
    if (urls[0]) {
      const facts = await extractProductContextFromImage(params.productName, urls[0]);
      if (facts) parts.push(facts);
    }
  }

  const merged = parts.join("\n\n").trim();
  if (!merged) return "";

  await prisma.task.update({
    where: { id: params.taskId },
    data: { userProductNotes: merged },
  });
  return merged;
}

/**
 * Fast photo-card submit — attach images and notes only.
 * Vision + marketing enrichment runs in the worker (findProduct), not while the UI waits.
 */
export async function prepareTaskImageSubmit(params: {
  projectId: string;
  taskId: string;
  imageIds?: string[];
  productNotes?: string;
  contextImageId?: string;
  message?: string;
}): Promise<string> {
  const notes = params.productNotes?.trim() ?? "";
  const urls = params.imageIds?.length
    ? await resolveSourceImages(params.projectId, params.imageIds)
    : [];

  const task = await prisma.task.findUniqueOrThrow({ where: { id: params.taskId } });

  if (params.imageIds?.length && !urls.length) {
    throw new Error(
      "Uploaded photos could not be found — please try uploading again before submitting."
    );
  }

  if (!urls.length) {
    await prisma.task.update({
      where: { id: params.taskId },
      data: {
        ...(notes ? { userProductNotes: notes } : {}),
      },
    });
    return JSON.stringify({
      choice: "generate",
      message: params.message?.trim() || notes || "User chose to design from scratch.",
      description: notes || undefined,
      userNotes: notes || undefined,
      pendingContextImageId: params.contextImageId,
    });
  }

  const existing = (task.sourceImages as string[] | null) ?? [];
  const mergedUrls = [...existing];
  for (const url of urls) {
    if (!mergedUrls.includes(url)) mergedUrls.push(url);
  }

  await prisma.task.update({
    where: { id: params.taskId },
    data: {
      sourceImages: mergedUrls as object,
      productImageUrl: mergedUrls[0] ?? task.productImageUrl,
      ...(notes ? { userProductNotes: notes } : {}),
    },
  });

  return JSON.stringify({
    choice: "upload",
    message:
      params.message?.trim() ||
      (urls.length > 1
        ? `User uploaded ${urls.length} product photos.`
        : "User uploaded a product photo."),
    imageUrls: urls,
    userNotes: notes || undefined,
    pendingContextImageId: params.contextImageId,
  });
}

export async function applyPendingContextImageNotes(params: {
  projectId: string;
  taskId: string;
  productName: string;
  contextImageId?: string;
}): Promise<void> {
  if (!params.contextImageId) return;
  await mergeAndPersistUserProductNotes({
    projectId: params.projectId,
    taskId: params.taskId,
    productName: params.productName,
    contextImageId: params.contextImageId,
  });
}

async function downloadUsableProductImage(
  pageCache: PageFetchCache,
  candidates: string[]
): Promise<string | null> {
  for (const imgSrc of candidates) {
    const asset = await pageCache.fetchAsset(imgSrc);
    if (!asset.ok) continue;
    if (!isUsableProductImage({ buffer: asset.buffer, mime: asset.mime, url: imgSrc })) continue;

    const saved = await getStorage().saveUpload(asset.buffer, asset.mime);
    return saved.url;
  }
  return null;
}

/** Vision on user photo(s) — visualContext only; marketing brief comes from user/site/search. */
export async function enrichSummaryFromUserImage(
  projectId: string,
  productName: string,
  imageUrl: string,
  existing?: ProductSummary | null
): Promise<ProductSummary> {
  if (existing?.visualContext && hasMarketingReadySummary(existing)) {
    return existing;
  }

  const uploaded = await prisma.uploadedImage.findFirst({
    where: { projectId, blobUrl: imageUrl },
  });
  if (
    uploaded?.description &&
    isReliableProductDescription(productName, uploaded.description)
  ) {
    return {
      name: productName,
      description: uploaded.description,
      confidence: uploaded.matchConfidence ?? 0.75,
      descriptionSource: "planning",
      marketingSource: "planning",
    };
  }

  const vision = await describeProductImage(productName, imageUrl);
  return {
    name: productName,
    description: "",
    visualContext: vision.visualContext,
    features: vision.features,
    confidence: vision.confidence,
    descriptionSource: "vision",
  };
}

/** Vision on every user-uploaded product photo for graphic grounding. */
export async function enrichSummaryFromUserImages(
  projectId: string,
  productName: string,
  imageUrls: string[],
  existing?: ProductSummary | null
): Promise<ProductSummary> {
  if (!imageUrls.length) {
    return (
      existing ?? {
        name: productName,
        description: "",
        confidence: 0,
      }
    );
  }

  let summary: ProductSummary =
    existing ?? {
      name: productName,
      description: "",
      confidence: 0,
    };

  const visualParts: string[] = [];
  const features = new Set(summary.features ?? []);

  for (let i = 0; i < imageUrls.length; i++) {
    const partial = await enrichSummaryFromUserImage(
      projectId,
      productName,
      imageUrls[i],
      i === 0 ? summary : null
    );
    if (partial.visualContext?.trim()) {
      visualParts.push(partial.visualContext.trim());
    }
    for (const f of partial.features ?? []) features.add(f);
    summary = {
      ...summary,
      confidence: Math.max(summary.confidence ?? 0, partial.confidence ?? 0),
      descriptionSource: partial.descriptionSource ?? summary.descriptionSource,
    };
  }

  if (visualParts.length === 1) {
    summary.visualContext = visualParts[0];
  } else if (visualParts.length > 1) {
    summary.visualContext = visualParts
      .map((part, idx) => `Photo ${idx + 1}: ${part}`)
      .join(" ");
  }

  if (features.size) summary.features = Array.from(features);
  return summary;
}

export async function applyUserProductDescription(
  taskId: string,
  productName: string,
  description: string
): Promise<ProductSummary> {
  const task = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    include: { project: true },
  });
  const existing = (task.productSummary as ProductSummary | null) ?? {
    name: productName,
    description: "",
    confidence: 0,
  };
  let summary: ProductSummary = {
    ...existing,
    name: productName,
    description: description.trim(),
    confidence: 1,
    descriptionSource: "user",
    marketingSource: "user",
  };
  summary = await finalizeSummary(taskId, summary, {
    clientUrl: task.project.clientUrl,
    businessSummary: task.businessSummary,
    imageUrl: task.productImageUrl,
    projectId: task.projectId,
  });
  const refreshed = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
  return (refreshed.productSummary as ProductSummary) ?? summary;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Research may finish and persist just after a time-budget fallback — read DB before asking the user. */
export async function reconcileFindProductResult(
  taskId: string,
  result: FindProductResult
): Promise<FindProductResult> {
  if (!("needsDescription" in result && result.needsDescription)) {
    return result;
  }

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      productSummary: true,
      sourceImages: true,
      productImageUrl: true,
    },
  });

  const summary = (task?.productSummary as ProductSummary | null) ?? result.summary;
  if (!hasMarketingReadySummary(summary)) {
    return result;
  }

  const images = (task?.sourceImages as string[] | null) ?? [];
  if (images.length > 0) {
    return {
      found: true,
      summary,
      imageUrl: images[0],
      imageSource: "user",
    };
  }

  if (task?.productImageUrl) {
    return {
      found: true,
      summary,
      imageUrl: task.productImageUrl,
      imageSource: "site",
    };
  }

  return buildNoImageResult(
    summary,
    "Product info found but no usable image on the website (too small, icon, or missing)"
  );
}

async function waitForPersistedMarketingResearch(
  taskId: string,
  result: FindProductResult
): Promise<FindProductResult> {
  if (!("needsDescription" in result && result.needsDescription)) {
    return result;
  }

  const deadline = Date.now() + RESEARCH_SETTLE_WAIT_MS;
  let latest = result;
  while (Date.now() < deadline) {
    latest = await reconcileFindProductResult(taskId, latest);
    if (!("needsDescription" in latest && latest.needsDescription)) {
      return latest;
    }
    await sleep(750);
  }

  return reconcileFindProductResult(taskId, latest);
}

export async function findProduct(
  taskId: string,
  productName: string
): Promise<FindProductResult> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { sourceImages: true },
  });
  const imageCount = ((task?.sourceImages as string[] | null) ?? []).length;
  const budgetMs =
    imageCount > 0 ? FIND_PRODUCT_WITH_IMAGES_BUDGET_MS : FIND_PRODUCT_BUDGET_MS;

  const timed = await withTimeBudget(
    budgetMs,
    () => findProductInner(taskId, productName),
    buildNeedsDescriptionResult({
      name: productName,
      description: "",
      confidence: 0,
    })
  );

  return waitForPersistedMarketingResearch(taskId, timed);
}

async function findProductInner(
  taskId: string,
  productName: string
): Promise<FindProductResult> {
  const task = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    include: { project: true },
  });

  const existingSummary = task.productSummary as ProductSummary | null;
  const existingImages = (task.sourceImages as string[] | null) ?? [];
  const enrichOpts = {
    clientUrl: task.project.clientUrl,
    businessSummary: task.businessSummary,
    projectId: task.projectId,
  };

  if (existingImages.length > 0) {
    const imageUrl = existingImages[0];

    const enrichedFromContext = await tryBriefFromSavedContext(taskId, productName, {
      ...enrichOpts,
      imageUrl,
    });
    if (hasMarketingReadySummary(enrichedFromContext)) {
      return {
        found: true,
        summary: enrichedFromContext,
        imageUrl,
        imageSource: "user",
      };
    }

    let summary = await enrichSummaryFromUserImages(
      task.projectId,
      productName,
      existingImages,
      existingSummary
    );
    summary = await finalizeSummary(taskId, summary, {
      ...enrichOpts,
      imageUrl,
    });

    if (!hasMarketingReadySummary(summary)) {
      return buildNeedsDescriptionResult(summary, { imageUrl, imageSource: "user" });
    }

    return {
      found: true,
      summary,
      imageUrl,
      imageSource: "user",
    };
  }

  const clientUrl = task.project.clientUrl;
  if (!clientUrl) {
    const summary = await finalizeSummary(
      taskId,
      {
        name: productName,
        description: existingSummary?.description ?? "",
        confidence: 0,
      },
      enrichOpts
    );
    return buildNeedsDescriptionResult(summary);
  }

  const pageCache = createPageFetchCache({ projectId: task.projectId });
  const home = await pageCache.fetchPageHtml(clientUrl);
  if (!home.ok) {
    const summary = await finalizeSummary(
      taskId,
      {
        name: productName,
        description: existingSummary?.description ?? "",
        confidence: 0,
      },
      enrichOpts
    );
    return buildNeedsDescriptionResult(summary);
  }

  const homeAnalysis = analyzeHtmlPageWithBudget(home.html, home.finalUrl);
  const links = homeAnalysis.internalLinks;
  const businessProducts =
    (task.businessSummary as { products?: { name: string; description?: string }[] } | null)
      ?.products ?? [];

  let ranked: { candidates: Array<{ url: string; score: number }> };
  try {
    ranked = await openRouterChatJSON<{
      candidates: Array<{ url: string; score: number }>;
    }>({
      model: MODELS.vision.model,
      messages: [
        {
          role: "system",
          content:
            'Rank URLs by how likely they are the product page for the given name. Return JSON: { "candidates": [{ "url", "score" 0-1 }] } top 3.',
        },
        {
          role: "user",
          content: `Product: ${productName}\nKnown products: ${JSON.stringify(businessProducts.map((p) => p.name))}\nURLs:\n${links.slice(0, 30).join("\n")}`,
        },
      ],
    });
  } catch {
    ranked = { candidates: [] };
  }

  const top = ranked.candidates?.filter((c) => c.score >= 0.4).slice(0, MAX_PRODUCT_PAGES) ?? [];

  let bestSummary: ProductSummary | null = null;

  for (const candidate of top) {
    const page = await pageCache.fetchPageHtml(candidate.url);
    if (!page.ok) continue;

    const analysis = analyzeHtmlPageWithBudget(page.html, page.finalUrl);
    if (!analysis.text.trim()) continue;

    let extracted: ProductSummary;
    try {
      extracted = await openRouterChatJSON<ProductSummary>({
        model: MODELS.vision.model,
        messages: [
          {
            role: "system",
            content:
              "Extract product info if this page is about the named product. Return JSON: name, description, features[], price?, pageUrl, confidence (0-1). Low confidence if wrong product.",
          },
          {
            role: "user",
            content: `Product sought: ${productName}\nURL: ${candidate.url}\n\n${analysis.text}`,
          },
        ],
      });
    } catch {
      continue;
    }

    if (extracted.confidence < 0.55) continue;

    const summary: ProductSummary = {
      ...extracted,
      name: productName,
      pageUrl: candidate.url,
      descriptionSource: "site",
    };

    const imageUrl = await downloadUsableProductImage(pageCache, analysis.imageSrcs);

    if (imageUrl) {
      const finalized = await finalizeSummary(taskId, summary, { ...enrichOpts, imageUrl });
      if (!hasMarketingReadySummary(finalized)) {
        return buildNeedsDescriptionResult(finalized, { imageUrl, imageSource: "site" });
      }
      return { found: true, summary: finalized, imageUrl, imageSource: "site" };
    }

    if (!bestSummary || extracted.confidence > bestSummary.confidence) {
      bestSummary = summary;
    }
  }

  if (!bestSummary && businessProducts.length) {
    const match = businessProducts.find((p) =>
      p.name.toLowerCase().includes(productName.toLowerCase())
    );
    if (match?.description && isReliableProductDescription(productName, match.description)) {
      bestSummary = {
        name: productName,
        description: match.description,
        confidence: 0.55,
        descriptionSource: "site",
      };
    }
  }

  if (bestSummary) {
    const finalized = await finalizeSummary(taskId, bestSummary, { ...enrichOpts, imageUrl: null });
    if (!hasMarketingReadySummary(finalized)) {
      return buildNeedsDescriptionResult(finalized);
    }
    return buildNoImageResult(
      finalized,
      "Product info found but no usable image on the website (too small, icon, or missing)"
    );
  }

  const summary = await finalizeSummary(
    taskId,
    {
      name: productName,
      description: existingSummary?.description ?? "",
      confidence: top[0]?.score ?? 0,
    },
    enrichOpts
  );
  return buildNeedsDescriptionResult(summary);
}

/** @deprecated Use analyzeHtmlPage from htmlParse */
export function collectProductImageCandidates(html: string, pageUrl: string): string[] {
  return analyzeHtmlPageWithBudget(html, pageUrl).imageSrcs;
}
