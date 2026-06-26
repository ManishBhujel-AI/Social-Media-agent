import type { PageFetchCache } from "./pageFetchCache";
import { extractHexColorsFromText, rankColorsByFrequency } from "@/lib/brandKit/parseColors";

export type BrandSignals = {
  colorHexes: string[];
  contactHints: string[];
};

const PHONE_RE =
  /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}/g;

function extractMetaColor(html: string): string[] {
  const colors: string[] = [];
  const theme = html.match(/<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)["']/i);
  if (theme?.[1]) colors.push(...extractHexColorsFromText(theme[1]));
  const tile = html.match(
    /<meta[^>]+name=["']msapplication-TileColor["'][^>]+content=["']([^"']+)["']/i
  );
  if (tile?.[1]) colors.push(...extractHexColorsFromText(tile[1]));
  return colors;
}

function extractInlineStyleColors(html: string): string[] {
  const styleBlocks = html.match(/style=["']([^"']+)["']/gi) ?? [];
  const colors: string[] = [];
  for (const block of styleBlocks.slice(0, 40)) {
    colors.push(...extractHexColorsFromText(block));
  }
  return colors;
}

function extractStylesheetUrls(html: string, pageUrl: string): string[] {
  const urls: string[] = [];
  const re = /<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) && urls.length < 3) {
    try {
      urls.push(new URL(match[1], pageUrl).href);
    } catch {
      /* skip */
    }
  }
  return urls.slice(0, 2);
}

export async function extractBrandSignals(
  html: string,
  pageUrl: string,
  pageCache: PageFetchCache
): Promise<BrandSignals> {
  const colorHexes: string[] = [
    ...extractMetaColor(html),
    ...extractInlineStyleColors(html),
  ];

  for (const sheetUrl of extractStylesheetUrls(html, pageUrl)) {
    try {
      const asset = await pageCache.fetchAsset(sheetUrl);
      if (asset.ok) {
        const css = asset.buffer.toString("utf8").slice(0, 80_000);
        colorHexes.push(...extractHexColorsFromText(css));
      }
    } catch {
      /* best-effort */
    }
  }

  const textSample = html.replace(/<[^>]+>/g, " ").slice(0, 20_000);
  const contactHints = Array.from(textSample.matchAll(PHONE_RE))
    .map((m) => m[0].trim())
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 3);

  return {
    colorHexes: rankColorsByFrequency(colorHexes).slice(0, 8),
    contactHints,
  };
}
