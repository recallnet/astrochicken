import assert from "node:assert/strict";
import test from "node:test";

import { countFeatureObjects, countJsonItems, fallbackJson, inspectJson } from "../../src/commands/common-resolve-default.ts";
import { buildFallbackFeatures } from "../../src/commands/goal-build-fallback-features.ts";
import { zipFeaturesToIssues } from "../../src/commands/triage-zip-features.ts";

const goal547Issue = {
  number: 547,
  title: "Goal: Bootstrap deterministic decomposition fallback for Trust Tuple Identity",
  body: "Need deterministic fallback for intent release × model × agent type/version tuple continuity when decomposition output is malformed or empty.",
};

function normalizeApprovedPath({ approvedFeaturesRaw = "[]", goalIssueRaw = "{}", goalNumber = "" } = {}) {
  const approvedObjectCount = countFeatureObjects(approvedFeaturesRaw);
  const routed = approvedObjectCount === "0"
    ? buildFallbackFeatures({ goalIssueRaw, goalNumber })
    : approvedFeaturesRaw;
  return fallbackJson(routed, "", { goalNumber });
}

test("trust tuple goal #547 parser diagnostics remain deterministic for malformed/empty decomposition", () => {
  const malformed = JSON.parse(inspectJson("{broken"));
  const empty = JSON.parse(inspectJson("[]"));

  assert.equal(malformed.decompose_parse_status, "invalid_json");
  assert.equal(empty.decompose_parse_status, "empty_array");
  assert.equal(empty.decompose_parse_error, "decomposition array is empty");
});

test("trust tuple goal #547 fallback emits one deterministic feature for malformed/empty approved payloads", () => {
  const malformed = normalizeApprovedPath({
    approvedFeaturesRaw: '{"id":"oops"}',
    goalIssueRaw: JSON.stringify(goal547Issue),
    goalNumber: "547",
  });
  const empty = normalizeApprovedPath({
    approvedFeaturesRaw: "[]",
    goalIssueRaw: JSON.stringify(goal547Issue),
    goalNumber: "547",
  });

  assert.equal(malformed, empty);
  assert.equal(countJsonItems(malformed), "1");

  const out = JSON.parse(malformed);
  assert.equal(out[0].slug, "trust-tuple-identity-fallback-bootstrap");
  assert.equal(out[0].domain, "trust-tuple-identity");
  assert.equal(
    out[0].acceptance_criteria.some((entry) => /write_issues\/triage/i.test(entry)),
    true,
  );
});

test("trust tuple goal #547 fallback stays triage-ready without manual repair", () => {
  const normalized = normalizeApprovedPath({
    approvedFeaturesRaw: "[]",
    goalIssueRaw: "{broken",
    goalNumber: "547",
  });

  const triageItems = zipFeaturesToIssues({
    featuresRaw: normalized,
    issueIndexRaw: JSON.stringify([{ issue_number: 5471, url: "https://example.test/issues/5471" }]),
  });

  assert.equal(triageItems.length, 1);
  assert.equal(triageItems[0].issue_number, 5471);
  assert.equal(triageItems[0].feature?.slug, "trust-tuple-identity-fallback-bootstrap");
});
