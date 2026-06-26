import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import { isJunkImageUrl } from "@/lib/ai/productImageQuality";

export const MAX_HTML_CHARS = 2_000_000;
export const PARSE_BUDGET_MS = 3_000;

export type ParsedHtmlPage = {
  $: CheerioAPI;
  pageUrl: string;
};

export type HtmlPageAnalysis = {
  text: string;
  internalLinks: string[];
  imageSrcs: string[];
  ogImage: string | null;
};

function stripTagsFallback(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 12000);
}

/** Load HTML once with cheerio (no CSS/DOM engine). Returns null on failure. */
export function parseHtmlPage(html: string, pageUrl: string): ParsedHtmlPage | null {
  try {
    const trimmed = html.length > MAX_HTML_CHARS ? html.slice(0, MAX_HTML_CHARS) : html;
    const $ = cheerio.load(trimmed, { xml: false });
    return { $, pageUrl };
  } catch {
    return null;
  }
}

function isJunkCheerioImage($: CheerioAPI, el: Parameters<CheerioAPI>[0]): boolean {
  const img = $(el);
  const src = img.attr("src") ?? img.attr("data-src") ?? "";
  if (!src || src.startsWith("data:image/svg")) return true;
  if (isJunkImageUrl(src)) return true;

  const alt = (img.attr("alt") ?? "").toLowerCase();
  if (/(logo|icon|badge|avatar|menu|nav)/i.test(alt)) return true;

  const cls = (img.attr("class") ?? "").toLowerCase();
  const id = (img.attr("id") ?? "").toLowerCase();
  if (/(logo|icon|badge|avatar|nav|menu|header|footer|sprite|spacer)/i.test(`${cls} ${id}`)) {
    return true;
  }

  const w = parseInt(img.attr("width") ?? "", 10);
  const h = parseInt(img.attr("height") ?? "", 10);
  if ((w > 0 && w < 200) || (h > 0 && h < 200)) return true;

  const parent = img.parent();
  if (parent.length) {
    const tag = parent.prop("tagName")?.toLowerCase() ?? "";
    if (tag === "nav" || tag === "header" || tag === "footer" || tag === "button") return true;
    const parentCls = (parent.attr("class") ?? "").toLowerCase();
    if (/(nav|menu|header|footer|breadcrumb|sidebar|toolbar|icon)/i.test(parentCls)) return true;
  }

  return false;
}

function absoluteUrl(raw: string, pageUrl: string): string | null {
  try {
    return new URL(raw, pageUrl).href;
  } catch {
    return null;
  }
}

/** Single-pass extraction: readable text, links, and image candidates. */
export function analyzeHtmlPage(html: string, pageUrl: string): HtmlPageAnalysis {
  const empty: HtmlPageAnalysis = {
    text: "",
    internalLinks: [],
    imageSrcs: [],
    ogImage: null,
  };

  try {
    const parsed = parseHtmlPage(html, pageUrl);
    if (!parsed) {
      return { ...empty, text: stripTagsFallback(html) };
    }

    const { $ } = parsed;
    $("script, style, noscript, iframe, svg").remove();

    const mainText = $("main").first().text().trim();
    const articleText = $("article").first().text().trim();
    const bodyText = $("body").text().trim();
    const text = (mainText || articleText || bodyText || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 12000);

    const origin = new URL(pageUrl).origin;
    const links = new Set<string>();
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:")) return;
      const absolute = absoluteUrl(href, pageUrl);
      if (absolute?.startsWith(origin)) links.add(absolute.split("#")[0]);
    });

    const ogImage =
      $('meta[property="og:image"]').attr("content") ??
      $('meta[name="twitter:image"]').attr("content") ??
      null;

    const imageSrcs: string[] = [];
    const seenImages = new Set<string>();

    const pushImage = (raw: string | undefined) => {
      if (!raw) return;
      const url = absoluteUrl(raw, pageUrl);
      if (!url || seenImages.has(url) || isJunkImageUrl(url)) return;
      seenImages.add(url);
      imageSrcs.push(url);
    };

    if (ogImage) pushImage(ogImage);

    const selectors = [
      "main img",
      "article img",
      '[class*="product"] img',
      ".woocommerce-product-gallery img",
      ".product-image img",
      ".product__media img",
      "#product img",
      "img",
    ];

    for (const selector of selectors) {
      $(selector).each((_, el) => {
        if (isJunkCheerioImage($, el)) return;
        pushImage($(el).attr("src"));
        pushImage($(el).attr("data-src"));
        pushImage($(el).attr("data-lazy-src"));
      });
      if (imageSrcs.length >= 12) break;
    }

    return {
      text: text || stripTagsFallback(html),
      internalLinks: Array.from(links).slice(0, 40),
      imageSrcs: imageSrcs.slice(0, 12),
      ogImage: ogImage ? absoluteUrl(ogImage, pageUrl) : null,
    };
  } catch {
    return { ...empty, text: stripTagsFallback(html) };
  }
}

export async function withTimeBudget<T>(
  ms: number,
  fn: () => Promise<T>,
  fallback: T
): Promise<T> {
  try {
    return await Promise.race([
      fn(),
      new Promise<T>((_, reject) => {
        setTimeout(() => reject(new Error("time budget exceeded")), ms);
      }),
    ]);
  } catch {
    return fallback;
  }
}

/** Synchronous parse guarded by a coarse deadline (for CPU-bound cheerio work). */
export function analyzeHtmlPageWithBudget(
  html: string,
  pageUrl: string,
  budgetMs = PARSE_BUDGET_MS
): HtmlPageAnalysis {
  const start = Date.now();
  try {
    const result = analyzeHtmlPage(html, pageUrl);
    if (Date.now() - start > budgetMs) {
      return {
        text: result.text.slice(0, 4000),
        internalLinks: result.internalLinks.slice(0, 15),
        imageSrcs: result.imageSrcs.slice(0, 4),
        ogImage: result.ogImage,
      };
    }
    return result;
  } catch {
    return {
      text: stripTagsFallback(html).slice(0, 4000),
      internalLinks: [],
      imageSrcs: [],
      ogImage: null,
    };
  }
}
