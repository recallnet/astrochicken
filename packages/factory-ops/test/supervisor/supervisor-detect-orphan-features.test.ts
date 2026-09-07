import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  classifyFeatureOwnership,
  extractParentGoalRefs,
  identifyFeaturesUnderClosedGoals,
  identifyOrphanFeatures,
  inferParentGoal,
  findBestMilestoneForGoal,
} from "../../src/commands/supervisor-detect-orphan-features.ts";

test("extractParentGoalRefs finds explicit closed-goal references in feature bodies", () => {
  const refs = extractParentGoalRefs("## Parent Goal\nCloses as part of #2199\nAlso mentioned: part of #3001");
  assert.deepEqual(refs, [2199, 3001]);
});

test("identifyOrphanFeatures filters features without ownership evidence", () => {
  const features = [
    { number: 1, title: "F-1", body: "Closes as part of #101", milestone: null, url: "u1" },
    { number: 2, title: "F-2", body: "", milestone: null, url: "u2" },
    { number: 3, title: "F-3", body: "Parent Goal: #102", milestone: { title: "" }, url: "u3" },
  ];
  const issueMetadataByNumber = new Map([
    [101, { number: 101, state: "OPEN", labels: [{ name: "goal" }] }],
    [102, { number: 102, state: "CLOSED", labels: [{ name: "goal" }] }],
  ]);
  const out = identifyOrphanFeatures(features, { issueMetadataByNumber });
  assert.equal(out.length, 1);
  assert.equal(out[0].number, 2);
});

test("identifyOrphanFeatures returns empty when all have parent ownership evidence", () => {
  const features = [
    { number: 1, title: "F-1", body: "Closes as part of #101", milestone: null, url: "u1" },
  ];
  const issueMetadataByNumber = new Map([
    [101, { number: 101, state: "CLOSED", labels: [{ name: "goal" }] }],
  ]);
  assert.deepEqual(identifyOrphanFeatures(features, { issueMetadataByNumber }), []);
});

test("identifyOrphanFeatures excludes features that are sub-issues of a goal", () => {
  const features = [
    { number: 10, title: "Sub A", body: "", milestone: null, url: "u10" },
    { number: 20, title: "Sub B", body: "", milestone: null, url: "u20" },
    { number: 30, title: "Orphan", body: "", milestone: null, url: "u30" },
  ];
  const goalSubIssueNumbers = new Set([10, 20]);
  const out = identifyOrphanFeatures(features, { goalSubIssueNumbers });
  assert.equal(out.length, 1);
  assert.equal(out[0].number, 30);
});

test("classifyFeatureOwnership treats open feature under closed goal as owned, not orphaned", () => {
  const ownership = classifyFeatureOwnership(
    { number: 2331, title: "Regression gates", body: "Closes as part of #2199" },
    {
      issueMetadataByNumber: new Map([
        [2199, { number: 2199, state: "CLOSED", labels: [{ name: "goal" }] }],
      ]),
    },
  );
  assert.equal(ownership.orphaned, false);
  assert.equal(ownership.classification, "owned_by_closed_goal");
  assert.deepEqual(ownership.closed_goal_numbers, [2199]);
});

test("identifyFeaturesUnderClosedGoals returns features still owned by a closed goal", () => {
  const features = [
    { number: 2331, title: "Regression gates", body: "Closes as part of #2199", milestone: null, url: "u2331" },
    { number: 2332, title: "True orphan", body: "", milestone: null, url: "u2332" },
  ];
  const out = identifyFeaturesUnderClosedGoals(features, {
    issueMetadataByNumber: new Map([
      [2199, { number: 2199, state: "CLOSED", labels: [{ name: "goal" }] }],
    ]),
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].number, 2331);
  assert.deepEqual(out[0].closed_goal_numbers, [2199]);
});

test("inferParentGoal matches by body reference", () => {
  const goals = [
    { number: 100, title: "Goal A", body: "Features: #5, #6" },
    { number: 200, title: "Goal B", body: "Nothing here" },
  ];
  const out = inferParentGoal(5, [], goals);
  assert.equal(out.goal_number, 100);
  assert.equal(out.confidence, "high");
});

