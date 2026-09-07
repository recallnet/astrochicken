import assert from "node:assert/strict";
import test from "node:test";

import { planGovernanceOverlap } from "../../src/commands/governance-sanitize-overlap.ts";

test("planGovernanceOverlap detects duplicate governance feature issues by normalized title", () => {
  const out = planGovernanceOverlap([
    { number: 215, title: "Enforce action_kind gating for irreversible actions", labels: [{ name: "feature" }] },
    { number: 219, title: "Enforce action kind gating for irreversible actions", labels: [{ name: "feature" }, { name: "triaged" }] },
    { number: 230, title: "Deterministic scheduler", labels: [{ name: "feature" }] },
  ]);

  assert.equal(out.duplicate_count, 1);
  assert.equal(out.close[0].issue_number, "219");
  assert.equal(out.close[0].canonical_issue, "215");
});
