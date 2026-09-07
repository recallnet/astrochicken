import assert from "node:assert/strict";
import test from "node:test";

import { resolveBugSignature } from "../../src/commands/supervisor-artifact.ts";

test("resolveBugSignature is stable for recurring factory_design_defect fallback bugs", () => {
  const a = resolveBugSignature({
    bugType: "factory_design_defect",
    summary: "normalize_features drops approved valid decompose output to zero issues (recurrent, 54x in 24h)",
    evidence: {
      recurrence_key: "goal_intake_decompose::normalize_features::feature_count_zero_after_normalize",
      recurrence_total: 54,
      goal_issue: 1613,
    },
  });
  const b = resolveBugSignature({
    bugType: "factory_design_defect",
    summary: "normalize_features drops approved valid decompose output to zero issues (recurrent, 63x in 24h)",
    evidence: {
      recurrence_key: "goal_intake_decompose::normalize_features::feature_count_zero_after_normalize",
      recurrence_total: 63,
      goal_issue: 1701,
    },
  });

  assert.equal(a, b);
});

test("resolveBugSignature still distinguishes different recurring factory_design_defect classes", () => {
  const normalizeFeatures = resolveBugSignature({
    bugType: "factory_design_defect",
    summary: "normalize_features issue",
    evidence: {
      recurrence_key: "goal_intake_decompose::normalize_features::feature_count_zero_after_normalize",
    },
  });
  const retryExhausted = resolveBugSignature({
    bugType: "factory_design_defect",
    summary: "decompose retry exhausted",
    evidence: {
      recurrence_key: "goal_intake_decompose::fallback::decompose_retry_exhausted",
    },
  });

  assert.notEqual(normalizeFeatures, retryExhausted);
});
