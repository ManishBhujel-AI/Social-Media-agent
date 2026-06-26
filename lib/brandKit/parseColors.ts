const HEX_RE = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;
const RGB_RE = /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/gi;

export function normalizeHex(hex: string): string | null {
  const raw = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{3,8}$/.test(raw)) return null;
  if (raw.length === 3) {
    return `#${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}`.toUpperCase();
  }
  if (raw.length === 6) return `#${raw.toUpperCase()}`;
  return null;
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, n));
  return `#${[clamp(r), clamp(g), clamp(b)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

export function extractHexColorsFromText(text: string): string[] {
  const found = new Set<string>();
  const hexMatches = text.match(HEX_RE) ?? [];
  for (const match of hexMatches) {
    const normalized = normalizeHex(match);
    if (normalized) found.add(normalized);
  }
  let rgbMatch: RegExpExecArray | null;
  const rgbRe = new RegExp(RGB_RE.source, RGB_RE.flags);
  while ((rgbMatch = rgbRe.exec(text)) !== null) {
    const hex = rgbToHex(Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3]));
    found.add(hex);
  }
  return Array.from(found);
}

export function rankColorsByFrequency(colors: string[]): string[] {
  const counts = new Map<string, number>();
  for (const c of colors) counts.set(c, (counts.get(c) ?? 0) + 1);
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([c]) => c);
}
