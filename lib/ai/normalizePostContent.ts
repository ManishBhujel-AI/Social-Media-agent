import type { PostContentResponse } from "./postContent";

function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function topicScore(topic: string | undefined, candidate: Record<string, unknown>): number {
  if (!topic?.trim()) return 0;
  const hint = topic.trim().toLowerCase();
  const fields = ["postTopic", "topic", "subject", "product", "title", "name"];
  for (const key of fields) {
    const value = candidate[key];
    if (typeof value === "string" && value.trim().toLowerCase().includes(hint)) return 20;
    if (typeof value === "string" && hint.includes(value.trim().toLowerCase())) return 15;
  }
  const caption = pickString(candidate, ["caption", "postCaption", "body"]);
  if (caption.toLowerCase().includes(hint.split(/\s+/)[0] ?? "")) return 5;
  return 0;
}

function scorePostCandidate(candidate: Record<string, unknown>, topicHint?: string): number {
  let score = 0;
  const caption = pickString(candidate, ["caption", "postCaption", "body", "text"]);
  if (caption) score += 10 + Math.min(caption.length / 200, 5);

  const gc = candidate.graphicCopy;
  if (gc && typeof gc === "object" && !Array.isArray(gc)) {
    const g = gc as Record<string, unknown>;
    if (pickString(g, ["headline"])) score += 4;
    if (pickString(g, ["subheadline", "supportingLine", "supporting", "tagline"])) score += 3;
    if (pickString(g, ["cta", "callToAction"])) score += 2;
  } else {
    if (pickString(candidate, ["headline"])) score += 2;
  }

  if (pickString(candidate, ["imagePrompt", "image_prompt", "scene", "visualPrompt"])) score += 3;
  score += topicScore(topicHint, candidate);
  return score;
}

export function pickBestPostPayload(items: unknown[], topicHint?: string): unknown {
  let best: Record<string, unknown> | null = null;
  let bestScore = -1;
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    const score = scorePostCandidate(rec, topicHint);
    if (score > bestScore) {
      bestScore = score;
      best = rec;
    }
  }
  return best ?? items[0];
}

function normalizeGraphicCopy(raw: unknown): PostContentResponse["graphicCopy"] {
  const source =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  const headline = pickString(source, ["headline", "title", "hook"]);
  const subheadline = pickString(source, [
    "subheadline",
    "supportingLine",
    "supporting",
    "tagline",
    "subtitle",
  ]);
  const bullet = pickString(source, ["bullet", "badge", "supportingDetail"]) || undefined;
  let cta = pickString(source, ["cta", "callToAction", "call_to_action"]);

  // Some models put CTA-ish text only in badge when cta is missing.
  if (!cta && bullet && /visit|shop|stock|call|learn|order|get/i.test(bullet)) {
    cta = bullet;
  }

  return {
    headline: headline.replace(/\s*\n+\s*/g, " ").trim(),
    subheadline: subheadline.replace(/\s*\n+\s*/g, " ").trim(),
    bullet: bullet?.replace(/\s*\n+\s*/g, " ").trim() || undefined,
    cta: cta.replace(/\s*\n+\s*/g, " ").trim(),
  };
}

/** Normalize batched or alternate-schema model output into post content fields. */
export function normalizePostContentPayload(
  raw: unknown,
  topicHint?: string
): PostContentResponse | null {
  let obj = raw;
  if (Array.isArray(obj)) {
    obj = pickBestPostPayload(obj, topicHint);
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;

  const rec = obj as Record<string, unknown>;
  const caption = pickString(rec, ["caption", "postCaption", "body", "text", "post_text"]);
  const imagePrompt = pickString(rec, ["imagePrompt", "image_prompt", "scene", "visualPrompt"]);

  const graphicCopy = normalizeGraphicCopy(
    rec.graphicCopy && typeof rec.graphicCopy === "object" ? rec.graphicCopy : rec
  );

  if (!caption && !graphicCopy.headline && !imagePrompt) return null;

  return {
    caption,
    graphicCopy,
    imagePrompt,
  };
}

export function isCompletePostContent(
  payload: PostContentResponse | null
): payload is PostContentResponse {
  if (!payload) return false;
  return Boolean(
    payload.caption?.trim() &&
      payload.graphicCopy?.headline?.trim() &&
      payload.graphicCopy?.subheadline?.trim() &&
      payload.graphicCopy?.cta?.trim() &&
      payload.imagePrompt?.trim()
  );
}
