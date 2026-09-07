import assert from "node:assert/strict";
import test from "node:test";

import { buildArtifactTrace } from "../../src/commands/observability-trace.ts";

test("buildArtifactTrace links goals -> waves -> followups deterministically", () => {
  const out = buildArtifactTrace({
    sourceRepo: "example/external-factory",
    sourceIssue: { number: 10, title: "artifact", state: "CLOSED", url: "u" },
    goals: [{ number: 201, title: "Goal: x", state: "OPEN", url: "g" }],
    milestonesByGoal: {
      201: [{ title: "goal-201-wave-1", state: "open" }],
    },
    followupsByMilestone: {
      "goal-201-wave-1": [{ number: 300, title: "Merge Conveyor Follow-up: dirty_worktree", state: "OPEN", url: "f" }],
    },
  });

  assert.equal(out.source_repo, "example/external-factory");
  assert.equal(out.goals.length, 1);
  assert.equal(out.goals[0].waves[0].milestone, "goal-201-wave-1");
  assert.equal(out.goals[0].waves[0].followups[0].number, 300);
});
