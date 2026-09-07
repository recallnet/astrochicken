import assert from "node:assert/strict";
import test from "node:test";

import { normalizeApprovedFeatures } from "../../../capability-goal-decomposition/src/in-process-action-owners.mjs";

test("normalizeApprovedFeatures falls back to deterministic bootstrap features when approved features collapse to zero", () => {
  const goalIssueRaw = JSON.stringify({
    number: 1394,
    title: "Goal: Build a research-derived reward MM spec and verification suite",
    body: "Build a spec-first, research-informed verification suite for reward-band market making in Example Trading.",
  });

  const out = normalizeApprovedFeatures({
    approvedFeaturesRaw: "[]",
    goalIssueRaw,
    goalNumber: "1394",
    runId: "run-1394",
    approved: "false",
    decomposeParseStatus: "empty_array",
    pipeline: "goal_intake_decompose",
  });

  const parsed = JSON.parse(out);
  assert.equal(Array.isArray(parsed), true);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, "F-1");
  assert.match(parsed[0].slug, /1394/);
  assert.match(parsed[0].slug, /bootstrap/);
  assert.match(parsed[0].summary, /1394/);
});
