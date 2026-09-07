import assert from "node:assert/strict";
import test from "node:test";

import {
  HARD_GOAL_STATES,
  classifyHardGoalState,
  inspectHardGoalState,
  listGoalHardStates,
} from "../../src/commands/goal-hard-state.ts";

test("classifyHardGoalState resolves needs_planning for hard goal without hard-plan packet", () => {
  const out = classifyHardGoalState({
    goalIssueNumber: "2200",
    goalExecutionPath: "hard",
    goalRoutingState: {
      decomposition_state: "required",
      planning_state: "not_required",
    },
    goalLabels: [{ name: "goal" }, { name: "hard" }],
    hardPlanAttachment: {
      attached: false,
      goal_number: "2200",
    },
  });

  assert.equal(out.hard_goal, true);
  assert.equal(out.hard_goal_state, HARD_GOAL_STATES.NEEDS_PLANNING);
  assert.equal(out.hard_plan_packet_present, false);
  assert.equal(out.ready_label_present, false);
});

test("classifyHardGoalState resolves awaiting_post_plan_review when packet exists and ready missing", () => {
  const out = classifyHardGoalState({
    goalIssueNumber: "2201",
    goalExecutionPath: "hard",
    goalLabels: [{ name: "goal" }, { name: "hard" }, { name: "awaiting-human" }],
    hardPlanAttachment: {
      attached: true,
      goal_number: "2201",
      packet_id: "plan-2201",
      packet_path: ".hatch/mothership/packets/goal_hard_plan_packet/plan-2201.json",
      artifact_refs: [{ path: "artifacts/plan.md" }],
      comment_marker: "<!-- goal-hard-plan:v1 goal=2201 packet=plan-2201 -->",
      goal_issue_comment_id: "111",
      goal_issue_comment_url: "https://example.test/2201#comment-111",
    },
  });

  assert.equal(out.hard_goal, true);
  assert.equal(out.hard_goal_state, HARD_GOAL_STATES.AWAITING_POST_PLAN_REVIEW);
  assert.equal(out.awaiting_human_label_present, true);
  assert.equal(out.ready_label_present, false);
  assert.equal(out.hard_plan_packet_present, true);
  assert.equal(out.hard_plan_packet_id, "plan-2201");
  assert.equal(out.hard_plan_artifact_count, 1);
});

test("classifyHardGoalState resolves approved_plan_resume when packet exists and ready restored", () => {
  const out = classifyHardGoalState({
    goalIssueNumber: "2202",
    goalExecutionPath: "hard",
    goalLabels: [{ name: "goal" }, { name: "hard" }, { name: "ready" }],
    hardPlanAttachment: {
      attached: true,
      goal_number: "2202",
      packet_id: "plan-2202",
      packet_path: ".hatch/mothership/packets/goal_hard_plan_packet/plan-2202.json",
      artifact_refs: [{ path: "artifacts/plan.md" }, { url: "https://example.test/plan" }],
    },
  });

  assert.equal(out.hard_goal, true);
  assert.equal(out.hard_goal_state, HARD_GOAL_STATES.APPROVED_PLAN_RESUME);
  assert.equal(out.ready_label_present, true);
  assert.equal(out.awaiting_human_label_present, false);
  assert.equal(out.hard_plan_artifact_count, 2);
});

test("inspectHardGoalState stays local when labels are not provided", () => {
  const out = inspectHardGoalState({
    repoRoot: ".",
    goalIssueNumber: "2203",
    goalExecutionPath: "hard",
    factoryId: "mothership",
    inspectAttachmentFn: () => ({
      attached: true,
      goal_number: "2203",
      packet_id: "plan-2203",
      packet_path: ".hatch/mothership/packets/goal_hard_plan_packet/plan-2203.json",
      artifact_refs: [{ path: "artifacts/plan.md" }],
    }),
  });

  assert.equal(out.hard_goal_state, HARD_GOAL_STATES.AWAITING_POST_PLAN_REVIEW);
  assert.equal(out.hard_plan_packet_id, "plan-2203");
  assert.equal(out.ready_label_present, false);
});

test("listGoalHardStates summarizes hard-goal state counts", () => {
  const out = listGoalHardStates({
    repo: "recallnet/astrochicken",
    repoRoot: ".",
    factoryId: "mothership",
    goals: [
      {
        number: 2200,
        title: "Goal A",
        labels: [{ name: "goal" }, { name: "hard" }],
      },
      {
        number: 2201,
        title: "Goal B",
        labels: [{ name: "goal" }, { name: "hard" }, { name: "awaiting-human" }],
      },
      {
        number: 2202,
        title: "Goal C",
        labels: [{ name: "goal" }, { name: "hard" }, { name: "ready" }],
      },
      {
        number: 2204,
        title: "Goal D",
        labels: [{ name: "goal" }, { name: "ready" }],
      },
    ],
    inspectAttachmentFn: ({ goalNumber }) => {
      if (goalNumber === "2201") {
        return {
          attached: true,
          goal_number: "2201",
          packet_id: "plan-2201",
          packet_path: ".hatch/mothership/packets/goal_hard_plan_packet/plan-2201.json",
          artifact_refs: [{ path: "artifacts/plan.md" }],
          goal_issue_comment_url: "https://example.test/2201#comment",
        };
      }
      if (goalNumber === "2202") {
        return {
          attached: true,
          goal_number: "2202",
          packet_id: "plan-2202",
          packet_path: ".hatch/mothership/packets/goal_hard_plan_packet/plan-2202.json",
          artifact_refs: [{ path: "artifacts/plan.md" }],
          goal_issue_comment_url: "https://example.test/2202#comment",
        };
      }
      return {
        attached: false,
        goal_number: goalNumber,
      };
    },
  });

  assert.equal(out.goal_count, 4);
  assert.equal(out.hard_goal_count, 3);
  assert.equal(out.needs_planning_count, 1);
  assert.equal(out.awaiting_post_plan_review_count, 1);
  assert.equal(out.approved_plan_resume_count, 1);
  assert.deepEqual(out.awaiting_post_plan_review_goal_numbers, [2201]);
  assert.deepEqual(out.approved_plan_resume_goal_numbers, [2202]);
});

test("listGoalHardStates reads goal inventory through the GitHub adapter boundary", () => {
  const calls = [];
  const out = listGoalHardStates({
    repo: "recallnet/astrochicken",
    repoRoot: ".",
    factoryId: "mothership",
    githubAdapter: {
      issueList(args = {}) {
        calls.push(args);
        return [{
          number: 2205,
          title: "Goal E",
          labels: [{ name: "goal" }, { name: "hard" }],
        }];
      },
    },
    inspectAttachmentFn: () => ({
      attached: false,
      goal_number: "2205",
    }),
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    state: "open",
    labels: ["goal"],
    limit: 200,
    fields: "number,title,labels",
  });
  assert.equal(out.goal_count, 1);
  assert.equal(out.hard_goal_count, 1);
});
