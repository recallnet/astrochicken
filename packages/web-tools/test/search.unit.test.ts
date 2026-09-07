import assert from "node:assert/strict";
import test from "node:test";

import { braveSearch, parseSearchArgs } from "../src/search.ts";

// --- Arg parsing ---

test("parseSearchArgs extracts query from positional args", () => {
  const result = parseSearchArgs(["hello", "world"]);
  assert.equal(result.query, "hello world");
  assert.equal(result.count, 5);
  assert.equal(result.content, false);
  assert.equal(result.country, "US");
  assert.equal(result.freshness, null);
});

test("parseSearchArgs extracts -n flag", () => {
  const result = parseSearchArgs(["-n", "10", "test", "query"]);
  assert.equal(result.count, 10);
  assert.equal(result.query, "test query");
});

test("parseSearchArgs extracts --content flag", () => {
  const result = parseSearchArgs(["--content", "test"]);
  assert.equal(result.content, true);
  assert.equal(result.query, "test");
});

test("parseSearchArgs extracts --country flag", () => {
  const result = parseSearchArgs(["--country", "GB", "test"]);
  assert.equal(result.country, "GB");
});

test("parseSearchArgs extracts --freshness flag", () => {
  const result = parseSearchArgs(["--freshness", "pw", "test"]);
  assert.equal(result.freshness, "pw");
});

test("parseSearchArgs caps count at 20", () => {
  const result = parseSearchArgs(["-n", "50", "test"]);
  assert.equal(result.count, 20);
});

test("parseSearchArgs returns empty query when no args", () => {
  const result = parseSearchArgs([]);
  assert.equal(result.query, "");
});

// --- braveSearch with mock ---

interface MockFetchOptions {
  headers: Record<string, string>;
}

test("braveSearch calls Brave API and returns structured results", async () => {
  const mockFetch = async (url: string | URL | Request, opts: RequestInit | undefined): Promise<Response> => {
    assert.ok(String(url).includes("api.search.brave.com"));
    assert.ok(String(url).includes("q=test+query"));
    assert.equal((opts?.headers as Record<string, string>)["X-Subscription-Token"], "test-key");
    return {
      ok: true,
      json: async () => ({
        web: {
          results: [
            { title: "Result 1", url: "https://example.com/1", description: "Snippet 1", age: "2d" },
            { title: "Result 2", url: "https://example.com/2", description: "Snippet 2", age: "1w" },
          ],
        },
      }),
    } as unknown as Response;
  };

  const results = await braveSearch("test query", { apiKey: "test-key", fetchFn: mockFetch as typeof fetch });
  assert.equal(results.length, 2);
  assert.equal(results[0].title, "Result 1");
  assert.equal(results[0].url, "https://example.com/1");
  assert.equal(results[0].snippet, "Snippet 1");
  assert.equal(results[0].age, "2d");
});

test("braveSearch returns empty array for no results", async () => {
  const mockFetch = async (): Promise<Response> => ({
    ok: true,
    json: async () => ({ web: { results: [] } }),
  } as unknown as Response);
  const results = await braveSearch("nothing", { apiKey: "key", fetchFn: mockFetch as typeof fetch });
  assert.equal(results.length, 0);
});

test("braveSearch throws on API error", async () => {
  const mockFetch = async (): Promise<Response> => ({
    ok: false,
    status: 429,
    statusText: "Too Many Requests",
    text: async () => "rate limited",
  } as unknown as Response);
  await assert.rejects(
    () => braveSearch("test", { apiKey: "key", fetchFn: mockFetch as typeof fetch }),
    { message: /429/ },
  );
});

test("braveSearch throws when no API key", async () => {
  await assert.rejects(
    () => braveSearch("test", { apiKey: "" }),
    { message: /BRAVE_API_KEY/ },
  );
});

test("braveSearch respects count option", async () => {
  const mockFetch = async (url: string | URL | Request): Promise<Response> => {
    assert.ok(String(url).includes("count=3"));
    return {
      ok: true,
      json: async () => ({ web: { results: [] } }),
    } as unknown as Response;
  };
  await braveSearch("test", { apiKey: "key", count: 3, fetchFn: mockFetch as typeof fetch });
});
