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

  const resolved: string[] = [];
  const idsToLookup: string[] = [];

  for (const entry of sourceImages) {
    if (looksLikeStorageUrl(entry)) {
      resolved.push(entry);
    } else {
      idsToLookup.push(entry);
    }
  }

  if (idsToLookup.length) {
    const uploaded = await prisma.uploadedImage.findMany({
      where: { projectId, id: { in: idsToLookup } },
      select: { id: true, blobUrl: true },
    });
    const idToUrl = new Map(uploaded.map((img) => [img.id, img.blobUrl]));
    for (const id of idsToLookup) {
      const url = idToUrl.get(id);
      if (url) {
        resolved.push(url);
      } else {
        console.warn(
          `[resolveSourceImages] UploadedImage not found: id=${id} projectId=${projectId}`
        );
      }
    }
  }

  return resolved;
}

/** Resolve a single source image entry to a storage URL. */
export async function resolveSourceImageUrl(
  projectId: string,
  entry: string
): Promise<string | null> {
  const [resolved] = await resolveSourceImages(projectId, [entry]);
  return resolved ?? null;
}
