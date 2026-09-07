import assert from "node:assert/strict";
import test from "node:test";

import { htmlToMarkdown } from "../src/html-to-markdown.ts";

test("htmlToMarkdown converts basic HTML to markdown", () => {
  const html = "<h1>Hello</h1><p>World</p>";
  const result = htmlToMarkdown(html);
  assert.ok(result.includes("Hello"));
  assert.ok(result.includes("World"));
});

test("htmlToMarkdown converts links", () => {
  const html = '<p>Visit <a href="https://example.com">Example</a></p>';
  const result = htmlToMarkdown(html);
  assert.ok(result.includes("[Example](https://example.com)"));
});

test("htmlToMarkdown converts code blocks", () => {
  const html = "<pre><code>const x = 1;</code></pre>";
  const result = htmlToMarkdown(html);
  assert.ok(result.includes("const x = 1;"));
});

test("htmlToMarkdown strips empty links", () => {
  const html = '<p>Text <a href="https://example.com"></a> more text</p>';
  const result = htmlToMarkdown(html);
  assert.ok(!result.includes("[]"));
});

test("htmlToMarkdown collapses excessive newlines", () => {
  const html = "<p>A</p><br><br><br><br><p>B</p>";
  const result = htmlToMarkdown(html);
  assert.ok(!result.includes("\n\n\n\n"));
});

test("htmlToMarkdown returns empty string for empty input", () => {
  assert.equal(htmlToMarkdown(""), "");
  assert.equal(htmlToMarkdown(null), "");
  assert.equal(htmlToMarkdown(undefined), "");
});
