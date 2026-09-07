import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeGovernanceOverlap } from "../../src/commands/governance-sanitize-overlap.ts";
import { auditBlockedLabels } from "../../src/commands/supervisor-audit-blocked-labels.ts";
import { checkSupervisorHealth, countByMilestone, fp, findDuplicateFeatureTitles, parseFailureCount } from "../../src/commands/supervisor-health-check.ts";
import { normalizeFeatureLabels, hasLabel } from "../../src/commands/supervisor-normalize-feature-labels.ts";
import { sanitizeSupervisorGoals } from "../../src/commands/supervisor-sanitize-goals.ts";
import { getSupervisorStatus } from "../../src/commands/supervisor-status.ts";

test("auditBlockedLabels returns zeros when no repo", () => {
  const out = auditBlockedLabels({});
  assert.equal(out.blocked_count, 0);
  assert.equal(out.without_relationship_count, 0);
});

test("getSupervisorStatus returns empty when no repo", () => {
  const out = getSupervisorStatus({});
  assert.equal(out.repo, "");
  assert.deepEqual(out.open_goals, []);
});

test("sanitizeGovernanceOverlap returns missing_repo when no repo", () => {
  const out = sanitizeGovernanceOverlap({});
  assert.equal(out.summary, "missing_repo");
  assert.equal(out.duplicate_count, 0);
});

// --- supervisor guard clauses ---

test("normalizeFeatureLabels returns missing_repo when no repo", () => {
  const out = normalizeFeatureLabels({});
  assert.equal(out.summary, "missing_repo");
  assert.equal(out.changed, 0);
});

test("checkSupervisorHealth returns missing_repo violation when no repo", () => {
  const out = checkSupervisorHealth({});
  assert.equal(out.ok, false);
  assert.deepEqual(out.violations, [{ type: "missing_repo" }]);
});

test("sanitizeSupervisorGoals returns missing_repo when no repo", () => {
  const out = sanitizeSupervisorGoals({});
  assert.equal(out.summary, "missing_repo");
  assert.equal(out.closed_count, 0);
});

// --- pure function tests from supervisor-health-check ---

test("countByMilestone returns empty for no duplicates", () => {
  const result = countByMilestone([
    { milestone: { title: "goal-1-wave-1" } },
    { milestone: { title: "goal-2-wave-1" } },
  ]);
  assert.deepEqual(result, []);
});

test("countByMilestone detects duplicate milestones", () => {
  const result = countByMilestone([
    { milestone: { title: "goal-1-wave-1" } },
    { milestone: { title: "goal-1-wave-1" } },
    { milestone: { title: "goal-2-wave-1" } },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].milestone, "goal-1-wave-1");
  assert.equal(result[0].count, 2);
});

test("countByMilestone skips issues without milestone", () => {
  const result = countByMilestone([
    { milestone: { title: "" } },
    { milestone: null },
    {},
  ]);
  assert.deepEqual(result, []);
});

test("fp normalizes title to lowercase alphanumeric", () => {
  assert.equal(fp("Hello World!"), "hello world");
  assert.equal(fp("goal-123-wave-1"), "goal 123 wave 1");
  assert.equal(fp(""), "");
  assert.equal(fp("  Special @#$ Chars  "), "special chars");
});

test("findDuplicateFeatureTitles finds duplicates", () => {
  const features = [
    { number: 1, title: "Fix bug" },
    { number: 2, title: "fix bug" },
    { number: 3, title: "Add feature" },
  ];
  const result = findDuplicateFeatureTitles(features);
  assert.equal(result.length, 1);
  assert.equal(result[0].title_fingerprint, "fix bug");
  assert.deepEqual(result[0].issues, [1, 2]);
});

test("findDuplicateFeatureTitles returns empty for unique titles", () => {
  const features = [
    { number: 1, title: "Fix bug A" },
    { number: 2, title: "Fix bug B" },
  ];
  assert.deepEqual(findDuplicateFeatureTitles(features), []);
});

test("findDuplicateFeatureTitles handles empty input", () => {
  assert.deepEqual(findDuplicateFeatureTitles([]), []);
  assert.deepEqual(findDuplicateFeatureTitles(), []);
});

test("parseFailureCount extracts count from body", () => {
  assert.equal(parseFailureCount("WAVE-REVIEW-FAILURE: count=3"), 3);
  assert.equal(parseFailureCount("prefix WAVE-REVIEW-FAILURE: count=12 suffix"), 12);
  assert.equal(parseFailureCount("no match here"), 0);
  assert.equal(parseFailureCount(""), 0);
  assert.equal(parseFailureCount(), 0);
});

// --- pure function from supervisor-normalize-feature-labels ---

test("hasLabel returns true when label exists", () => {
  const issue = { labels: [{ name: "feature" }, { name: "triaged" }] };
  assert.equal(hasLabel(issue, "feature"), true);
  assert.equal(hasLabel(issue, "triaged"), true);
  assert.equal(hasLabel(issue, "blocked"), false);
});

test("hasLabel handles missing labels gracefully", () => {
  assert.equal(hasLabel({}, "feature"), false);
  assert.equal(hasLabel(null, "feature"), false);
  assert.equal(hasLabel({ labels: [] }, "feature"), false);
});
