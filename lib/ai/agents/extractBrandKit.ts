import { MODELS } from "../models.config";
import { openRouterChatJSON } from "../openrouter";
import type { BrandColor } from "@/lib/brandKit/types";
import type { BrandSignals } from "@/lib/web/brandSignals";

export type ExtractedBrandFields = {
  businessName: string;
  businessType: string;
  location?: string;
  audience?: string;
  tone?: string;
  heritage?: string;
  themeWords?: string;
  contact?: string;
  contactStyle?: string;
  colors?: BrandColor[];
  avoidColors?: string[];
};

export async function extractBrandKitFields(
  pageText: string,
  finalUrl: string,
  signals: BrandSignals
): Promise<ExtractedBrandFields> {
  return openRouterChatJSON<ExtractedBrandFields>({
    model: MODELS.promptRefiner.model,
    messages: [
      {
        role: "system",
        content: `Extract brand kit fields from website text. Return JSON:
businessName, businessType, location (all cities, branches, islands, or regions served — comma-separated if multiple; do not pick only the HQ), audience, tone, heritage (e.g. family-owned since…), themeWords (location/mood feel), contact (phone if found), contactStyle (how to show contact on graphics), colors [{name, hex?}] (label primary/secondary/accent when possible), avoidColors (color names to avoid).
Use detected colors when provided. Be concise. Omit fields you cannot infer.`,
      },
      {
        role: "user",
        content: `URL: ${finalUrl}
Detected color hexes: ${signals.colorHexes.join(", ") || "none"}
Contact hints: ${signals.contactHints.join(", ") || "none"}

${pageText.slice(0, 14_000)}`,
      },
    ],
  });
}
