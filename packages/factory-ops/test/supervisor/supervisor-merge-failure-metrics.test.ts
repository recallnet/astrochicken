import assert from "node:assert/strict";
import test from "node:test";

import { aggregateMergeFailureMetrics } from "../../src/commands/supervisor-merge-failure-metrics.ts";

test("aggregateMergeFailureMetrics counts categories from wave-merge-failures artifacts", () => {
  const body = [
    "Machine-generated supervisor artifact.",
    "```json",
    JSON.stringify({ artifact_type: "wave-merge-failures", evidence: JSON.stringify({ followups: [{ category: "dirty_worktree" }, { category: "dirty_worktree" }, { category: "merge_conflict" }] }) }),
    "```",
  ].join("\n");
  const out = aggregateMergeFailureMetrics([{ body }]);
  assert.equal(out.total_count, 3);
  assert.deepEqual(out.categories, [
    { category: "dirty_worktree", count: 2 },
    { category: "merge_conflict", count: 1 },
  ]);
});
