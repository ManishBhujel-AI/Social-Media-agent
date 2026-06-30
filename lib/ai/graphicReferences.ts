import {
  buildReferencePromptSuffix,
  buildReferenceUrlList,
  capReferenceEntries,
  getMaxImageRefs,
  type ResolvedReference,
} from "./buildImageRefs";
import { getStyleReferenceImageUrls } from "@/lib/content/references";
import { getStorage } from "@/lib/storage";

type GraphicRefTask = {
  id: string;
  projectId: string;
  productImageUrl: string | null;
  sourceImages: unknown;
  project: { logoUrl: string | null };
};

async function resolveReferenceDataUrls(
  entries: { url: string; role: ResolvedReference["role"] }[]
): Promise<ResolvedReference[]> {
  const storage = getStorage();
  const logoEntry = entries.find((e) => e.role === "logo");
  const otherEntries = entries.filter((e) => e.role !== "logo");
  const ordered = logoEntry ? [...otherEntries, logoEntry] : otherEntries;

  const resolved: ResolvedReference[] = [];
  for (const entry of ordered) {
    try {
      const dataUrl = await storage.readAsDataUrl(entry.url);
      resolved.push({ dataUrl, role: entry.role });
    } catch {
      /* skip unresolvable refs */
    }
  }
  return resolved;
}

/** Build reference images + prompt suffix for graphic generation. Logo slot is always reserved when set. */
export async function buildGraphicReferences(task: GraphicRefTask): Promise<{
  referenceImageUrls: string[];
  promptSuffix: string;
  logoInRefs: boolean;
}> {
  const sourceImages = (task.sourceImages as string[] | null) ?? [];
  const logoUrl = task.project.logoUrl;
  const maxRefs = getMaxImageRefs();
  const styleImageUrls = await getStyleReferenceImageUrls(task.projectId, task.id);

  const urlEntries = capReferenceEntries(
    buildReferenceUrlList({
      productImageUrl: task.productImageUrl,
      sourceImages,
      logoUrl,
      styleImageUrls,
    }),
    maxRefs,
    { reserveLogo: Boolean(logoUrl) }
  );

  const logoOmitted = Boolean(logoUrl) && !urlEntries.some((e) => e.role === "logo");
  const resolvedRefs = maxRefs > 0 ? await resolveReferenceDataUrls(urlEntries) : [];
  const logoInRefs = resolvedRefs.some((r) => r.role === "logo");

  const productRefCount = resolvedRefs.filter(
    (r) => r.role === "product" || r.role === "extra"
  ).length;
  if (sourceImages.length > 0 && productRefCount === 0) {
    throw new Error(
      "Could not load uploaded product photos for graphic generation — try re-uploading."
    );
  }

  const promptSuffix = buildReferencePromptSuffix(resolvedRefs, {
    logoOmitted,
    hadLogo: Boolean(logoUrl),
  });

  return {
    referenceImageUrls: resolvedRefs.map((r) => r.dataUrl),
    promptSuffix,
    logoInRefs,
  };
}
