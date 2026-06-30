import { prisma } from "@/lib/db/prisma";
import type { BusinessInfo, BusinessSummary } from "@/lib/ai/agents/summarizeBusiness";
import { summarizeBusiness } from "@/lib/ai/agents/summarizeBusiness";
import type { PageFetchCache } from "@/lib/web/pageFetchCache";
import { normalizeDomain, isProjectScopedDomain } from "./domain";
import {
  getBusinessSummaryCache,
  type BrandKitStoredPayload,
} from "./mapFromSummary";
import { ensureDetailedBusinessSummaryOnKit } from "./generateBusinessNarrative";
import { extractFromSite } from "./extractFromSite";
import {
  createKit,
  findByDomain,
  getForProject,
  getProjectWithBrandKit,
  linkProjectToKit,
  backfillBrandKitFromProject,
  type BrandKitView,
  type BrandKitRecord,
} from "./store";

export type EnsureBrandKitResult =
  | {
      ok: true;
      cached: boolean;
      brandKit: BrandKitView;
      summary: BusinessSummary;
      reextracted: boolean;
      complete: boolean;
      missingFields: BrandKitView["missingFields"];
    }
  | { ok: false; error: string };

async function syncProjectBusinessContext(
  projectId: string,
  clientUrl: string,
  summary: BusinessSummary
): Promise<void> {
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
      clientUrl,
      businessSummary: summary as object,
      businessInfo: legacyInfo as object,
    },
  });
}

async function loadLinkedKitView(projectId: string): Promise<BrandKitView | null> {
  return getForProject(projectId);
}

function summaryFromKit(brandKit: BrandKitView): BusinessSummary {
  const cache = getBusinessSummaryCache(brandKit.kit as BrandKitStoredPayload);
  if (cache) return cache;
  return {
    businessName: brandKit.kit.businessName,
    whatTheyDo: brandKit.kit.themeWords,
    narrativeSummary: brandKit.kit.businessSummary || undefined,
    audience: brandKit.kit.audience,
    location: brandKit.kit.location,
    tone: brandKit.kit.tone,
    industry: brandKit.kit.businessType,
    products: [],
  };
}

async function attachCachedKit(
  projectId: string,
  clientUrl: string,
  record: Awaited<ReturnType<typeof findByDomain>>
): Promise<EnsureBrandKitResult | null> {
  if (!record) return null;

  await linkProjectToKit(projectId, record.id);

  const resolvedUrl = record.website ?? clientUrl;
  const summary = getBusinessSummaryCache(record.kit as BrandKitStoredPayload);
  if (summary) {
    await syncProjectBusinessContext(projectId, resolvedUrl, summary);
  } else {
    await prisma.project.update({
      where: { id: projectId },
      data: { clientUrl: resolvedUrl, brandKitId: record.id },
    });
  }

  const brandKit = await loadLinkedKitView(projectId);
  if (!brandKit) return { ok: false, error: "Could not load brand kit" };

  const kitSummary = summary ?? summaryFromKit(brandKit);

  return {
    ok: true,
    cached: true,
    brandKit,
    summary: kitSummary,
    reextracted: false,
    complete: brandKit.complete,
    missingFields: brandKit.missingFields,
  };
}

/**
 * Load or extract a client-scoped brand kit for a website URL.
 * Reuses an existing domain kit without re-fetching unless force is true.
 */
export async function ensureBrandKit(
  projectId: string,
  url: string,
  pageCache: PageFetchCache,
  opts?: { force?: boolean }
): Promise<EnsureBrandKitResult> {
  const domain = normalizeDomain(url);
  if (!domain) {
    return { ok: false, error: "Invalid website URL" };
  }

  const project = await getProjectWithBrandKit(projectId);
  if (!project) {
    return { ok: false, error: "Project not found" };
  }

  const existingByDomain = await findByDomain(domain);
  const linkedKit = await loadLinkedKitView(projectId);
  const projectUsesScopedKit = Boolean(linkedKit && isProjectScopedDomain(linkedKit.domain));

  if (!projectUsesScopedKit && !opts?.force && existingByDomain) {
    const cached = await attachCachedKit(projectId, url, existingByDomain);
    if (cached?.ok) return cached;
  }

  if (!projectUsesScopedKit && !opts?.force && linkedKit?.complete && linkedKit.domain === domain) {
    const cached = await attachCachedKit(projectId, url, existingByDomain ?? (await findByDomain(linkedKit.domain)));
    if (cached?.ok) return cached;
  }

  const summarized = await summarizeBusiness(projectId, url, pageCache);
  if (!summarized.ok) {
    return { ok: false, error: summarized.error };
  }

  const extracted = await extractFromSite(url, pageCache, summarized.summary);
  if ("error" in extracted) {
    return { ok: false, error: extracted.error };
  }

  const payload: BrandKitStoredPayload = {
    ...extracted.payload,
    businessSummaryCache: summarized.summary,
  };

  payload.businessSummary = summarized.summary.narrativeSummary ?? payload.businessSummary;
  const expandedPayload = await ensureDetailedBusinessSummaryOnKit(
    payload,
    summarized.summary,
    { website: extracted.finalUrl, force: Boolean(opts?.force) }
  );
  const finalPayload = {
    ...expandedPayload,
    businessSummaryCache: {
      ...summarized.summary,
      narrativeSummary: expandedPayload.businessSummary,
    },
  } as BrandKitStoredPayload;

  let saved: BrandKitRecord;
  if (projectUsesScopedKit && linkedKit) {
    await prisma.brandKit.update({
      where: { id: linkedKit.id },
      data: {
        website: extracted.finalUrl,
        kit: finalPayload as object,
      },
    });
    saved = (await findByDomain(linkedKit.domain))!;
  } else if (existingByDomain) {
    await prisma.brandKit.update({
      where: { id: existingByDomain.id },
      data: {
        website: extracted.finalUrl,
        kit: finalPayload as object,
      },
    });
    saved = (await findByDomain(domain))!;
  } else {
    saved = await createKit({
      domain,
      website: extracted.finalUrl,
      kit: finalPayload,
    });
  }

  await linkProjectToKit(projectId, saved.id);
  await syncProjectBusinessContext(projectId, extracted.finalUrl, {
    ...summarized.summary,
    narrativeSummary: finalPayload.businessSummary,
  });

  const brandKit = await loadLinkedKitView(projectId);
  if (!brandKit) {
    return { ok: false, error: "Could not save brand kit" };
  }

  return {
    ok: true,
    cached: Boolean(summarized.cached) && !opts?.force,
    brandKit,
    summary: summarized.summary,
    reextracted: Boolean(opts?.force),
    complete: brandKit.complete,
    missingFields: brandKit.missingFields,
  };
}

export async function getPlanningBrandContext(projectId: string) {
  await backfillBrandKitFromProject(projectId);
  const project = await getProjectWithBrandKit(projectId);
  const brandKit = await getForProject(projectId);
  const hasClientUrl = Boolean(project?.clientUrl?.trim());

  return {
    project,
    brandKit,
    hasClientUrl,
    hasWebsiteOnFile: Boolean(
      brandKit?.kit.website?.trim() || project?.clientUrl?.trim() || brandKit?.website
    ),
  };
}
