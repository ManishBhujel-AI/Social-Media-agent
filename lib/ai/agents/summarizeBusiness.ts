import { MODELS } from "../models.config";
import { openRouterChatJSON } from "../openrouter";
import { prisma } from "@/lib/db/prisma";
import { getStorage } from "@/lib/storage";
import type { PageFetchCache } from "@/lib/web/pageFetchCache";
import { fetchBrandContextPages } from "@/lib/web/brandContextPages";
import { withTimeBudget } from "@/lib/web/htmlParse";
import { BUSINESS_SUMMARY_WRITING_INSTRUCTIONS, generateDetailedBusinessNarrative } from "@/lib/brandKit/generateBusinessNarrative";

/** Legacy shape kept for caption pipeline compatibility. */
export type BusinessInfo = {
  businessName: string;
  tagline?: string;
  tone?: string;
  industry?: string;
  products: Array<{ name: string; description?: string; price?: string; imageUrl?: string }>;
};

export type BusinessSummary = {
  businessName: string;
  whatTheyDo: string;
  /** Rich multi-sentence summary for caption and graphic agents. */
  narrativeSummary?: string;
  audience?: string;
  location?: string;
  tone?: string;
  industry?: string;
  products: Array<{ name: string; description?: string }>;
};

export type SummarizeBusinessResult =
  | { ok: true; summary: BusinessSummary; cached?: boolean }
  | { ok: false; error: string };

export type FetchPageResult =
  | { ok: true; html: string; text: string; finalUrl: string }
  | { ok: false; error: string };

const SUMMARIZE_BUDGET_MS = 12_000;
const MAX_SCRAPED_IMAGES = 6;

/** Homepage + About page (when linked) for brand kit extraction. */
export async function fetchAndAnalyzePage(
  pageCache: PageFetchCache,
  url: string
): Promise<FetchPageResult> {
  return fetchBrandContextPages(pageCache, url);
}

async function saveScrapedImages(
  projectId: string,
  imageSrcs: string[],
  pageCache: PageFetchCache
): Promise<void> {
  for (const absolute of imageSrcs.slice(0, MAX_SCRAPED_IMAGES)) {
    try {
      const asset = await pageCache.fetchAsset(absolute);
      if (!asset.ok) continue;
      const saved = await getStorage().saveUpload(asset.buffer, asset.mime);
      await prisma.uploadedImage.create({
        data: { projectId, blobUrl: saved.url, mime: asset.mime },
      });
    } catch {
      /* best-effort */
    }
  }
}

export async function summarizeBusiness(
  projectId: string,
  url: string,
  pageCache: PageFetchCache
): Promise<SummarizeBusinessResult> {
  return withTimeBudget(
    SUMMARIZE_BUDGET_MS,
    async () => {
      const project = await prisma.project.findUnique({ where: { id: projectId } });
      if (project?.businessSummary && project.clientUrl === url) {
        return {
          ok: true as const,
          summary: project.businessSummary as BusinessSummary,
          cached: true,
        };
      }

      const fetched = await fetchAndAnalyzePage(pageCache, url);
      if (!fetched.ok) {
        return { ok: false as const, error: fetched.error };
      }

      try {
        const summary = await openRouterChatJSON<BusinessSummary>({
          model: MODELS.vision.model,
          messages: [
            {
              role: "system",
              content:
                `Summarize this business from website text for a social content team. Return JSON: businessName, whatTheyDo (one-line tagline), narrativeSummary (${BUSINESS_SUMMARY_WRITING_INSTRUCTIONS}), audience (who their customers are — be specific), location (all cities, branches, islands, or regions served — comma-separated if multiple), tone, industry, products[{name,description}] — list real products and services with short descriptions.`,
            },
            { role: "user", content: `URL: ${fetched.finalUrl}\n\n${fetched.text.slice(0, 18_000)}` },
          ],
        });

        const kitSeed = {
          businessName: summary.businessName,
          businessType: summary.industry ?? "",
          audience: summary.audience ?? "",
          location: summary.location ?? "",
          tone: summary.tone ?? "",
          heritage: "",
          themeWords: summary.whatTheyDo ?? "",
          contact: "",
          businessSummary: summary.narrativeSummary ?? summary.whatTheyDo ?? "",
        };

        const detailedNarrative = await generateDetailedBusinessNarrative({
          kit: kitSeed,
          summary,
          pageText: fetched.text,
          website: fetched.finalUrl,
        });

        summary.narrativeSummary = detailedNarrative;

        const legacyInfo: BusinessInfo = {
          businessName: summary.businessName,
          tagline: summary.whatTheyDo,
          tone: summary.tone,
          industry: summary.industry,
          products: summary.products,
        };

        await prisma.project.update({
          where: { id: projectId },
          data: {
            clientUrl: url,
            businessSummary: summary as object,
            businessInfo: legacyInfo as object,
          },
        });

        // (Removed homepage image scraping — unused now that images come from per-post photo cards;
        // it was downloading up to 6 images and blowing the time budget → false failures.)
        return { ok: true as const, summary };
      } catch {
        return { ok: false as const, error: "couldn't read the site" };
      }
    },
    { ok: false as const, error: "couldn't read the site" }
  );
}
