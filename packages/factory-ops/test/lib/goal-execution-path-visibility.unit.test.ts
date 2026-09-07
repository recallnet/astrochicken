import assert from "node:assert/strict";
import test from "node:test";

import { resolveGoalExecutionPathMetadata } from "../../src/lib/goal-execution-path-visibility.ts";

test("resolveGoalExecutionPathMetadata marks provisional hard when hard route is decomposition-required and planning-not-required", () => {
  const out = resolveGoalExecutionPathMetadata({
    goal_execution_path: "hard",
    goal_routing_state: {
      decomposition_state: "required",
      planning_state: "not_required",
    },
  });

  assert.equal(out.goal_execution_path, "hard");
  assert.deepEqual(out.goal_routing_state, {
    decomposition_state: "required",
    planning_state: "not_required",
  });
  assert.equal(out.provisional_hard, true);
  assert.equal(out.provisional, true);
});

test("resolveGoalExecutionPathMetadata does not mark provisional hard when planning is required", () => {
  const out = resolveGoalExecutionPathMetadata({
    goal_execution_path: "hard",
    goal_routing_state: {
      decomposition_state: "blocked",
      planning_state: "required",
    },
  });

  assert.equal(out.goal_execution_path, "hard");
  assert.equal(out.provisional_hard, false);
  assert.equal(out.provisional, false);
});

test("resolveGoalExecutionPathMetadata normalizes routing state values and ignores invalid values", () => {
  const out = resolveGoalExecutionPathMetadata({
    execution_path: "medium",
    goal_routing_state: {
      decomposition_state: "REQUIRED",
      planning_state: "queued",
    },
  });

  assert.equal(out.goal_execution_path, "medium");
  assert.deepEqual(out.goal_routing_state, {
    decomposition_state: "required",
    planning_state: "",
  });
  assert.equal(out.provisional_hard, false);
  assert.equal(out.provisional, false);
});

test("resolveGoalExecutionPathMetadata surfaces planning review hold metadata", () => {
  const out = resolveGoalExecutionPathMetadata({
    goal_execution_path: "hard",
    goal_routing_state: {
      decomposition_state: "required",
      planning_state: "pending_review",
      planning_artifact_path: "/tmp/hard-plan.json",
    },
  });

  assert.equal(out.goal_execution_path, "hard");
  assert.equal(out.planning_state, "pending_review");
  assert.equal(out.goal_routing_state.planning_state, "pending_review");
  assert.equal(out.planning_artifact_path, "/tmp/hard-plan.json");
  assert.equal(out.planning_review_required, true);
  assert.equal(out.provisional_hard, false);
});
