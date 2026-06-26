import { MODELS } from "../models.config";
import { openRouterChatJSON } from "../openrouter";
import { prisma } from "@/lib/db/prisma";
import { getStorage } from "@/lib/storage";
import { isImageMime, isValidImageDataUrl } from "../validateImageDataUrl";

export type VisionMatch = {
  imageId: string;
  matchedProduct: string;
  confidence: number;
  description: string;
};

export type PostLabel = {
  subject: string;
  title: string;
};

/** Minimum confidence to attach an uploaded image to a post. */
export const POST_MATCH_CONFIDENCE_THRESHOLD = 0.55;

function normalizeLabel(value: string): string {
  return value.trim().toLowerCase();
}

export function postLabelOptions(post: PostLabel): string[] {
  return [post.subject, post.title].map((s) => s.trim()).filter(Boolean);
}

export function imageMatchesPost(match: VisionMatch, post: PostLabel): boolean {
  if (match.confidence < POST_MATCH_CONFIDENCE_THRESHOLD) return false;
  const matched = match.matchedProduct?.trim();
  if (!matched) return false;
  const normalized = normalizeLabel(matched);
  return postLabelOptions(post).some((label) => normalizeLabel(label) === normalized);
}

/** Match uploaded images to the subjects/titles of posts being created (not website taxonomy). */
export async function matchImagesToPosts(
  projectId: string,
  imageIds: string[],
  posts: PostLabel[]
): Promise<VisionMatch[]> {
  const images = await prisma.uploadedImage.findMany({
    where: { id: { in: imageIds }, projectId },
  });

  const postList = posts.flatMap((p) => {
    const labels = postLabelOptions(p);
    return labels.map((label) => ({ subject: p.subject, title: p.title, label }));
  });

  const uniqueLabels = Array.from(new Set(postList.map((p) => p.label)));

  const results: VisionMatch[] = [];

  for (const img of images) {
    try {
      if (!isImageMime(img.mime)) {
        console.warn(`Skipping non-image upload ${img.id} (mime: ${img.mime})`);
        continue;
      }

      const dataUrl = await getStorage().readAsDataUrl(img.blobUrl);
      if (!isValidImageDataUrl(dataUrl)) {
        console.warn(`Skipping invalid image data URL for upload ${img.id}`);
        continue;
      }

      const match = await openRouterChatJSON<VisionMatch>({
        model: MODELS.vision.model,
        messages: [
          {
            role: "system",
            content: `Match this product photo to ONE Facebook post being created, or none.

Post options (set matchedProduct to the exact subject OR title string from one post):
${JSON.stringify(posts.map((p) => ({ subject: p.subject, title: p.title })))}

Rules:
- matchedProduct must be copied exactly from a post's subject or title, OR "" if no post fits.
- Use confidence >= 0.55 only when the image clearly shows that post's product.
- If unsure or the image fits no post, set matchedProduct to "" and confidence below 0.55.

Return JSON only: imageId, matchedProduct, confidence (0-1), description`,
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `imageId: ${img.id}\nAllowed labels: ${uniqueLabels.join(", ")}`,
              },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
      });

      const matchedProduct =
        match.confidence >= POST_MATCH_CONFIDENCE_THRESHOLD
          ? match.matchedProduct?.trim() ?? ""
          : "";

      results.push({
        imageId: img.id,
        matchedProduct,
        confidence: match.confidence,
        description: match.description,
      });
    } catch (err) {
      console.warn(`Vision match skipped for image ${img.id}:`, err);
    }
  }

  return results;
}

export type ProductImageDescription = {
  description: string;
  visualContext: string;
  confidence: number;
  features?: string[];
};

export type StyleGraphicAnalysis = {
  kind: "style_graphic" | "old_post_graphic" | "product_photo" | "logo";
  styleNotes: string;
  onImageText?: string;
  confidence: number;
};

function coerceVisionText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map((v) => String(v)).join(", ").trim();
  if (value != null && typeof value === "object") {
    return Object.values(value as Record<string, unknown>)
      .map((v) => String(v))
      .join(" ")
      .trim();
  }
  return "";
}

