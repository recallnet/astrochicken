import assert from "node:assert/strict";
import test from "node:test";

import { getSupervisorStatus } from "../../src/commands/supervisor-status.ts";

test("getSupervisorStatus surfaces awaiting hard-plan review counts", () => {
  const out = getSupervisorStatus({
    repo: "recallnet/astrochicken",
    ghJsonFn: (args) => {
      assert.deepEqual(args, [
        "issue",
        "list",
        "--repo",
        "recallnet/astrochicken",
        "--state",
        "open",
        "--label",
        "goal",
        "--limit",
        "200",
        "--json",
        "number,title,labels",
      ]);
      return [
        {
          number: 2200,
          title: "Goal hard A",
          labels: [{ name: "goal" }, { name: "hard" }, { name: "awaiting-human" }],
        },
        {
          number: 2201,
          title: "Goal hard B",
          labels: [{ name: "goal" }, { name: "hard" }, { name: "ready" }],
        },
        {
          number: 2202,
          title: "Goal medium",
          labels: [{ name: "goal" }, { name: "ready" }],
        },
      ];
    },
    listGoalHardStatesFn: ({ repo, goals }) => {
      assert.equal(repo, "recallnet/astrochicken");
      assert.equal(Array.isArray(goals), true);
      return {
        awaiting_post_plan_review_count: 1,
        awaiting_post_plan_review_goal_numbers: [2200],
      };
    },
  });

  assert.equal(out.repo, "recallnet/astrochicken");
  assert.equal(out.open_goal_count, 3);
  assert.deepEqual(out.ready_goal_numbers, [2201, 2202]);
  assert.equal(out.awaiting_hard_plan_review_count, 1);
  assert.deepEqual(out.awaiting_hard_plan_review_goal_numbers, [2200]);
});

test("getSupervisorStatus falls back to zero awaiting-review counts when hard-state lookup fails", () => {
  const out = getSupervisorStatus({
    repo: "recallnet/astrochicken",
    ghJsonFn: () => [
      {
        number: 2200,
        title: "Goal hard A",
        labels: [{ name: "goal" }, { name: "hard" }, { name: "awaiting-human" }],
      },
    ],
    listGoalHardStatesFn: () => {
      throw new Error("simulated failure");
    },
  });

  assert.equal(out.open_goal_count, 1);
  assert.equal(out.awaiting_hard_plan_review_count, 0);
  assert.deepEqual(out.awaiting_hard_plan_review_goal_numbers, []);
});
