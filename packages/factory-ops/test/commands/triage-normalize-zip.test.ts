import assert from "node:assert/strict";
import test from "node:test";

import { normalizeIssueUrls } from "../../src/commands/triage-normalize-issues.ts";
import { zipFeaturesToIssues } from "../../src/commands/triage-zip-features.ts";

test("normalizeIssueUrls extracts numeric issue ids", () => {
  const out = normalizeIssueUrls('["https://github.com/o/r/issues/12","bad"]');
  assert.deepEqual(out, [{ issue_number: 12, url: "https://github.com/o/r/issues/12" }]);
});

test("zipFeaturesToIssues aligns by index", () => {
  const out = zipFeaturesToIssues({ featuresRaw: '[{"k":1}]', issueIndexRaw: '[{"issue_number":12,"url":"u"}]' });
  assert.equal(out.length, 1);
  assert.equal(out[0].issue_number, 12);
  assert.equal(out[0].issue_url, "u");
});
