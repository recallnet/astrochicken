import assert from "node:assert/strict";
import test from "node:test";

import { fallbackJson, countJsonItems, countFeatureObjects } from "../../src/commands/common-resolve-default.ts";
import { buildFallbackFeatures } from "../../src/commands/goal-build-fallback-features.ts";
import { zipFeaturesToIssues } from "../../src/commands/triage-zip-features.ts";

const goal322Issue = {
  number: 322,
  title: "Goal: Bootstrap deterministic decomposition continuity",
  body: "Goal #322 produced malformed or empty decomposition output and must keep downstream processing unblocked.",
};

function normalizeApprovedPath({ approvedFeaturesRaw = "[]", goalIssueRaw = "{}", goalNumber = "" } = {}) {
  const approvedObjectCount = countFeatureObjects(approvedFeaturesRaw);
  const routed = approvedObjectCount === "0"
    ? buildFallbackFeatures({ goalIssueRaw, goalNumber })
    : approvedFeaturesRaw;
  return fallbackJson(routed, "", { goalNumber });
}

test("goal #322 malformed decomposition routes to deterministic bootstrap scaffold and remains triage-ready", () => {
  const normalized = normalizeApprovedPath({
    approvedFeaturesRaw: "{broken",
    goalIssueRaw: JSON.stringify(goal322Issue),
    goalNumber: "322",
  });
  const out = JSON.parse(normalized);

  assert.equal(countJsonItems(normalized), "1");
  assert.equal(out[0].id, "F-1");
  assert.equal(out[0].name, "Bootstrap decomposition feature 1 (goal #322)");
  assert.equal(out[0].slug, "goal-322-bootstrap-feature-1");
  assert.equal(out[0].domain, "goal-decomposition");
  assert.equal(
    out[0].acceptance_criteria.includes("Goal processing continues into downstream issue-writing and triage stages without manual intervention."),
    true,
  );
  assert.equal(
    out[0].acceptance_criteria.includes("Goal processing continues into write_issues/triage without manual intervention."),
    true,
  );

  const triageItems = zipFeaturesToIssues({
    featuresRaw: normalized,
    issueIndexRaw: JSON.stringify([{ issue_number: 702, url: "https://example.test/issues/702" }]),
  });
  assert.equal(triageItems.length, 1);
  assert.equal(triageItems[0].issue_number, 702);
  assert.equal(triageItems[0].feature?.slug, "goal-322-bootstrap-feature-1");
});

test("goal #322 malformed and empty decomposition remain deterministic through triage handoff", () => {
  const malformed = normalizeApprovedPath({
    approvedFeaturesRaw: "{broken",
    goalIssueRaw: JSON.stringify(goal322Issue),
    goalNumber: "322",
  });
  const empty = normalizeApprovedPath({
    approvedFeaturesRaw: "[]",
    goalIssueRaw: JSON.stringify(goal322Issue),
    goalNumber: "322",
  });

  assert.equal(malformed, empty);
  assert.equal(countJsonItems(malformed), "1");

  const malformedTriageItems = zipFeaturesToIssues({
    featuresRaw: malformed,
    issueIndexRaw: JSON.stringify([{ issue_number: 703, url: "https://example.test/issues/703" }]),
  });
  const emptyTriageItems = zipFeaturesToIssues({
    featuresRaw: empty,
    issueIndexRaw: JSON.stringify([{ issue_number: 703, url: "https://example.test/issues/703" }]),
  });

  assert.deepEqual(malformedTriageItems, emptyTriageItems);
  assert.equal(malformedTriageItems.length, 1);
  assert.equal(malformedTriageItems[0].issue_number, 703);
  assert.equal(malformedTriageItems[0].feature?.slug, "goal-322-bootstrap-feature-1");
});
