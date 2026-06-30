import { stripJsonFences } from "./parseJson";
import { pickBestPostPayload } from "./normalizePostContent";

function tryParse(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractBalancedSlice(text: string, start: number): string | null {
  const open = text[start];
  const close = open === "{" ? "}" : open === "[" ? "]" : null;
  if (!close) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === open) depth += 1;
    if (ch === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function unwrapPostLikePayload(value: unknown, topicHint?: string): unknown {
  if (Array.isArray(value)) {
    return pickBestPostPayload(value, topicHint);
  }
  return value;
}

function isUsablePayload(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/** Pull the first valid JSON object/array from noisy model text (markdown, multi-post batches). */
export function extractJsonFromModelText(raw: string, context?: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error(`Empty JSON content${context ? ` (${context})` : ""}`);
  }

  const candidates: string[] = [];
  const seen = new Set<string>();
  const push = (s: string) => {
    const t = s.trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    candidates.push(t);
  };

  push(stripJsonFences(trimmed));

  for (const m of Array.from(trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi))) {
    push(m[1]);
  }

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch !== "{" && ch !== "[") continue;
    const slice = extractBalancedSlice(trimmed, i);
    if (slice) push(slice);
  }

  for (const candidate of candidates) {
    const parsed = tryParse(candidate);
    if (parsed === null) continue;
    const unwrapped = unwrapPostLikePayload(parsed);
    if (isUsablePayload(unwrapped)) {
      return JSON.stringify(unwrapped);
    }
  }

  throw new Error(
    `Could not extract JSON${context ? ` (${context})` : ""} from model output (first 500 chars): ${trimmed.slice(0, 500)}`
  );
}
