import assert from "node:assert/strict";
import test from "node:test";

import { buildMergeFailurePriorityPlan, renderPrioritiesBody } from "../../src/commands/supervisor-update-priorities-from-merge-failures.ts";

test("buildMergeFailurePriorityPlan orders waves by category pressure", () => {
  const artifactBody = [
    "```json",
    JSON.stringify({ artifact_type: "wave-merge-failures", evidence: JSON.stringify({ followups: [{ category: "dirty_worktree" }, { category: "dirty_worktree" }, { category: "merge_conflict" }] }) }),
    "```",
  ].join("\n");
  const plan = buildMergeFailurePriorityPlan({
    artifacts: [{ body: artifactBody }],
    followups: [
      { number: 1, title: "Merge Conveyor Follow-up: merge_conflict", body: "Wave milestone: goal-2-wave-1", url: "u1" },
      { number: 2, title: "Merge Conveyor Follow-up: dirty_worktree", body: "Wave milestone: goal-1-wave-1", url: "u2" },
    ],
  });
  assert.deepEqual(plan.prioritized_waves, ["goal-1-wave-1", "goal-2-wave-1"]);
  const md = renderPrioritiesBody(plan);
  assert.match(md, /1\. goal-1-wave-1/);
});