test("inferParentGoal returns unknown when no match", () => {
  const out = inferParentGoal(99, [], []);
  assert.equal(out.goal_number, 0);
  assert.equal(out.confidence, "low");
});

test("inferParentGoal matches by title prefix (e.g. '205-2: ...')", () => {
  const goals = [
    { number: 205, title: "Goal: Distributed Factory Leases", body: "Harden distributed execution" },
  ];
  const out = inferParentGoal(385, [], goals, "205-2: Atomic wave marker claim + stale in-flight cleanup");
  assert.equal(out.goal_number, 205);
  assert.equal(out.confidence, "high");
});

test("inferParentGoal matches by [Feature N-N] prefix", () => {
  const goals = [
    { number: 205, title: "Goal: Distributed Factory Leases", body: "Harden distributed execution" },
  ];
  const out = inferParentGoal(386, [], goals, "[Feature 205-3] Global/per-factory call budget");
  assert.equal(out.goal_number, 205);
  assert.equal(out.confidence, "high");
});

// Gate: fixOrphanFeatures must auto-remediate and file bugs for unresolvable
test("fixOrphanFeatures must auto-assign milestones and file bugs for unresolvable", () => {
  const src = readFileSync("packages/factory-ops/src/commands/supervisor-detect-orphan-features.ts", "utf8");
  assert.ok(src.includes("export function fixOrphanFeatures"), "fixOrphanFeatures must be exported");
  assert.ok(src.includes("--milestone"), "fixOrphanFeatures must assign milestones via gh issue edit --milestone");
  assert.ok(src.includes("emitBugIssue"), "fixOrphanFeatures must file bugs for unresolvable orphans");
});

test("identifyOrphanFeatures excludes daily-lens-candidate issues", () => {
  const features = [
    { number: 50, title: "Lens suggestion: improve prompt", body: "", milestone: null, url: "u50", labels: [{ name: "feature" }, { name: "daily-lens-candidate" }] },
    { number: 51, title: "Real orphan feature", body: "", milestone: null, url: "u51", labels: [{ name: "feature" }] },
    { number: 52, title: "Another lens candidate", body: "", milestone: null, url: "u52", labels: [{ name: "daily-lens-candidate" }, { name: "feature" }] },
  ];
  const out = identifyOrphanFeatures(features);
  assert.equal(out.length, 1);
  assert.equal(out[0].number, 51);
});

test("identifyOrphanFeatures excludes daily-lens report issues", () => {
  const features = [
    { number: 70, title: "Daily Lens Report — 2026-03-15", body: "", milestone: null, url: "u70", labels: [{ name: "daily-lens" }] },
    { number: 71, title: "Real orphan feature", body: "", milestone: null, url: "u71", labels: [{ name: "feature" }] },
    { number: 72, title: "Daily Lens Report — 2026-03-14", body: "", milestone: null, url: "u72", labels: [{ name: "daily-lens" }, { name: "goal" }] },
  ];
  const out = identifyOrphanFeatures(features);
  assert.equal(out.length, 1);
  assert.equal(out[0].number, 71);
});

test("identifyOrphanFeatures treats missing labels as empty (no crash)", () => {
  const features = [
    { number: 60, title: "No labels field", body: "", milestone: null, url: "u60" },
    { number: 61, title: "Null labels", body: "", milestone: null, url: "u61", labels: null },
  ];
  const out = identifyOrphanFeatures(features);
  assert.equal(out.length, 2);
});

test("findBestMilestoneForGoal picks latest open wave milestone", () => {
  const milestones = [
    { title: "goal-5-wave-1", number: 10 },
    { title: "goal-5-wave-3", number: 12 },
    { title: "goal-5-wave-2", number: 11 },
    { title: "goal-99-wave-1", number: 20 },
  ];
  const best = findBestMilestoneForGoal(5, milestones);
  assert.equal(best.title, "goal-5-wave-3");
  assert.equal(best.number, 12);
});

test("findBestMilestoneForGoal returns null when no matching milestones", () => {
  const milestones = [
    { title: "goal-99-wave-1", number: 20 },
  ];
  assert.equal(findBestMilestoneForGoal(5, milestones), null);
});

