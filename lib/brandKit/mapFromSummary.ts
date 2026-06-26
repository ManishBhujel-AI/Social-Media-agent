import type { BusinessSummary } from "@/lib/ai/agents/summarizeBusiness";
import { applyDefaultedFields, createEmptyBrandKitData } from "./defaults";
import type { BrandKitData, BrandKitFieldName, FieldSource } from "./types";
import { coerceScalar } from "./coerce";
import { narrativeFromBusinessSummary } from "./businessSummaryNarrative";

/** Cached on the kit JSON for reuse across briefs (products list, etc.). */
export type BrandKitStoredPayload = BrandKitData & {
  businessSummaryCache?: BusinessSummary;
};

function setSiteField(
  kit: BrandKitData,
  sources: Partial<Record<BrandKitFieldName, FieldSource>>,
  field: BrandKitFieldName,
  value: unknown
) {
  const trimmed = coerceScalar(value);
  if (!trimmed) return;
  (kit as Record<string, unknown>)[field] = trimmed;
  sources[field] = "site";
}

export function brandKitFromBusinessSummary(
  summary: BusinessSummary,
  website: string
): BrandKitStoredPayload {
  const kit = createEmptyBrandKitData();
  const sources: Partial<Record<BrandKitFieldName, FieldSource>> = {
    ...kit.sources,
  };

  setSiteField(kit, sources, "businessName", summary.businessName);
  setSiteField(kit, sources, "businessType", summary.industry);
  setSiteField(kit, sources, "audience", summary.audience);
  setSiteField(kit, sources, "location", summary.location);
  setSiteField(kit, sources, "tone", summary.tone);
  setSiteField(kit, sources, "website", website);
  if (summary.whatTheyDo) {
    setSiteField(kit, sources, "themeWords", summary.whatTheyDo);
  }

  const base = applyDefaultedFields({
    ...kit,
    businessSummary: narrativeFromBusinessSummary(summary),
    sources: { ...sources, businessSummary: "site" },
  });

  return {
    ...base,
    businessSummaryCache: summary,
  };
}

export function stripStoredPayload(payload: BrandKitStoredPayload): BrandKitData {
  const { businessSummaryCache: _cache, ...kit } = payload;
  return kit;
}

export function getBusinessSummaryCache(
  payload: BrandKitStoredPayload | BrandKitData
): BusinessSummary | undefined {
  const cache = (payload as BrandKitStoredPayload).businessSummaryCache;
  return cache && typeof cache === "object" ? cache : undefined;
}
