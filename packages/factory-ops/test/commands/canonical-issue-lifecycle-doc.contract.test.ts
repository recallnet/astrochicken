import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const docPath = "docs/architecture/canonical-issue-lifecycle.md";

test("canonical issue lifecycle architecture doc exists with governed frontmatter", () => {
  assert.ok(existsSync(docPath), `${docPath} must exist`);
  const doc = readFileSync(docPath, "utf8");

  assert.match(doc, /^---\n[\s\S]*doc_type: "architecture"/);
  assert.match(doc, /\nowner: "/);
  assert.match(doc, /\nreview_policy: "/);
  assert.match(doc, /\nreviewed: "/);
  assert.match(doc, /\nstatus: "active"/);
  assert.match(doc, /\nsummary: "/);
  assert.match(doc, /\nwritten: "/);
});

test("canonical issue lifecycle architecture doc names the GitHub-dependent lifecycle surfaces to replace", () => {
  const doc = readFileSync(docPath, "utf8");

  assert.match(doc, /reconcileGoalFinalState/);
  assert.match(doc, /projectGoalFinalState/);
  assert.match(doc, /sweepCompletedGoals/);
  assert.match(doc, /closeMergedIssues/);
  assert.match(doc, /allSubIssueExecutionsCompleted/);
  assert.match(doc, /Closes #/);
});

test("canonical issue lifecycle architecture doc defines canonical lifecycle states and GitHub as projection", () => {
  const doc = readFileSync(docPath, "utf8");

  assert.match(doc, /decomposed/);
  assert.match(doc, /built/);
  assert.match(doc, /reviewed/);
  assert.match(doc, /merge_attempted/);
  assert.match(doc, /merged/);
  assert.match(doc, /pushed/);
  assert.match(doc, /closed_on_gh/);
  assert.match(doc, /GitHub is a projection/i);
  assert.match(doc, /Postgres.*source of truth/i);
});

test("canonical issue lifecycle architecture doc specifies the migration path and elimination target", () => {
  const doc = readFileSync(docPath, "utf8");

  assert.match(doc, /Migration Path/);
  assert.match(doc, /projection receipts/i);
  assert.match(doc, /goal-final-state-review\.mjs/);
  assert.match(doc, /goal-final-state-projection\.mjs/);
  assert.match(doc, /goal-sweep-completed\.mjs/);
  assert.match(doc, /wave-close-merged\.mjs/);
  assert.match(doc, /eliminat(?:e|es|ed).*allSubIssueExecutionsCompleted/i);
});
