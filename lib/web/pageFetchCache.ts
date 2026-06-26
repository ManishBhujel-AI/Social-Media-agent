const FETCH_TIMEOUT_MS = 10_000;
const USER_AGENT = "BrewlineBot/1.0";

export type PageFetchSuccess = {
  ok: true;
  html: string;
  finalUrl: string;
  fromCache: boolean;
};

export type PageFetchFailure = {
  ok: false;
  error: string;
};

export type PageFetchResult = PageFetchSuccess | PageFetchFailure;

export type PageFetchCacheOptions = {
  projectId: string;
  fetchFn?: typeof fetch;
};

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.href;
  } catch {
    return url.trim();
  }
}

/**
 * Request-scoped homepage HTML cache.
 * Create one instance per chat turn; summarizeBusiness reuses cached homepage HTML per URL.
 */
export class PageFetchCache {
  private readonly cache = new Map<string, { html: string; finalUrl: string }>();
  private networkFetchCount = 0;

  constructor(
    private readonly projectId: string,
    private readonly fetchFn: typeof fetch = fetch
  ) {}

  cacheKey(url: string): string {
    return `${this.projectId}:${normalizeUrl(url)}`;
  }

  /** Number of actual network fetches performed (not cache hits). */
  get networkFetches(): number {
    return this.networkFetchCount;
  }

  async fetchPageHtml(url: string): Promise<PageFetchResult> {
    const key = this.cacheKey(url);
    const cached = this.cache.get(key);
    if (cached) {
      return { ok: true, ...cached, fromCache: true };
    }

    try {
      this.networkFetchCount += 1;
      const res = await this.fetchFn(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: "follow",
      });
      if (!res.ok) {
        return { ok: false, error: "couldn't read the site" };
      }
      const html = await res.text();
      const finalUrl = res.url || normalizeUrl(url);
      const entry = { html, finalUrl };
      this.cache.set(key, entry);
      return { ok: true, ...entry, fromCache: false };
    } catch {
      return { ok: false, error: "couldn't read the site" };
    }
  }

  /**
   * Download a binary asset (e.g. logo image) with the same timeout policy.
   * Not cached — callers persist to storage.
   */
  async fetchAsset(
    absoluteUrl: string
  ): Promise<{ ok: true; buffer: Buffer; mime: string } | PageFetchFailure> {
    try {
      const res = await this.fetchFn(absoluteUrl, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        redirect: "follow",
      });
      if (!res.ok) {
        return { ok: false, error: "couldn't read the site" };
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      const mime = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "image/png";
      return { ok: true, buffer, mime };
    } catch {
      return { ok: false, error: "couldn't read the site" };
    }
  }
}

export function createPageFetchCache(options: PageFetchCacheOptions): PageFetchCache {
  return new PageFetchCache(options.projectId, options.fetchFn);
}
