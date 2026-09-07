import assert from "node:assert/strict";
import test from "node:test";

import { repairCanonicalGoalCloseProjection } from "../../src/lib/goal-close-projection-repair.ts";

test("repairCanonicalGoalCloseProjection is a no-op when GitHub already shows the goal closed", () => {
  const recorded = [];
  const result = repairCanonicalGoalCloseProjection({
    goalNumber: "1789",
    readGoalIssueFn: () => ({ number: 1789, state: "CLOSED" }),
    projectionTarget: {
      issueClose(args) {
        recorded.push(args);
        return { ok: true };
      },
    },
  });

  assert.equal(result.closedGoal, true);
  assert.equal(result.skippedGoalClosureReason, "");
  assert.deepEqual(recorded, []);
});

test("repairCanonicalGoalCloseProjection closes GitHub when canonical state says the goal is already closed", () => {
  const recorded = [];
  const result = repairCanonicalGoalCloseProjection({
    goalNumber: "1789",
    readGoalIssueFn: () => ({ number: 1789, state: "OPEN" }),
    projectionTarget: {
      issueClose(args) {
        recorded.push(args);
        return { ok: true };
      },
    },
  });

  assert.equal(result.closedGoal, true);
  assert.equal(result.skippedGoalClosureReason, "");
  assert.deepEqual(recorded, [{ number: "1789", reason: "completed" }]);
});

test("repairCanonicalGoalCloseProjection fails closed when GitHub projection repair cannot close the goal", () => {
  const result = repairCanonicalGoalCloseProjection({
    goalNumber: "1789",
    readGoalIssueFn: () => ({ number: 1789, state: "OPEN" }),
    projectionTarget: {
      issueClose() {
        return { ok: false };
      },
    },
  });

  assert.equal(result.closedGoal, false);
  assert.equal(result.skippedGoalClosureReason, "goal_close_projection_repair_failed");
});
