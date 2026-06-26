import { prisma } from "@/lib/db/prisma";
import { resolveSourceImages } from "@/lib/ai/resolveSourceImages";
import { analyzeUploadedImageIntent } from "./visionAgent";

export type SetProjectLogoResult =
  | { ok: true; logoUrl: string; imageId: string }
  | { ok: false; error: string; detectedKind?: string };

const MIN_LOGO_CONFIDENCE = 0.5;

/** One vision pass — save only when the upload is classified as a logo. */
export async function verifyAndSaveProjectLogo(
  projectId: string,
  imageId: string
): Promise<SetProjectLogoResult> {
  const urls = await resolveSourceImages(projectId, [imageId]);
  const url = urls[0];
  if (!url) {
    return { ok: false, error: "Uploaded image not found for this project" };
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { logoUrl: true },
  });

  const analysis = await analyzeUploadedImageIntent(url, {
    hasProjectLogo: Boolean(project?.logoUrl),
  });

  if (analysis.kind !== "logo" || analysis.confidence < MIN_LOGO_CONFIDENCE) {
    return {
      ok: false,
      error: "Image does not look like a company logo",
      detectedKind: analysis.kind,
    };
  }

  return setProjectLogo(projectId, imageId);
}

/** Set the project logo from an explicitly uploaded image — never inferred automatically. */
export async function setProjectLogo(
  projectId: string,
  imageId: string
): Promise<SetProjectLogoResult> {
  const image = await prisma.uploadedImage.findFirst({
    where: { id: imageId, projectId },
  });
  if (!image) {
    return { ok: false, error: "Uploaded image not found for this project" };
  }

  await prisma.project.update({
    where: { id: projectId },
    data: { logoUrl: image.blobUrl },
  });

  return { ok: true, logoUrl: image.blobUrl, imageId };
}

export async function getProjectLogoImageId(projectId: string): Promise<string | null> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project?.logoUrl) return null;
  const image = await prisma.uploadedImage.findFirst({
    where: { projectId, blobUrl: project.logoUrl },
  });
  return image?.id ?? null;
}
