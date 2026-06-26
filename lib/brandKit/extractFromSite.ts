import type { BusinessSummary } from "@/lib/ai/agents/summarizeBusiness";
import { fetchAndAnalyzePage } from "@/lib/ai/agents/summarizeBusiness";
import { extractBrandKitFields } from "@/lib/ai/agents/extractBrandKit";
import { extractBrandSignals } from "@/lib/web/brandSignals";
import type { PageFetchCache } from "@/lib/web/pageFetchCache";
import { applyDefaultedFields, createEmptyBrandKitData } from "./defaults";
import type { BrandKitFieldName, BrandKitData, FieldSource } from "./types";
import type { BrandKitStoredPayload } from "./mapFromSummary";
import { attachBusinessSummaryToKit } from "./businessSummaryNarrative";
import { coerceScalar } from "./coerce";

function setSite(
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

export async function extractFromSite(
  url: string,
  pageCache: PageFetchCache,
  businessSummary?: BusinessSummary
): Promise<{ finalUrl: string; payload: BrandKitStoredPayload } | { error: string }> {
  const fetched = await fetchAndAnalyzePage(pageCache, url);
  if (!fetched.ok) return { error: fetched.error };

  const signals = await extractBrandSignals(fetched.html, fetched.finalUrl, pageCache);
  const extracted = await extractBrandKitFields(fetched.text, fetched.finalUrl, signals);

  const kit = createEmptyBrandKitData();
  const sources: Partial<Record<BrandKitFieldName, FieldSource>> = { ...kit.sources };

  const summary = businessSummary;
  setSite(kit, sources, "businessName", extracted.businessName || summary?.businessName);
  setSite(kit, sources, "businessType", extracted.businessType || summary?.industry);
  setSite(kit, sources, "audience", extracted.audience || summary?.audience);
  setSite(kit, sources, "location", extracted.location || summary?.location);
  setSite(kit, sources, "tone", extracted.tone || summary?.tone);
  setSite(kit, sources, "website", fetched.finalUrl);
  setSite(kit, sources, "heritage", extracted.heritage);
  setSite(
    kit,
    sources,
    "themeWords",
    extracted.themeWords || summary?.whatTheyDo
  );
  setSite(kit, sources, "contact", extracted.contact || signals.contactHints[0]);

  if (extracted.colors?.length) {
    kit.colors = extracted.colors
      .filter((c) => c != null && typeof c === "object")
      .map((c) => {
        const row = c as { name?: unknown; hex?: unknown };
        return {
          name: coerceScalar(row.name) ?? "",
          hex: coerceScalar(row.hex),
        };
      })
      .filter((c) => c.name);
    if (kit.colors.length) sources.colors = "site";
  }

  if (extracted.avoidColors?.length) {
    kit.avoidColors = extracted.avoidColors
      .map((c) => coerceScalar(c))
      .filter((c): c is string => Boolean(c));
    if (kit.avoidColors.length) sources.avoidColors = "site";
  }

  const base = applyDefaultedFields({
    ...kit,
    sources,
  });

  const withSummary = attachBusinessSummaryToKit(base, summary);

  const payload: BrandKitStoredPayload = {
    ...withSummary,
    businessSummaryCache: summary,
  };

  return { finalUrl: fetched.finalUrl, payload };
}
