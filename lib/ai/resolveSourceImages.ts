import { prisma } from "@/lib/db/prisma";

function looksLikeStorageUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://") || value.startsWith("/api/files/");
}

/** Resolve UploadedImage IDs (or mixed IDs/URLs) to storage blob URLs. */
export async function resolveSourceImages(
  projectId: string,
  sourceImages?: string[] | null
): Promise<string[]> {
  if (!sourceImages?.length) return [];

  const needsLookup = sourceImages.some((s) => !looksLikeStorageUrl(s));
  if (!needsLookup) return sourceImages;

  const uploaded = await prisma.uploadedImage.findMany({ where: { projectId } });
  const idToUrl = new Map(uploaded.map((img) => [img.id, img.blobUrl]));

  return sourceImages
    .map((entry) => {
      if (looksLikeStorageUrl(entry)) return entry;
      return idToUrl.get(entry) ?? null;
    })
    .filter((url): url is string => Boolean(url));
}

/** Resolve a single source image entry to a storage URL. */
export async function resolveSourceImageUrl(
  projectId: string,
  entry: string
): Promise<string | null> {
  const [resolved] = await resolveSourceImages(projectId, [entry]);
  return resolved ?? null;
}
