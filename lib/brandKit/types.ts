export type FieldSource = "site" | "user" | "default";

export type BrandColor = { name: string; hex?: string };

export type ClientPreferenceScope = `client` | `product:${string}` | `topic:${string}`;

export type ClientPreferenceEntry = {
  id: string;
  date: string;
  scope: ClientPreferenceScope;
  note: string;
};

export type SecondaryContact = {
  branch: string;
  phone: string;
  address: string;
};

export type SettingsPatchItem = {
  /** Slash-separated path, e.g. `clientPreferences`, `productNotes/Zoomlock Max`, `colors/0/hex` */
  path: string;
  value: unknown;
};

export type SettingsChangelogEntry = {
  id: string;
  at: string;
  source: "agent" | "user";
  summary: string;
  patches: { path: string; before: unknown; after: unknown }[];
  revertedAt?: string;
};

export type BrandKitFieldName =
  | "businessName"
  | "website"
  | "location"
  | "businessType"
  | "audience"
  | "tone"
  | "heritage"
  | "themeWords"
  | "contact"
  | "contactStyle"
  | "aspectRatio"
  | "colors"
  | "avoidColors";

export type BrandKitData = {
  businessName: string;
  website: string;
  location: string;
  businessType: string;
  audience: string;
  tone: string;
  heritage: string;
  themeWords: string;
  contact: string;
  contactStyle: string;
  aspectRatio: string;
  /** Rich narrative for caption and graphic agents — generated at brand setup, editable in settings. */
  businessSummary: string;
  colors: BrandColor[];
  avoidColors: string[];
  sources: Partial<Record<BrandKitFieldName | "businessSummary", FieldSource>>;
  skipped: Partial<Record<BrandKitFieldName, boolean>>;
  /** Append-only learned dos/don'ts — scoped to client, product, or topic. */
  clientPreferences: ClientPreferenceEntry[];
  /** Per-product/campaign quick notes keyed by product name. */
  productNotes: Record<string, string>;
  /** Branch contacts for multi-location captions (caption path only). */
  secondaryContacts: SecondaryContact[];
  /** Agent and user settings changes with revert support. */
  settingsChangelog: SettingsChangelogEntry[];
};

export type BrandKitCompletenessOpts = {
  hasClientUrl: boolean;
};

/** Required fields — gap-fill has no Skip; blocks planning when empty. */
export const REQUIRED_FIELDS = [
  "businessName",
  "businessType",
  "location",
  "audience",
  "tone",
  "colors",
  "contact",
] as const satisfies readonly BrandKitFieldName[];

export const CONDITIONAL_REQUIRED_FIELD = "website" as const satisfies BrandKitFieldName;

/** Asked once if empty; Skip resolves without blocking. */
export const SKIPPABLE_FIELDS = [
  "heritage",
  "themeWords",
  "avoidColors",
] as const satisfies readonly BrandKitFieldName[];

/** Set on kit creation; never gap-filled. */
export const DEFAULTED_FIELDS = [
  "contactStyle",
  "aspectRatio",
] as const satisfies readonly BrandKitFieldName[];

const REQUIRED_PRIORITY: BrandKitFieldName[] = [
  "businessName",
  "businessType",
  "location",
  "audience",
  "tone",
  "colors",
  "contact",
];

const SKIPPABLE_PRIORITY: BrandKitFieldName[] = ["heritage", "themeWords", "avoidColors"];

function isScalarEmpty(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value.trim() === "";
  return false;
}

export function isFieldSkipped(kit: BrandKitData, field: BrandKitFieldName): boolean {
  return kit.skipped[field] === true;
}

export function isFieldEmpty(kit: BrandKitData, field: BrandKitFieldName): boolean {
  switch (field) {
    case "colors":
      return !Array.isArray(kit.colors) || kit.colors.length === 0;
    case "avoidColors":
      return !Array.isArray(kit.avoidColors) || kit.avoidColors.length === 0;
    default:
      return isScalarEmpty(kit[field as keyof BrandKitData]);
  }
}

export function isFieldFilled(kit: BrandKitData, field: BrandKitFieldName): boolean {
  if (DEFAULTED_FIELDS.includes(field as (typeof DEFAULTED_FIELDS)[number])) return true;
  if (isFieldSkipped(kit, field)) return true;
  return !isFieldEmpty(kit, field);
}

function isFieldMissing(kit: BrandKitData, field: BrandKitFieldName, opts: BrandKitCompletenessOpts): boolean {
  if (DEFAULTED_FIELDS.includes(field as (typeof DEFAULTED_FIELDS)[number])) return false;

  if (SKIPPABLE_FIELDS.includes(field as (typeof SKIPPABLE_FIELDS)[number])) {
    return isFieldEmpty(kit, field) && !isFieldSkipped(kit, field);
  }

  if (field === CONDITIONAL_REQUIRED_FIELD) {
    return opts.hasClientUrl && isFieldEmpty(kit, field);
  }

  if (REQUIRED_FIELDS.includes(field as (typeof REQUIRED_FIELDS)[number])) {
    return isFieldEmpty(kit, field);
  }

  return false;
}