function normalizeImageKind(value: unknown): StyleGraphicAnalysis["kind"] {
  const kind = typeof value === "string" ? value : "";
  if (
    kind === "style_graphic" ||
    kind === "old_post_graphic" ||
    kind === "product_photo" ||
    kind === "logo"
  ) {
    return kind;
  }
  return "product_photo";
}

/** Brief visual identification for graphic grounding — not for captions. */
export async function describeProductImage(
  productName: string,
  imageUrl: string
): Promise<ProductImageDescription> {
  const dataUrl = await getStorage().readAsDataUrl(imageUrl);
  const result = await openRouterChatJSON<{
    visualContext: string;
    productType?: string;
    confidence: number;
    features?: string[];
  }>({
    model: MODELS.vision.model,
    messages: [
      {
        role: "system",
        content: `Identify what this product photo shows in 1-2 short sentences for internal graphic reference only.
Do NOT write marketing copy. Do NOT invent specs. Return JSON: visualContext (max 2 sentences), productType (optional), confidence (0-1), features (optional short list).`,
      },
      {
        role: "user",
        content: [
          { type: "text", text: `Product label: ${productName}` },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  });

  const visualContext = result.visualContext?.trim() ?? "";
  return {
    description: visualContext,
    visualContext,
    confidence: result.confidence ?? 0,
    features: result.features,
  };
}

/** Classify chat uploads: style graphic vs product photo vs logo. */
export async function analyzeUploadedImageIntent(
  imageUrl: string,
  opts?: { hasProjectLogo?: boolean }
): Promise<StyleGraphicAnalysis> {
  const dataUrl = await getStorage().readAsDataUrl(imageUrl);
  const result = await openRouterChatJSON<StyleGraphicAnalysis>({
    model: MODELS.vision.model,
    messages: [
      {
        role: "system",
        content: `Classify this uploaded image for a social content tool.
Return JSON: kind ("style_graphic"|"old_post_graphic"|"product_photo"|"logo"), styleNotes (layout, colors, text density, mood — for graphics), onImageText (optional OCR summary), confidence (0-1).
- style_graphic / old_post_graphic: finished ad, social post, or design mockup
- product_photo: raw photo of a product/equipment on site or in field
- logo: company logo mark`,
      },
      {
        role: "user",
        content: [
          { type: "text", text: `Project already has logo: ${opts?.hasProjectLogo ?? false}` },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  });

  return {
    kind: normalizeImageKind(result.kind),
    styleNotes: coerceVisionText(result.styleNotes),
    onImageText: coerceVisionText(result.onImageText) || undefined,
    confidence: typeof result.confidence === "number" ? result.confidence : 0.5,
  };
}

/** Extract factual product/service info from brochure, label, or spec image — for copy only, not graphics. */
export async function extractProductContextFromImage(
  productName: string,
  imageUrl: string
): Promise<string> {
  const dataUrl = await getStorage().readAsDataUrl(imageUrl);
  const result = await openRouterChatJSON<{ facts: string; confidence: number }>({
    model: MODELS.vision.model,
    messages: [
      {
        role: "system",
        content: `Extract factual product/service information from this image for social post copy.
Return JSON: { "facts": "bullet-style plain text of offers, specs, audience, pricing, features visible in the image", "confidence": 0-1 }
Rules: Facts only — no scene description, no marketing fluff, no guessing beyond visible text/content.
If the image has no useful product info, return facts as "" and low confidence.`,
      },
      {
        role: "user",
        content: [
          { type: "text", text: `Product/service: ${productName}` },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  });

  if ((result.confidence ?? 0) < 0.4) return "";
  return result.facts?.trim() ?? "";
}

/** @deprecated Prefer matchImagesToPosts at createTasks time. */
export async function analyzeImages(
  projectId: string,
  imageIds: string[]
): Promise<VisionMatch[]> {
  return matchImagesToPosts(projectId, imageIds, []);
}
