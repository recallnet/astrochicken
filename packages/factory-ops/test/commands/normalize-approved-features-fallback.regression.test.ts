import assert from "node:assert/strict";
import test from "node:test";

import { normalizeApprovedFeatures } from "../../../capability-goal-decomposition/src/in-process-action-owners.mjs";

test("normalizeApprovedFeatures falls back to deterministic goal-derived features when approved features collapse to zero", () => {
  const goalIssueRaw = JSON.stringify({
    number: 1394,
    title: "Goal: Build a research-derived reward MM spec and verification suite",
    body: "Build a spec-first, research-informed verification suite for reward-band market making in Example Trading.",
  });

  const options = {
    approvedFeaturesRaw: "[]",
    goalIssueRaw,
    goalNumber: "1394",
    runId: "run-1394",
    approved: "false",
    decomposeParseStatus: "empty_array",
    pipeline: "goal_intake_decompose",
  };
  const out = normalizeApprovedFeatures(options);

  const parsed = JSON.parse(out);
  assert.equal(Array.isArray(parsed), true);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, "F-1");
  assert.match(parsed[0].slug, /1394/);
  assert.equal(parsed[0].name, "Build a research-derived reward MM spec and verification suite");
  assert.equal(parsed[0].slug, "goal-1394-build-a-research-derived-reward-mm-spec-and-verification-suite");
  assert.equal(parsed[0].scope, "In scope: bootstrap deterministic decomposition continuity. Out of scope: full decomposition refinement.");
  assert.deepEqual(parsed[0].risks, ["Fallback-generated feature may be coarse and require follow-up decomposition refinement."]);
  assert.equal(parsed[0].acceptance_criteria.some((entry) => /write_issues\/triage/.test(entry)), true);
  assert.equal(normalizeApprovedFeatures(options), out);
  assert.match(parsed[0].summary, /1394/);
});
