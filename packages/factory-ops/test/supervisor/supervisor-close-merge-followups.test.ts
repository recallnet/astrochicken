import assert from "node:assert/strict";
import test from "node:test";

import { planMergeFollowupClosures } from "../../src/commands/supervisor-close-merge-followups.ts";

test("planMergeFollowupClosures closes stale categories with no active artifacts", () => {
  const now = 1_700_000_000;
  const out = planMergeFollowupClosures({
    nowEpoch: now,
    staleHours: 24,
    followups: [
      { number: 1, title: "Merge Conveyor Follow-up: dirty_worktree", updatedAt: new Date((now - 200000) * 1000).toISOString() },
      { number: 2, title: "Merge Conveyor Follow-up: merge_conflict", updatedAt: new Date((now - 200000) * 1000).toISOString() },
    ],
    artifacts: [
      { body: "\"category\": \"merge_conflict\"" },
    ],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].number, 1);
  assert.equal(out[0].category, "dirty_worktree");
});
