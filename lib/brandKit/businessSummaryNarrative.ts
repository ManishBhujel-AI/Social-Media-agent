import type { BusinessSummary } from "@/lib/ai/agents/summarizeBusiness";
import type { BrandKitData } from "./types";
import { getBusinessSummaryCache, type BrandKitStoredPayload } from "./mapFromSummary";

/** Resolve the rich narrative used by caption and graphic agents. */
export function resolveBusinessSummaryNarrative(
  kit: BrandKitData,
  cache?: BusinessSummary | null
): string {
  const summary = cache ?? getBusinessSummaryCache(kit as BrandKitStoredPayload);
  const candidates = [
    kit.businessSummary?.trim(),
    summary?.narrativeSummary?.trim(),
    summary?.whatTheyDo?.trim(),
  ].filter((value): value is string => Boolean(value));

  if (candidates.length) {
    return candidates.sort((a, b) => b.length - a.length)[0];
  }

  return composeNarrativeFromKitFields(kit, summary ?? undefined);
}

export function narrativeFromBusinessSummary(summary: BusinessSummary): string {
  if (summary.narrativeSummary?.trim()) return summary.narrativeSummary.trim();
  if (summary.whatTheyDo?.trim()) return summary.whatTheyDo.trim();
  return composeNarrativeFromKitFields(
    {
      businessName: summary.businessName,
      businessType: summary.industry ?? "",
      audience: summary.audience ?? "",
      location: summary.location ?? "",
      tone: summary.tone ?? "",
      heritage: "",
      themeWords: "",
    } as BrandKitData,
    summary
  );
}

export function composeNarrativeFromKitFields(
  kit: Pick<
    BrandKitData,
    "businessName" | "businessType" | "audience" | "location" | "tone" | "heritage" | "themeWords"
  >,
  summary?: BusinessSummary
): string {
  const parts: string[] = [];
  const name = kit.businessName?.trim();
  if (name) {
    const type = kit.businessType?.trim();
    parts.push(type ? `${name} is a ${type}.` : `${name}.`);
  }

  const products = summary?.products?.filter((p) => p.name?.trim()) ?? [];
  if (products.length) {
    const list = products
      .slice(0, 8)
      .map((p) => (p.description?.trim() ? `${p.name} (${p.description.trim()})` : p.name))
      .join("; ");
    parts.push(`They sell and provide ${list}.`);
  } else if (kit.businessType?.trim()) {
    parts.push(`They provide ${kit.businessType.trim()}.`);
  }

  if (kit.audience?.trim()) {
    parts.push(`Their customers are ${kit.audience.trim()}.`);
  }

  if (kit.location?.trim()) {
    parts.push(`They are based in ${kit.location.trim()} and serve that market.`);
  }

  if (kit.heritage?.trim()) {
    parts.push(kit.heritage.trim().endsWith(".") ? kit.heritage.trim() : `${kit.heritage.trim()}.`);
  }

  if (kit.themeWords?.trim()) {
    parts.push(`What sets them apart: ${kit.themeWords.trim()}.`);
  }

  if (kit.tone?.trim()) parts.push(`Brand voice: ${kit.tone.trim()}.`);

  return parts.join(" ").trim();
}

export function attachBusinessSummaryToKit(
  kit: BrandKitData,
  summary?: BusinessSummary | null
): BrandKitData {
  const narrative = resolveBusinessSummaryNarrative(kit, summary);
  if (!narrative) return kit;
  const sources = { ...kit.sources };
  if (!kit.businessSummary?.trim()) {
    sources.businessSummary = summary ? "site" : sources.businessSummary ?? "site";
  }
  return { ...kit, businessSummary: kit.businessSummary?.trim() || narrative, sources };
}
