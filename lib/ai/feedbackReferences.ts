import { resolveSourceImages } from "./resolveSourceImages";
import { getStorage } from "@/lib/storage";
import { MAX_FEEDBACK_REFERENCE_IMAGES } from "./imageRefs.config";

/** Resolve user-uploaded feedback image IDs to data URLs for the image model. */
export async function resolveFeedbackReferenceImages(
  projectId: string,
  imageIds?: string[] | null
): Promise<string[]> {
  if (!imageIds?.length) return [];

  const capped = imageIds.slice(0, MAX_FEEDBACK_REFERENCE_IMAGES);
  const urls = await resolveSourceImages(projectId, capped);
  const storage = getStorage();
  const dataUrls: string[] = [];

  for (const url of urls) {
    try {
      dataUrls.push(await storage.readAsDataUrl(url));
    } catch {
      /* skip unresolvable refs */
    }
  }

  return dataUrls;
}
