import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCeremonyTelemetry,
  shouldSkipGoalReview,
  decomposeAutoApproveDecision,
  shouldSkipIssueJudge,
  classifyMilestoneIssueComplexity,
  buildMilestoneParallelBatch,
} from "../../src/commands/ceremony-heuristics.ts";

test("buildCeremonyTelemetry emits deterministic hatch.ceremony dimensions", () => {
  const out = buildCeremonyTelemetry({
    pipeline: "goal_batch",
    skipped: true,
    skipReason: "goal_batch.single_goal",
    reason: "goal_batch.single_goal",
  });

  assert.equal(out["hatch.ceremony.pipeline"], "goal_batch");
  assert.equal(out["hatch.ceremony.skipped"], "true");
  assert.equal(out["hatch.ceremony.skip_reason"], "goal_batch.single_goal");
});

test("shouldSkipGoalReview skips only single-goal ticks when toggle enabled", () => {
  const skipped = shouldSkipGoalReview({ goalCount: 1, skipReviewSingleGoal: "true" });
  const notSkipped = shouldSkipGoalReview({ goalCount: 2, skipReviewSingleGoal: "true" });

  assert.equal(skipped.skip, true);
  assert.equal(skipped.reason, "goal_batch.single_goal");
  assert.equal(skipped.telemetry["hatch.ceremony.skipped"], "true");

  assert.equal(notSkipped.skip, false);
  assert.equal(notSkipped.reason, "goal_batch.multiple_goals");
  assert.equal(notSkipped.telemetry["hatch.ceremony.skipped"], "false");
});

test("shouldSkipGoalReview emits goal_queue single-goal reason and telemetry tuple", () => {
  const result = shouldSkipGoalReview({
    goalCount: 1,
    skipReviewSingleGoal: "true",
    pipeline: "goal_queue",
  });

  assert.equal(result.skip, true);
  assert.equal(result.reason, "goal_queue.single_goal");
  assert.equal(result.telemetry["hatch.ceremony.pipeline"], "goal_queue");
  assert.equal(result.telemetry["hatch.ceremony.skipped"], "true");
  assert.equal(result.telemetry["hatch.ceremony.skip_reason"], "goal_queue.single_goal");
  assert.equal(result.hatch_ceremony_pipeline, "goal_queue");
  assert.equal(result.hatch_ceremony_skipped, "true");
  assert.equal(result.hatch_ceremony_skip_reason, "goal_queue.single_goal");
});

test("decomposeAutoApproveDecision defaults to full review when metadata is missing", () => {
  const out = decomposeAutoApproveDecision({
    decomposeAutoApprove: "true",
    features: JSON.stringify([{ id: "F-1", name: "Missing criteria" }]),
  });

  assert.equal(out.auto_approve, false);
  assert.equal(out.reason, "decompose.criteria_metadata_missing");
  assert.equal(out.decompose_complexity, "unknown");
  assert.equal(out.telemetry["hatch.ceremony.skipped"], "false");
});

test("decomposeAutoApproveDecision preserves proposed features when auto-approve is disabled", () => {
  const features = [{ id: "F-1", name: "Real feature", acceptance_criteria: ["A"] }];
  const out = decomposeAutoApproveDecision({
    decomposeAutoApprove: "false",
    features: JSON.stringify(features),
  });

  assert.equal(out.auto_approve, false);
  assert.equal(out.approved, false);
  // Features must be preserved even when not auto-approved, so the review LLM
  // path has valid features in context if the reviewer doesn't re-emit them.
  assert.equal(out.approved_features.length, 1, "proposed features must not be cleared to [] on non-auto-approve");
  assert.equal(out.approved_features[0].id, "F-1");
  assert.deepEqual(out.factory_request_goal_graph, {});
});

test("decomposeAutoApproveDecision auto-approves low-complexity feature sets", () => {
  const out = decomposeAutoApproveDecision({
    decomposeAutoApprove: "true",
    features: JSON.stringify([
      { id: "F-1", acceptance_criteria: ["A", "B"] },
      { id: "F-2", acceptance_criteria: ["C"] },
    ]),
  });

  assert.equal(out.auto_approve, true);
  assert.equal(out.approved, true);
  assert.equal(out.reason, "decompose.auto_approve");
  assert.equal(out.decompose_complexity, "low");
  assert.equal(out.approved_features.length, 2);
  assert.equal(out.telemetry["hatch.ceremony.skip_reason"], "decompose.auto_approve");
});

test("shouldSkipIssueJudge keeps full judge path for non-trivial specs", () => {
  const out = shouldSkipIssueJudge({
    skipTrivialJudge: "true",
    feature: JSON.stringify({
      acceptance_criteria: ["one", "two", "three"],
      dependencies: [],
      domain: "pipeline",
    }),
  });

  assert.equal(out.skip, false);
  assert.equal(out.reason, "write_issue.criteria_exceeds_threshold");
  assert.equal(out.telemetry["hatch.ceremony.skipped"], "false");
});

