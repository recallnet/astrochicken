import assert from "node:assert/strict";
import test from "node:test";

import {
  appendRationaleFeature,
  deriveRationaleRequirement,
  normalizeRationaleDocStructure,
} from "../../src/lib/goal-rationale-doc.ts";

test("deriveRationaleRequirement keeps execution difficulty separate from understanding risk", () => {
  const derived = deriveRationaleRequirement({
    executionPath: "easy",
    classificationSignals: {
      understanding_risk: "high",
      rationale_required: true,
    },
  });

  assert.equal(derived.understanding_risk, "high");
  assert.equal(derived.rationale_required, true);
});

test("appendRationaleFeature adds one final rationale feature when required", () => {
  const out = appendRationaleFeature({
    approvedFeaturesRaw: JSON.stringify([
      { feature_id: "F-1", title: "Ship behavior", summary: "Implement the actual behavior" },
    ]),
    goalIssueRaw: JSON.stringify({ number: 2401, title: "Goal 2401" }),
    executionPath: "easy",
    understandingRisk: "high",
    rationaleRequired: "true",
  });

  const features = JSON.parse(out.approved_features);
  assert.equal(out.rationale_feature_added, "true");
  assert.equal(out.understanding_risk, "high");
  assert.equal(out.rationale_required, "true");
  assert.equal(features.length, 2);
  assert.equal(features.at(-1).work_item_kind, "rationale_doc");
  assert.match(features.at(-1).rationale_doc.path_pattern, /^docs\/rationale\/YYYY-MM-DD-/);
});

test("normalizeRationaleDocStructure finds missing headings and filler phrases", () => {
  const structure = normalizeRationaleDocStructure(`## What Changed\nTBD\n\n## Why Now\nmisc`);
  assert.ok(structure.missing_headings.includes("Subsystem Map"));
  assert.ok(structure.banned_phrases.includes("tbd"));
  assert.equal(structure.has_concrete_ref, false);
});