export function computeMissingFields(
  kit: BrandKitData,
  opts: BrandKitCompletenessOpts
): BrandKitFieldName[] {
  const missing: BrandKitFieldName[] = [];

  for (const field of REQUIRED_PRIORITY) {
    if (isFieldMissing(kit, field, opts)) missing.push(field);
  }

  if (opts.hasClientUrl && isFieldMissing(kit, CONDITIONAL_REQUIRED_FIELD, opts)) {
    missing.push(CONDITIONAL_REQUIRED_FIELD);
  }

  for (const field of SKIPPABLE_PRIORITY) {
    if (isFieldMissing(kit, field, opts)) missing.push(field);
  }

  return missing;
}

export function isBrandKitComplete(kit: BrandKitData, opts: BrandKitCompletenessOpts): boolean {
  return computeMissingFields(kit, opts).length === 0;
}

export function getNextMissingField(
  kit: BrandKitData,
  opts: BrandKitCompletenessOpts
): BrandKitFieldName | null {
  const missing = computeMissingFields(kit, opts);
  return missing[0] ?? null;
}

export function normalizeBrandKitData(raw: unknown): BrandKitData {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  const colors = Array.isArray(obj.colors)
    ? obj.colors
        .filter((c): c is Record<string, unknown> => c != null && typeof c === "object")
        .map((c) => ({
          name: typeof c.name === "string" ? c.name : "",
          hex: typeof c.hex === "string" && c.hex.trim() ? c.hex.trim() : undefined,
        }))
        .filter((c) => c.name.trim())
    : [];

  const avoidColors = Array.isArray(obj.avoidColors)
    ? obj.avoidColors
        .filter((c): c is string => typeof c === "string" && c.trim() !== "")
        .map((c) => c.trim())
    : [];

  const sources =
    obj.sources && typeof obj.sources === "object"
      ? (obj.sources as Partial<Record<BrandKitFieldName, FieldSource>>)
      : {};

  const skipped =
    obj.skipped && typeof obj.skipped === "object"
      ? (obj.skipped as Partial<Record<BrandKitFieldName, boolean>>)
      : {};

  const clientPreferences = Array.isArray(obj.clientPreferences)
    ? obj.clientPreferences
        .filter((e): e is Record<string, unknown> => e != null && typeof e === "object")
        .map((e) => ({
          id: typeof e.id === "string" ? e.id : "",
          date: typeof e.date === "string" ? e.date : "",
          scope: (typeof e.scope === "string" ? e.scope : "client") as ClientPreferenceScope,
          note: typeof e.note === "string" ? e.note : "",
        }))
        .filter((e) => e.id && e.note.trim())
    : [];

  const productNotes: Record<string, string> = {};
  if (obj.productNotes && typeof obj.productNotes === "object" && !Array.isArray(obj.productNotes)) {
    for (const [key, val] of Object.entries(obj.productNotes as Record<string, unknown>)) {
      if (typeof val === "string" && val.trim()) productNotes[key] = val.trim();
    }
  }

  const secondaryContacts = Array.isArray(obj.secondaryContacts)
    ? obj.secondaryContacts
        .filter((c): c is Record<string, unknown> => c != null && typeof c === "object")
        .map((c) => ({
          branch: typeof c.branch === "string" ? c.branch : "",
          phone: typeof c.phone === "string" ? c.phone : "",
          address: typeof c.address === "string" ? c.address : "",
        }))
        .filter((c) => c.branch || c.phone)
    : [];

  const settingsChangelog = Array.isArray(obj.settingsChangelog)
    ? obj.settingsChangelog
        .filter((e): e is Record<string, unknown> => e != null && typeof e === "object")
        .map((e) => ({
          id: typeof e.id === "string" ? e.id : "",
          at: typeof e.at === "string" ? e.at : "",
          source: e.source === "agent" ? ("agent" as const) : ("user" as const),
          summary: typeof e.summary === "string" ? e.summary : "",
          patches: Array.isArray(e.patches)
            ? e.patches
                .filter((p): p is Record<string, unknown> => p != null && typeof p === "object")
                .map((p) => ({
                  path: typeof p.path === "string" ? p.path : "",
                  before: p.before,
                  after: p.after,
                }))
                .filter((p) => p.path)
            : [],
          revertedAt: typeof e.revertedAt === "string" ? e.revertedAt : undefined,
        }))
        .filter((e) => e.id && e.patches.length > 0)
    : [];

  return {
    businessName: typeof obj.businessName === "string" ? obj.businessName : "",
    website: typeof obj.website === "string" ? obj.website : "",
    location: typeof obj.location === "string" ? obj.location : "",
    businessType: typeof obj.businessType === "string" ? obj.businessType : "",
    audience: typeof obj.audience === "string" ? obj.audience : "",
    tone: typeof obj.tone === "string" ? obj.tone : "",
    heritage: typeof obj.heritage === "string" ? obj.heritage : "",
    themeWords: typeof obj.themeWords === "string" ? obj.themeWords : "",
    contact: typeof obj.contact === "string" ? obj.contact : "",
    contactStyle: typeof obj.contactStyle === "string" ? obj.contactStyle : "",
    aspectRatio: typeof obj.aspectRatio === "string" ? obj.aspectRatio : "",
    businessSummary: typeof obj.businessSummary === "string" ? obj.businessSummary : "",
    colors,
    avoidColors,
    sources,
    skipped,
    clientPreferences,
    productNotes,
    secondaryContacts,
    settingsChangelog,
  };
}
