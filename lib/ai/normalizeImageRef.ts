/** MIME types accepted by GPT Image input_references. */
export const IMAGE_MODEL_SUPPORTED_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export function mimeFromPath(urlOrPath: string): string {
  const name = urlOrPath.split("/").pop()?.split("?")[0] ?? "";
  const ext = name.includes(".") ? name.split(".").pop()?.toLowerCase() : "";
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "avif":
      return "image/avif";
    default:
      return "application/octet-stream";
  }
}

/** Re-label data URLs using the file extension — local storage used to mark webp/avif as jpeg. */
export function normalizeDataUrlForImageModel(
  dataUrl: string,
  sourceUrl: string
): string | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;

  const mime = mimeFromPath(sourceUrl);
  if (!IMAGE_MODEL_SUPPORTED_MIMES.has(mime)) return null;

  return `data:${mime};base64,${match[2]}`;
}

export function unsupportedImageMessage(sourceUrl: string): string {
  const ext = sourceUrl.split(".").pop()?.split("?")[0]?.toUpperCase() ?? "unknown";
  return `${ext} is not supported for graphic generation — use JPG, PNG, or WEBP photos.`;
}
