import type { ResolvedReference } from "./buildImageRefs";
import { getStorage } from "@/lib/storage";
import {
  normalizeDataUrlForImageModel,
  unsupportedImageMessage,
} from "./normalizeImageRef";

type GraphicRefTask = {
  sourceImages: unknown;
  project: { logoUrl: string | null };
};

async function resolveReferenceDataUrls(
  entries: { url: string; role: ResolvedReference["role"] }[]
): Promise<{ resolved: ResolvedReference[]; skipped: string[] }> {
  const storage = getStorage();
  const logoEntry = entries.find((e) => e.role === "logo");
  const otherEntries = entries.filter((e) => e.role !== "logo");
  const ordered = logoEntry ? [...otherEntries, logoEntry] : otherEntries;

  const resolved: ResolvedReference[] = [];
  const skipped: string[] = [];
  for (const entry of ordered) {
    try {
      const raw = await storage.readAsDataUrl(entry.url);
      const dataUrl = normalizeDataUrlForImageModel(raw, entry.url);
      if (!dataUrl) {
        skipped.push(entry.url);
        continue;
      }
      resolved.push({ dataUrl, role: entry.role });
    } catch {
      /* skip unresolvable refs */
    }
  }
  if (skipped.length) {
    console.warn(
      "[buildGraphicReferences] Skipped unsupported image formats:",
      skipped.map((u) => unsupportedImageMessage(u)).join("; ")
    );
  }
  return { resolved, skipped };
}

/** Product uploads + brand logo only. */
export async function buildGraphicReferences(task: GraphicRefTask): Promise<{
  referenceImageUrls: string[];
  resolvedRefs: ResolvedReference[];
  logoInRefs: boolean;
}> {
  const sourceImages = (task.sourceImages as string[] | null) ?? [];
  const logoUrl = task.project.logoUrl;

  const urlEntries: { url: string; role: ResolvedReference["role"] }[] = [];
  for (let i = 0; i < sourceImages.length; i++) {
    const url = sourceImages[i];
    if (!url) continue;
    urlEntries.push({ url, role: i === 0 ? "product" : "extra" });
  }
  if (logoUrl) {
    urlEntries.push({ url: logoUrl, role: "logo" });
  }

  const { resolved: resolvedRefs, skipped } = await resolveReferenceDataUrls(urlEntries);
  const logoInRefs = resolvedRefs.some((r) => r.role === "logo");

  const productRefCount = resolvedRefs.filter(
    (r) => r.role === "product" || r.role === "extra"
  ).length;
  if (sourceImages.length > 0 && productRefCount === 0) {
    const skippedProduct = sourceImages.filter((url) =>
      skipped.some((s) => s === url)
    );
    if (skippedProduct.length === sourceImages.length) {
      throw new Error(
        `Could not use uploaded product photos — ${unsupportedImageMessage(sourceImages[0])}`
      );
    }
    throw new Error(
      "Could not load uploaded product photos for graphic generation — try re-uploading."
    );
  }

  return {
    referenceImageUrls: resolvedRefs.map((r) => r.dataUrl),
    resolvedRefs,
    logoInRefs,
  };
}
