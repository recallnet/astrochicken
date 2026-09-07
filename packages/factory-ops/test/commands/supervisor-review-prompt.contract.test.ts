import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const reviewPromptPath = "packages/factory-prompts/prompts/supervisor/review.md";

test("supervisor review prompt instructs closure of duplicate sub-issues blocking goal sweep", () => {
  const prompt = readFileSync(reviewPromptPath, "utf8");

  // Must mention goals skipped by sweep due to open sub-issues
  assert.match(prompt, /goal.*skipped.*sweep|sweep.*skipped.*goal|not_all_work_done/i,
    "prompt should reference goals skipped by sweep with not_all_work_done");

  // Must instruct checking whether open sub-issues overlap with closed siblings
  assert.match(prompt, /open sub.?issue.*closed|duplicate.*sub.?issue|overlap.*closed.*sibling/i,
    "prompt should instruct checking open sub-issues against closed siblings for overlap");

  // Must instruct closing duplicates
  assert.match(prompt, /close.*duplicate|close.*overlap/i,
    "prompt should instruct closing duplicate/overlapping sub-issues");
});
