import { spawnOpsCli } from "../helpers/ops-command-cli-fixture.ts";
import assert from "node:assert/strict";


import test from "node:test";


import { fallbackJson, countJsonItems, countFeatureObjects } from "../../src/commands/common-resolve-default.ts";
import { buildFallbackFeatures } from "../../src/commands/goal-build-fallback-features.ts";
import { zipFeaturesToIssues } from "../../src/commands/triage-zip-features.ts";

const goal1416Issue = {
  number: 1416,
  title: "Goal: Ship example factories with batteries, demo docs, and working tests",
  body: "Fallback decomposition continuity must preserve write_issues/triage handoff for example-factory deliverables.",
};

function b64(value) {
  return Buffer.from(String(value || ""), "utf8").toString("base64");
}

function normalizeApprovedPath({ approvedFeaturesRaw = "[]", goalIssueRaw = "{}", goalNumber = "" } = {}) {
  const approvedObjectCount = countFeatureObjects(approvedFeaturesRaw);
  const routed = approvedObjectCount === "0"
    ? buildFallbackFeatures({ goalIssueRaw, goalNumber })
    : approvedFeaturesRaw;
  return fallbackJson(routed, "", { goalNumber });
}

function runOpsCli(args = []) {
  const run = spawnOpsCli([
      ...args
    ]);
  assert.equal(run.status, 0, run.stderr || run.stdout);
  return String(run.stdout || "").trim();
}

test("goal #1416 empty approved decomposition routes to deterministic fallback and stays triage-ready", () => {
  const normalized = normalizeApprovedPath({
    approvedFeaturesRaw: "[]",
    goalIssueRaw: JSON.stringify(goal1416Issue),
    goalNumber: "1416",
  });
  const out = JSON.parse(normalized);

  assert.equal(countJsonItems(normalized), "1");
  assert.equal(out[0].slug, "goal-1416-bootstrap-feature-1");
  assert.equal(
    out[0].acceptance_criteria.includes("Goal processing continues into write_issues/triage without manual intervention, preserving deterministic downstream handoff continuity."),
    true,
  );

  const triageItems = zipFeaturesToIssues({
    featuresRaw: normalized,
    issueIndexRaw: JSON.stringify([{ issue_number: 14160, url: "https://example.test/issues/14160" }]),
  });

  assert.equal(triageItems.length, 1);
  assert.equal(triageItems[0].issue_number, 14160);
  assert.equal(triageItems[0].feature?.slug, "goal-1416-bootstrap-feature-1");
});

test("goal build-fallback-features CLI emits deterministic goal #1416 fallback payload", () => {
  const encoded = b64(JSON.stringify(goal1416Issue));

  const runA = runOpsCli([
    "goal",
    "build-fallback-features",
    "--goal-issue-b64",
    encoded,
    "--goal-number",
    "1416",
  ]);

  const runB = runOpsCli([
    "goal",
    "build-fallback-features",
    "--goal-issue-b64",
    encoded,
    "--goal-number",
    "1416",
  ]);

  assert.equal(runA, runB);

  const out = JSON.parse(runA);
  assert.equal(out.length, 1);
  assert.equal(out[0].slug, "goal-1416-bootstrap-feature-1");
  assert.equal(
    out[0].acceptance_criteria.some((entry) => /docs\/runbooks/i.test(entry)),
    true,
  );
  assert.equal(
    out[0].acceptance_criteria.some((entry) => /write_issues\/triage/i.test(entry)),
    true,
  );
});