test("shouldSkipIssueJudge bypasses trivial specs only with complete metadata", () => {
  const out = shouldSkipIssueJudge({
    skipTrivialJudge: "true",
    feature: JSON.stringify({
      acceptance_criteria: ["one", "two"],
      dependencies: [],
      domain: "pipeline",
    }),
  });

  assert.equal(out.skip, true);
  assert.equal(out.reason, "write_issue.trivial_spec");
  assert.equal(out.acceptance_criteria_count, 2);
  assert.equal(out.telemetry["hatch.ceremony.skip_reason"], "write_issue.trivial_spec");
});

test("shouldSkipIssueJudge does not bypass when issue_spec is non-trivial even if feature metadata is trivial", () => {
  const out = shouldSkipIssueJudge({
    skipTrivialJudge: "true",
    feature: JSON.stringify({
      acceptance_criteria: ["one", "two"],
      dependencies: [],
      domain: "pipeline",
    }),
    issueSpec: JSON.stringify({
      acceptance_criteria: ["one", "two", "three"],
      dependencies: [],
      domain: "pipeline",
    }),
  });

  assert.equal(out.skip, false);
  assert.equal(out.reason, "write_issue.criteria_exceeds_threshold");
  assert.equal(out.acceptance_criteria_count, 3);
  assert.equal(out.telemetry["hatch.ceremony.skipped"], "false");
});

test("shouldSkipIssueJudge does not bypass when issue_spec has dependencies even if feature metadata is trivial", () => {
  const out = shouldSkipIssueJudge({
    skipTrivialJudge: "true",
    feature: JSON.stringify({
      acceptance_criteria: ["one", "two"],
      dependencies: [],
      domain: "pipeline",
    }),
    issueSpec: JSON.stringify({
      acceptance_criteria: ["one", "two"],
      dependencies: ["#1234"],
      domain: "pipeline",
    }),
  });

  assert.equal(out.skip, false);
  assert.equal(out.reason, "write_issue.dependencies_present");
  assert.equal(out.dependency_count, 1);
  assert.equal(out.telemetry["hatch.ceremony.skipped"], "false");
});

test("classifyMilestoneIssueComplexity defaults unknown/high to sequential", () => {
  const unknown = classifyMilestoneIssueComplexity({
    complexityClass: "",
    milestoneParallelLowEnabled: "true",
  });
  const high = classifyMilestoneIssueComplexity({
    complexityClass: "high",
    milestoneParallelLowEnabled: "true",
  });

  assert.equal(unknown.complexity_class, "unknown");
  assert.equal(unknown.run_parallel_batch, false);
  assert.equal(unknown.reason, "milestone.sequential_fallback_unknown");

  assert.equal(high.complexity_class, "high");
  assert.equal(high.run_parallel_batch, false);
  assert.equal(high.reason, "milestone.high_sequential");
});

test("classifyMilestoneIssueComplexity allows low parallel batches only when enabled", () => {
  const enabled = classifyMilestoneIssueComplexity({
    complexityClass: "low",
    milestoneParallelLowEnabled: "true",
  });
  const disabled = classifyMilestoneIssueComplexity({
    complexityClass: "low",
    milestoneParallelLowEnabled: "false",
  });

  assert.equal(enabled.run_parallel_batch, true);
  assert.equal(enabled.reason, "milestone.low_parallel_batch");
  assert.equal(enabled.telemetry["hatch.ceremony.skipped"], "true");

  assert.equal(disabled.run_parallel_batch, false);
  assert.equal(disabled.reason, "milestone.high_sequential");
});

test("buildMilestoneParallelBatch returns bounded consecutive low issues", () => {
  const out = buildMilestoneParallelBatch({
    maxParallel: 3,
    issues: JSON.stringify([
      { issue_number: "100", issue_title: "A", complexity_class: "low" },
      { issue_number: "101", issue_title: "B", complexity_class: "low" },
      { issue_number: "102", issue_title: "C", complexity_class: "high" },
      { issue_number: "103", issue_title: "D", complexity_class: "low" },
    ]),
  });

  assert.equal(out.batch_size, 2);
  const decoded = out.batch_issues.map((item) => JSON.parse(Buffer.from(item, "base64").toString("utf8")));
  assert.deepEqual(decoded.map((item) => item.issue_number), ["100", "101"]);
  assert.equal(out.reason, "milestone.low_parallel_batch");
});

test("buildMilestoneParallelBatch returns empty batch when first item is not low", () => {
  const out = buildMilestoneParallelBatch({
    maxParallel: 3,
    issues: JSON.stringify([
      { issue_number: "200", issue_title: "A", complexity_class: "unknown" },
      { issue_number: "201", issue_title: "B", complexity_class: "low" },
    ]),
  });

  assert.equal(out.batch_size, 0);
  assert.equal(out.reason, "milestone.parallel_batch_empty");
  assert.equal(out.telemetry["hatch.ceremony.skipped"], "false");
});
