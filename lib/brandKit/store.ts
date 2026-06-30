import { prisma } from "@/lib/db/prisma";
import { applyDefaultedFields, createEmptyBrandKitData } from "./defaults";
import {
  brandKitFromBusinessSummary,
  getBusinessSummaryCache,
  type BrandKitStoredPayload,
} from "./mapFromSummary";
import type { BusinessSummary } from "@/lib/ai/agents/summarizeBusiness";
import { normalizeDomain } from "./domain";
import { projectScopedDomain } from "./domain";
import { attachBusinessSummaryToKit } from "./businessSummaryNarrative";
import {
  ensureDetailedBusinessSummaryOnKit,
  isBusinessSummaryIncomplete,
  isBusinessSummaryTooShort,
} from "./generateBusinessNarrative";
import {
  computeMissingFields,
  isBrandKitComplete,
  normalizeBrandKitData,
  type BrandKitData,
  type BrandKitCompletenessOpts,
} from "./types";

export type BrandKitRecord = {
  id: string;
  domain: string;
  website: string | null;
  kit: BrandKitData;
  createdAt: Date;
  updatedAt: Date;
};

export type BrandKitView = BrandKitRecord & {
  missingFields: ReturnType<typeof computeMissingFields>;
  complete: boolean;
};

function toRecord(row: {
  id: string;
  domain: string;
  website: string | null;
  kit: unknown;
  createdAt: Date;
  updatedAt: Date;
}): BrandKitRecord {
  const normalized = applyDefaultedFields(normalizeBrandKitData(row.kit));
  const cache = getBusinessSummaryCache(row.kit as BrandKitStoredPayload);
  const withSummary = attachBusinessSummaryToKit(normalized, cache);
  const kit =
    cache != null
      ? ({ ...withSummary, businessSummaryCache: cache } as BrandKitData & {
          businessSummaryCache?: unknown;
        })
      : withSummary;

  return {
    id: row.id,
    domain: row.domain,
    website: row.website,
    kit: kit as BrandKitData,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function enrichView(record: BrandKitRecord, opts: BrandKitCompletenessOpts): BrandKitView {
  const missingFields = computeMissingFields(record.kit, opts);
  return {
    ...record,
    missingFields,
    complete: isBrandKitComplete(record.kit, opts),
  };
}

export async function findByDomain(domain: string): Promise<BrandKitRecord | null> {
  const row = await prisma.brandKit.findUnique({ where: { domain } });
  return row ? toRecord(row) : null;
}

export async function getProjectWithBrandKit(projectId: string) {
  return prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      clientUrl: true,
      brandKitId: true,
      businessSummary: true,
      brandKit: true,
    },
  });
}

export function completenessOptsForProject(clientUrl: string | null | undefined): BrandKitCompletenessOpts {
  return { hasClientUrl: Boolean(clientUrl?.trim()) };
}

export async function backfillBrandKitFromProject(projectId: string): Promise<void> {
  const project = await getProjectWithBrandKit(projectId);
  if (!project?.brandKitId && project?.clientUrl?.trim() && project.businessSummary) {
    const domain = normalizeDomain(project.clientUrl);
    if (!domain) return;
    const summary = project.businessSummary as BusinessSummary;
    const payload = brandKitFromBusinessSummary(summary, project.clientUrl);
    const existing = await findByDomain(domain);
    if (existing) {
      await linkProjectToKit(projectId, existing.id);
    } else {
      const created = await createKit({
        domain,
        website: project.clientUrl,
        kit: payload,
      });
      await linkProjectToKit(projectId, created.id);
    }
  }
}

export async function getForProject(projectId: string): Promise<BrandKitView | null> {
  await backfillBrandKitFromProject(projectId);
  const project = await getProjectWithBrandKit(projectId);
  if (!project?.brandKit) return null;
  const record = toRecord(project.brandKit);
  const opts = completenessOptsForProject(project.clientUrl);

  let kit = record.kit;
  const cache = getBusinessSummaryCache(project.brandKit.kit as BrandKitStoredPayload);
  if (
    (isBusinessSummaryTooShort(kit.businessSummary) || isBusinessSummaryIncomplete(kit.businessSummary)) &&
    kit.sources.businessSummary !== "user"
  ) {
    const expanded = await ensureDetailedBusinessSummaryOnKit(kit, cache, {
      website: project.clientUrl ?? record.website ?? undefined,
    });
    if (expanded.businessSummary !== kit.businessSummary) {
      const saved = await saveKitForProject(projectId, expanded);
      return saved;
    }
    kit = expanded;
  }

  return enrichView({ ...record, kit }, opts);
}

export async function createKit(params: {
  domain: string;
  website?: string | null;
  kit?: Partial<BrandKitData> & { businessSummaryCache?: unknown };
}): Promise<BrandKitRecord> {
  const kit = applyDefaultedFields({
    ...createEmptyBrandKitData(),
    ...params.kit,
    sources: { ...createEmptyBrandKitData().sources, ...params.kit?.sources },
    skipped: { ...createEmptyBrandKitData().skipped, ...params.kit?.skipped },
  });

  const row = await prisma.brandKit.create({
    data: {
      domain: params.domain,
      website: params.website ?? null,
      kit: kit as object,
    },
  });
  return toRecord(row);
}

export async function updateKit(brandKitId: string, kit: BrandKitData): Promise<BrandKitRecord> {
  const normalized = applyDefaultedFields(kit);
  const row = await prisma.brandKit.update({
    where: { id: brandKitId },
    data: { kit: normalized as object },
  });
  return toRecord(row);
}

function withPreservedSummaryCache(
  existingKit: unknown,
  next: BrandKitData
): BrandKitData {
  const cache = getBusinessSummaryCache(existingKit as BrandKitStoredPayload);
  if (!cache) return next;
  return { ...next, businessSummaryCache: cache } as BrandKitData;
}

export async function linkProjectToKit(projectId: string, brandKitId: string): Promise<void> {
  await prisma.project.update({
    where: { id: projectId },
    data: { brandKitId },
  });
}

export async function ensureProjectScopedKit(projectId: string): Promise<BrandKitView> {
  const existing = await getForProject(projectId);
  if (existing) return existing;

  const record = await createKit({
    domain: projectScopedDomain(projectId),
    website: null,
  });
  await linkProjectToKit(projectId, record.id);

  const project = await getProjectWithBrandKit(projectId);
  return enrichView(record, completenessOptsForProject(project?.clientUrl));
}

export async function saveKitForProject(
  projectId: string,
  kit: BrandKitData
): Promise<BrandKitView> {
  const project = await getProjectWithBrandKit(projectId);
  if (!project) throw new Error("Project not found");

  const normalized = applyDefaultedFields(kit);
  let record: BrandKitRecord;

  if (project.brandKitId && project.brandKit) {
    const toSave = withPreservedSummaryCache(project.brandKit.kit, normalized);
    record = await updateKit(project.brandKitId, toSave);
  } else {
    record = await createKit({
      domain: projectScopedDomain(projectId),
      website: project.clientUrl,
      kit: normalized,
    });
    await linkProjectToKit(projectId, record.id);
  }

  return enrichView(record, completenessOptsForProject(project.clientUrl));
}
