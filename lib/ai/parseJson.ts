/** Strip markdown ```json fences and trim model output before JSON.parse. */
export function stripJsonFences(raw: string): string {
  let s = raw.trim();
  const fenced = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) s = fenced[1].trim();
  return s;
}

export function parseModelJson<T>(raw: string, context?: string): T {
  const trimmed = stripJsonFences(raw);
  if (!trimmed) {
    throw new Error(`Empty JSON content${context ? ` (${context})` : ""}`);
  }
  try {
    return JSON.parse(trimmed) as T;
  } catch (err) {
    console.error(
      `JSON parse failed${context ? ` (${context})` : ""}. Raw (first 500 chars):`,
      raw.slice(0, 500)
    );
    throw err;
  }
}
