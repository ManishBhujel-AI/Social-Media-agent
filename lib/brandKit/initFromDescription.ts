import type { BusinessSummary } from "@/lib/ai/agents/summarizeBusiness";
import { MODELS } from "@/lib/ai/models.config";
import { openRouterChatJSON } from "@/lib/ai/openrouter";
import type { BrandKitFieldName, BrandKitData, FieldSource } from "./types";
import { coerceScalar } from "./coerce";
import { applyDefaultedFields, createEmptyBrandKitData } from "./defaults";
import {
  createKit,
  ensureProjectScopedKit,
  getForProject,
  getProjectWithBrandKit,
  linkProjectToKit,
  saveKitForProject,
} from "./store";
import { projectScopedDomain } from "./domain";
import type { BrandKitView } from "./store";
import { BUSINESS_SUMMARY_WRITING_INSTRUCTIONS, ensureDetailedBusinessSummaryOnKit } from "./generateBusinessNarrative";
import { narrativeFromBusinessSummary } from "./businessSummaryNarrative";

type PrefillResult = Partial<
  Pick<
    BrandKitData,
    | "businessName"
    | "businessType"
    | "audience"
    | "tone"
    | "location"
    | "heritage"
    | "themeWords"
    | "contact"
  >
> & {
  narrativeSummary?: string;
  products?: Array<{ name: string; description?: string }>;
};

async function prefillFromDescription(description: string): Promise<PrefillResult> {
  if (!description.trim()) return {};
  return openRouterChatJSON<PrefillResult>({
    model: MODELS.promptRefiner.model,
    messages: [
      {
        role: "system",
        content:
          `Extract brand kit fields from a user's business description for a social content team. Return JSON with any of: businessName, businessType, audience (who their customers are), tone, location (where they are based and serve), heritage, themeWords, contact, narrativeSummary (${BUSINESS_SUMMARY_WRITING_INSTRUCTIONS}), products[{name,description}]. Omit fields you cannot infer.`,
      },
      { role: "user", content: description },
    ],
  });
}

function applyUserPrefill(kit: BrandKitData, prefill: PrefillResult): BrandKitData {
  const sources: Partial<Record<BrandKitFieldName, FieldSource>> = { ...kit.sources };
  const scalarFields: (keyof PrefillResult)[] = [
    "businessName",
    "businessType",
    "audience",
    "tone",
    "location",
    "heritage",
    "themeWords",
    "contact",
  ];

  for (const field of scalarFields) {
    const value = coerceScalar(prefill[field]);
    if (value) {
      (kit as Record<string, unknown>)[field] = value;
      sources[field as BrandKitFieldName] = "user";
    }
  }

  return { ...kit, sources };
}

export type InitBrandKitResult =
  | { ok: true; brandKit: BrandKitView; created: boolean }
  | { ok: false; error: string };

export async function initBrandKit(
  projectId: string,
  description?: string
): Promise<InitBrandKitResult> {
  const project = await getProjectWithBrandKit(projectId);
  if (!project) return { ok: false, error: "Project not found" };

  const existing = await getForProject(projectId);
  if (existing?.kit.businessName?.trim() && !description?.trim()) {
    return { ok: true, brandKit: existing, created: false };
  }

  const prefill = description?.trim() ? await prefillFromDescription(description) : {};
  const base = applyDefaultedFields(createEmptyBrandKitData());
  let kit = applyUserPrefill(base, prefill);

  if (prefill.narrativeSummary?.trim() || prefill.products?.length) {
    const summary: BusinessSummary = {
      businessName: kit.businessName || "Business",
      whatTheyDo: kit.themeWords || prefill.narrativeSummary?.slice(0, 120) || "",
      narrativeSummary: prefill.narrativeSummary,
      audience: kit.audience,
      location: kit.location,
      tone: kit.tone,
      industry: kit.businessType,
      products: prefill.products ?? [],
    };
    kit = await ensureDetailedBusinessSummaryOnKit(
      {
        ...kit,
        businessSummary: narrativeFromBusinessSummary(summary),
        sources: { ...kit.sources, businessSummary: "user" },
      },
      summary
    );
    kit = {
      ...kit,
      businessSummaryCache: { ...summary, narrativeSummary: kit.businessSummary },
    } as BrandKitData & { businessSummaryCache?: BusinessSummary };
  }

  let brandKit: BrandKitView;
  if (project.brandKitId) {
    brandKit = await saveKitForProject(projectId, kit);
  } else {
    const record = await createKit({
      domain: projectScopedDomain(projectId),
      website: null,
      kit,
    });
    await linkProjectToKit(projectId, record.id);
    brandKit = (await getForProject(projectId)) ?? (await ensureProjectScopedKit(projectId));
  }

  return { ok: true, brandKit, created: true };
}
