#!/usr/bin/env tsx
/**
 * PageFetchCache unit test — verifies cache hit avoids second network fetch.
 */
import assert from "node:assert/strict";
import { PageFetchCache } from "../lib/web/pageFetchCache";

async function testCacheHit() {
  let fetchCalls = 0;
  const mockFetch: typeof fetch = async (input) => {
    fetchCalls += 1;
    const url = String(input);
    return new Response(`<html><body>Page for ${url}</body></html>`, {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  };

  const cache = new PageFetchCache("proj_test", mockFetch);
  const url = "https://example.com/";

  const first = await cache.fetchPageHtml(url);
  assert.equal(first.ok, true);
  if (first.ok) {
    assert.equal(first.fromCache, false);
    assert.match(first.html, /Page for/);
  }

  const second = await cache.fetchPageHtml(url);
  assert.equal(second.ok, true);
  if (second.ok) {
    assert.equal(second.fromCache, true);
  }

  assert.equal(fetchCalls, 1, "expected exactly one network fetch");
  assert.equal(cache.networkFetches, 1);
}

async function testFailureIsSoft() {
  const mockFetch: typeof fetch = async () => {
    throw new Error("timeout");
  };
  const cache = new PageFetchCache("proj_fail", mockFetch);
  const result = await cache.fetchPageHtml("https://offline.example/");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, "couldn't read the site");
  }
}

async function testDistinctUrlsFetchTwice() {
  let fetchCalls = 0;
  const mockFetch: typeof fetch = async () => {
    fetchCalls += 1;
    return new Response("<html></html>", { status: 200 });
  };
  const cache = new PageFetchCache("proj_two", mockFetch);
  await cache.fetchPageHtml("https://a.example/");
  await cache.fetchPageHtml("https://b.example/");
  assert.equal(fetchCalls, 2);
}

async function main() {
  await testCacheHit();
  await testFailureIsSoft();
  await testDistinctUrlsFetchTwice();
  console.log("PASS: test-page-cache (3 checks)");
}

main().catch((err) => {
  console.error("FAIL: test-page-cache", err);
  process.exit(1);
});
