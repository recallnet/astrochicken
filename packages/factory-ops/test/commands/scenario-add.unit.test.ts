import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { scenarioAdd } from "../../src/commands/scenario-add.ts";

test("scenarioAdd writes minimal-format SCENARIO.md in curated registry layout", () => {
  const root = mkdtempSync(join(tmpdir(), "scenario-add-"));

  const out = scenarioAdd({
    registryRoot: root,
    id: "post-merge-regression-shield",
    domain: "post-merge",
    priority: "high",
    truth: "Judge must block merges that violate post-merge holdout truths.\nIf no matching truths exist, fail closed instead of approving.",
    created: "2026-03-16",
  });

  assert.equal(out.ok, true);
  assert.match(out.path, /post-merge\/post-merge-regression-shield\/SCENARIO\.md$/);
  const written = readFileSync(out.path, "utf8");
  assert.match(written, /^---\nid: post-merge-regression-shield\ndomain: post-merge\npriority: high\ncreated: 2026-03-16\nstatus: active\nauthors: \[scenario-ops\]\n---\n\n/m);
  assert.match(written, /Judge must block merges/);
  assert.equal(out.truth_line_count, "2");
});

test("scenarioAdd fails when truth exceeds 5 non-empty lines", () => {
  const root = mkdtempSync(join(tmpdir(), "scenario-add-"));

  const out = scenarioAdd({
    registryRoot: root,
    id: "line-limit-check",
    domain: "post-merge",
    priority: "medium",
    created: "2026-03-16",
    truth: "l1\nl2\nl3\nl4\nl5\nl6",
  });

  assert.equal(out.ok, false);
  assert.match(out.error, /1-5 non-empty lines/);
});

test("scenarioAdd validates id/domain/priority", () => {
  const root = mkdtempSync(join(tmpdir(), "scenario-add-"));

  const badId = scenarioAdd({
    registryRoot: root,
    id: "Bad_ID",
    domain: "post-merge",
    priority: "high",
    truth: "truth",
    created: "2026-03-16",
  });
  assert.equal(badId.ok, false);
  assert.match(badId.error, /id must be kebab-case/);

  const badDomain = scenarioAdd({
    registryRoot: root,
    id: "good-id",
    domain: "Post Merge",
    priority: "high",
    truth: "truth",
    created: "2026-03-16",
  });
  assert.equal(badDomain.ok, false);
  assert.match(badDomain.error, /domain must be kebab-case/);

  const badPriority = scenarioAdd({
    registryRoot: root,
    id: "good-id",
    domain: "post-merge",
    priority: "urgent",
    truth: "truth",
    created: "2026-03-16",
  });
  assert.equal(badPriority.ok, false);
  assert.match(badPriority.error, /priority must be critical\|high\|medium\|low/);
});
