import type { BrandKitData, BrandKitFieldName, FieldSource } from "./types";

export const DEFAULT_CONTACT_STYLE = "clearly visible, on-brand color";
export const DEFAULT_ASPECT_RATIO = "1:1";

export const DEFAULT_FIELD_VALUES: Pick<BrandKitData, "contactStyle" | "aspectRatio"> = {
  contactStyle: DEFAULT_CONTACT_STYLE,
  aspectRatio: DEFAULT_ASPECT_RATIO,
};

export function createEmptyBrandKitData(): BrandKitData {
  return {
    businessName: "",
    website: "",
    location: "",
    businessType: "",
    audience: "",
    tone: "",
    heritage: "",
    themeWords: "",
    contact: "",
    contactStyle: DEFAULT_CONTACT_STYLE,
    aspectRatio: DEFAULT_ASPECT_RATIO,
    businessSummary: "",
    colors: [],
    avoidColors: [],
    sources: {
      contactStyle: "default",
      aspectRatio: "default",
    },
    skipped: {},
  };
}

export function applyDefaultedFields(kit: BrandKitData): BrandKitData {
  const next = { ...kit, sources: { ...kit.sources } };

  for (const [field, value] of Object.entries(DEFAULT_FIELD_VALUES) as [
    BrandKitFieldName,
    string,
  ][]) {
    if (!next[field as keyof BrandKitData] || (field === "contactStyle" && !next.contactStyle)) {
      (next as Record<string, unknown>)[field] = value;
    }
    if (!next.sources[field]) {
      next.sources[field] = "default" satisfies FieldSource;
    }
  }

  if (!next.contactStyle.trim()) {
    next.contactStyle = DEFAULT_CONTACT_STYLE;
    next.sources.contactStyle = "default";
  }
  if (!next.aspectRatio.trim()) {
    next.aspectRatio = DEFAULT_ASPECT_RATIO;
    next.sources.aspectRatio = "default";
  }

  return next;
}
