import assert from "node:assert/strict";
import test from "node:test";

import { fetchContent } from "../src/content.ts";

test("fetchContent returns markdown for a valid URL", async () => {
  // Use a simple, stable raw GitHub URL
  const result = await fetchContent("https://raw.githubusercontent.com/karpathy/autoresearch/master/README.md");
  assert.ok(result.markdown.length > 100, "should return substantial content");
  assert.equal(result.url, "https://raw.githubusercontent.com/karpathy/autoresearch/master/README.md");
});

test("fetchContent returns error for invalid URL", async () => {
  const result = await fetchContent("https://this-domain-does-not-exist-at-all-xyz.example");
  assert.ok(result.error, "should have an error");
  assert.equal(result.markdown, "");
});

test("fetchContent returns error for empty URL", async () => {
  const result = await fetchContent("");
  assert.ok(result.error);
});

test("fetchContent respects timeout", async () => {
  // Use a URL that would hang — the timeout should kick in
  const result = await fetchContent("https://httpstat.us/200?sleep=30000", { timeoutMs: 1000 });
  assert.ok(result.error, "should timeout");
});
