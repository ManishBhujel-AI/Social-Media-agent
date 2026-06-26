import type { PageFetchCache } from "./pageFetchCache";
import { analyzeHtmlPageWithBudget } from "./htmlParse";

/** Max chars from the About page excerpt merged into brand context. */
export const BRAND_CONTEXT_ABOUT_EXCERPT_CHARS = 8_000;
/** Cap total merged homepage + About text sent to LLMs. */
export const BRAND_CONTEXT_MAX_TEXT_CHARS = 20_000;

const ABOUT_PATH_RE =
  /\/(about(?:-us)?|our-story|who-we-are|company|about_us)(?:\/|$|\?|#)/i;

function normalizePath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname.replace(/\/+$/, "").toLowerCase() || "/";
  } catch {
    return "";
  }
}

function aboutPathScore(pathname: string): number {
  const path = pathname.replace(/\/+$/, "").toLowerCase() || "/";
  if (path === "/about" || path === "/about-us") return 0;
  if (path.includes("about")) return 1;
  if (path.includes("our-story") || path.includes("who-we-are")) return 2;
  return 3;
}

/** Pick the best internal About page URL from homepage links, if any. */
export function pickAboutPageUrl(homeUrl: string, internalLinks: string[]): string | null {
  let homeOrigin: string;
  try {
    homeOrigin = new URL(homeUrl).origin;
  } catch {
    return null;
  }

  const homePath = normalizePath(homeUrl);
  const seen = new Set<string>();
  const candidates: Array<{ url: string; score: number }> = [];

  for (const link of internalLinks) {
    try {
      const parsed = new URL(link);
      if (parsed.origin !== homeOrigin) continue;
      if (!ABOUT_PATH_RE.test(parsed.pathname)) continue;

      const normalized = parsed.href.split("#")[0];
      if (seen.has(normalized)) continue;
      seen.add(normalized);

      const path = normalizePath(normalized);
      if (path === homePath) continue;

      candidates.push({ url: normalized, score: aboutPathScore(path) });
    } catch {
      /* skip invalid */
    }
  }

  candidates.sort((a, b) => a.score - b.score);
  return candidates[0]?.url ?? null;
}

export type BrandContextFetchResult =
  | { ok: true; html: string; text: string; finalUrl: string; aboutUrl?: string }
  | { ok: false; error: string };

/**
 * Fetch homepage text for brand kit setup, plus an About page when linked from the homepage.
 */
export async function fetchBrandContextPages(
  pageCache: PageFetchCache,
  url: string
): Promise<BrandContextFetchResult> {
  const home = await pageCache.fetchPageHtml(url);
  if (!home.ok) return { ok: false, error: home.error };

  const homeAnalysis = analyzeHtmlPageWithBudget(home.html, home.finalUrl);
  let text = homeAnalysis.text;
  if (!text.trim()) return { ok: false, error: "couldn't read the site" };

  let aboutUrl: string | undefined;
  const pickedAbout = pickAboutPageUrl(home.finalUrl, homeAnalysis.internalLinks);
  if (pickedAbout) {
    const about = await pageCache.fetchPageHtml(pickedAbout);
    if (about.ok) {
      const aboutAnalysis = analyzeHtmlPageWithBudget(about.html, about.finalUrl);
      const aboutText = aboutAnalysis.text.trim();
      if (aboutText) {
        aboutUrl = about.finalUrl;
        text = [
          `--- HOMEPAGE (${home.finalUrl}) ---`,
          text,
          "",
          `--- ABOUT (${about.finalUrl}) ---`,
          aboutText.slice(0, BRAND_CONTEXT_ABOUT_EXCERPT_CHARS),
        ].join("\n");
      }
    }
  }

  return {
    ok: true,
    html: home.html,
    text: text.slice(0, BRAND_CONTEXT_MAX_TEXT_CHARS),
    finalUrl: home.finalUrl,
    aboutUrl,
  };
}
