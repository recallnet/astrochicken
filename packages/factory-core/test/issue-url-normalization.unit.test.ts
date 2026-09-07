import test from "node:test";
import assert from "node:assert/strict";

import { normalizeIssueUrlArray, normalizeIssueUrlEntry } from "../src/issue-url-normalization.ts";

test("normalizeIssueUrlEntry accepts direct issue URLs and nested JSON strings", () => {
  assert.equal(
    normalizeIssueUrlEntry("https://github.com/recallnet/astrochicken/issues/42"),
    "https://github.com/recallnet/astrochicken/issues/42",
  );
  assert.equal(
    normalizeIssueUrlEntry("{\"issue_url\":\"https://github.com/recallnet/astrochicken/issues/43\"}"),
    "https://github.com/recallnet/astrochicken/issues/43",
  );
});

test("normalizeIssueUrlArray trims, filters, and deduplicates issue URLs", () => {
  const normalized = normalizeIssueUrlArray(JSON.stringify([
    " https://github.com/recallnet/astrochicken/issues/42 ",
    { issue_url: "https://github.com/recallnet/astrochicken/issues/43" },
    "https://github.com/recallnet/astrochicken/issues/42",
    "https://github.com/recallnet/astrochicken/pull/99",
    "",
  ]));

  assert.equal(
    normalized,
    JSON.stringify([
      "https://github.com/recallnet/astrochicken/issues/42",
      "https://github.com/recallnet/astrochicken/issues/43",
    ]),
  );
});