test("findBestMilestoneForGoal handles empty input", () => {
  assert.equal(findBestMilestoneForGoal(5, []), null);
  assert.equal(findBestMilestoneForGoal(5, null), null);
});

// --- Grace period: features created recently should not be flagged as orphans ---

test("classifyFeatureOwnership returns too_recent for feature created within grace period", () => {
  const now = Date.now();
  const tenMinutesAgo = new Date(now - 10 * 60 * 1000).toISOString();
  const ownership = classifyFeatureOwnership(
    { number: 500, title: "Brand new feature", body: "", created_at: tenMinutesAgo },
    { nowMs: now },
  );
  assert.equal(ownership.orphaned, false);
  assert.equal(ownership.classification, "too_recent");
});

test("classifyFeatureOwnership treats feature older than grace period as orphan (missing parent)", () => {
  const now = Date.now();
  const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
  const ownership = classifyFeatureOwnership(
    { number: 501, title: "Old feature", body: "", created_at: twoHoursAgo },
    { nowMs: now },
  );
  assert.equal(ownership.orphaned, true);
  assert.equal(ownership.classification, "missing_parent_evidence");
});

test("classifyFeatureOwnership defaults to no grace period when nowMs not provided (backward compat)", () => {
  // Without nowMs, features with no parent evidence are still orphaned regardless of created_at
  const ownership = classifyFeatureOwnership(
    { number: 502, title: "Feature", body: "" },
    {},
  );
  assert.equal(ownership.orphaned, true);
  assert.equal(ownership.classification, "missing_parent_evidence");
});

test("identifyOrphanFeatures respects grace period when nowMs provided", () => {
  const now = Date.now();
  const fiveMinutesAgo = new Date(now - 5 * 60 * 1000).toISOString();
  const threeHoursAgo = new Date(now - 3 * 60 * 60 * 1000).toISOString();
  const features = [
    { number: 600, title: "Recent", body: "", created_at: fiveMinutesAgo, url: "u600" },
    { number: 601, title: "Old orphan", body: "", created_at: threeHoursAgo, url: "u601" },
    { number: 602, title: "Has parent", body: "Part of #100", created_at: threeHoursAgo, url: "u602" },
  ];
  const issueMetadataByNumber = new Map([
    [100, { number: 100, state: "OPEN", labels: [{ name: "goal" }] }],
  ]);
  const out = identifyOrphanFeatures(features, { issueMetadataByNumber, nowMs: now });
  assert.equal(out.length, 1);
  assert.equal(out[0].number, 601);
});

test("grace period uses created_at from GitHub issue (ISO string format)", () => {
  const now = Date.now();
  // 30 minutes ago — within the 60-minute grace period
  const thirtyMinAgo = new Date(now - 30 * 60 * 1000).toISOString();
  const ownership = classifyFeatureOwnership(
    { number: 503, title: "Half-hour old", body: "", created_at: thirtyMinAgo },
    { nowMs: now },
  );
  assert.equal(ownership.orphaned, false);
  assert.equal(ownership.classification, "too_recent");
});

test("grace period works with camelCase createdAt (gh CLI format)", () => {
  const now = Date.now();
  const tenMinutesAgo = new Date(now - 10 * 60 * 1000).toISOString();
  const ownership = classifyFeatureOwnership(
    { number: 505, title: "GH feature", body: "", createdAt: tenMinutesAgo },
    { nowMs: now },
  );
  assert.equal(ownership.orphaned, false);
  assert.equal(ownership.classification, "too_recent");
});

test("grace period boundary: feature exactly at threshold is not too_recent", () => {
  const now = Date.now();
  // Exactly 60 minutes ago — at the boundary, should NOT be grace-perioded
  const exactlyAtThreshold = new Date(now - 60 * 60 * 1000).toISOString();
  const ownership = classifyFeatureOwnership(
    { number: 504, title: "Boundary feature", body: "", created_at: exactlyAtThreshold },
    { nowMs: now },
  );
  assert.equal(ownership.orphaned, true);
  assert.equal(ownership.classification, "missing_parent_evidence");
});
