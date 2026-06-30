/** User-facing label for a failed post task. */
export function formatTaskFailureLabel(error: string): string {
  if (/key limit exceeded/i.test(error)) {
    return "OpenRouter API limit reached — wait and retry";
  }
  if (/Failed to parse OpenRouter JSON|JSON parse failed|Unexpected token/i.test(error)) {
    return "Caption generation failed — AI returned an invalid format. Retry usually fixes this.";
  }
  if (/No image data in OpenRouter/i.test(error)) {
    return "Image generation failed — no image returned. Retry usually fixes this.";
  }
  if (/empty caption|incomplete fields|incomplete graphicCopy|unrecognizable JSON/i.test(error)) {
    return "Caption generation failed — AI returned an invalid format. Retry usually fixes this.";
  }
  if (/Brand kit is incomplete/i.test(error)) {
    return "Brand kit incomplete — finish setup in Settings, then retry";
  }
  if (/Task has no caption/i.test(error)) {
    return "Post stopped before caption was written — retry";
  }
  const trimmed = error.replace(/\s+/g, " ").trim();
  if (!trimmed) return "Failed — retry";
  return trimmed.length > 140 ? `${trimmed.slice(0, 137)}…` : trimmed;
}
