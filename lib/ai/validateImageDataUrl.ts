const IMAGE_MIME = /^image\/(png|jpe?g|webp|gif)$/i;

/** MIME types OpenRouter vision accepts for inline image_url data URLs. */
export function isImageMime(mime: string | null | undefined): boolean {
  return Boolean(mime?.trim() && IMAGE_MIME.test(mime.trim()));
}

/**
 * Validate a data-URL before sending to vision APIs.
 * Rejects empty, non-image, or undecodable payloads (e.g. scraped HTML saved as "image").
 */
export function isValidImageDataUrl(dataUrl: string): boolean {
  if (!dataUrl?.trim()) return false;

  const match = dataUrl.match(/^data:(image\/[^;]+);base64,([\s\S]+)$/i);
  if (!match) return false;

  const [, mime, b64] = match;
  if (!isImageMime(mime)) return false;

  const raw = b64.replace(/\s/g, "");
  if (raw.length < 32) return false;

  try {
    const buf = Buffer.from(raw, "base64");
    return buf.length >= 16;
  } catch {
    return false;
  }
}
