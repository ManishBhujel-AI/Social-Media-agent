import type { BrandColor } from "./types";
import { normalizeHex } from "./parseColors";

export function parseColorAnswer(raw: string): BrandColor[] {
  const parts = raw
    .split(/[,;\n]+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const colors: BrandColor[] = [];
  for (const part of parts) {
    const hexMatch = part.match(/#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/);
    if (hexMatch) {
      const hex = normalizeHex(hexMatch[0]);
      const name = part.replace(hexMatch[0], "").replace(/[()]/g, "").trim() || "color";
      colors.push(hex ? { name, hex } : { name: part });
      continue;
    }
    colors.push({ name: part });
  }
  return colors;
}

export function parseAvoidColorsAnswer(raw: string): string[] {
  return raw
    .split(/[,;\n]+/)
    .map((p) => p.trim())
    .filter(Boolean);
}
