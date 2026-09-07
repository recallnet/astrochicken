import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  GOAL_EXECUTION_PATH_RECLASSIFIED_ERROR_CODE,
  classifyGoalExecutionPath,
  inspectGoalExecutionPath,
} from "../../src/commands/goal-execution-path.ts";
import { appendGoalRationaleFeature } from "../../src/commands/goal-append-rationale-feature.ts";

test("classifyGoalExecutionPath persists packet and returns canonical summary", () => {
  const repo = mkdtempSync(join(tmpdir(), "goal-execution-path-command-"));
  const out = classifyGoalExecutionPath({
    repo,
    goalIssueNumber: "2196",
    executionPath: "medium",
    routingContractVersion: "routing/v1",
    classificationVersion: "classifier/v1",
    decompositionState: "required",
    planningState: "not_required",
    classifiedBy: "goal_queue.classifier",
    classificationReason: "Decompose and triage path required for this goal.",
    classificationSignalsRaw: JSON.stringify({ feature_count: 4 }),
    factoryId: "mothership",
  });

  assert.equal(out.packet_type, "goal_execution_path_packet");
  assert.equal(out.goal_issue_number, "2196");
  assert.equal(out.execution_path, "medium");
  assert.equal(out.routing_contract_version, "routing/v1");
  assert.equal(out.classification_version, "classifier/v1");
  assert.equal(out.decomposition_state, "required");
  assert.equal(out.planning_state, "not_required");
  assert.equal(out.understanding_risk, "unknown");
  assert.equal(out.rationale_required, false);
  assert.equal(out.provisional_hard, false);
  assert.equal(out.provisional, false);
  assert.equal(out.classification_trace, "persisted");
  assert.match(out.packet_path, /\.hatch\/mothership\/packets\/goal_execution_path_packet\//);
});

test("inspectGoalExecutionPath returns persisted packet fields", () => {
  const repo = mkdtempSync(join(tmpdir(), "goal-execution-path-command-"));
  classifyGoalExecutionPath({
    repo,
    goalIssueNumber: "2196",
    executionPath: "easy",
    routingContractVersion: "routing/v1",
    classificationVersion: "classifier/v1",
    decompositionState: "not_required",
    planningState: "not_required",
    classifiedBy: "goal_queue.classifier",
    classificationReason: "Small bounded change.",
    classificationSignalsRaw: JSON.stringify({ changed_files: 1 }),
    factoryId: "mothership",
  });

  const out = inspectGoalExecutionPath({
    repo,
    goalIssueNumber: "2196",
    factoryId: "mothership",
  });

  assert.equal(out.found, true);
  assert.equal(out.goal_issue_number, "2196");
  assert.equal(out.execution_path, "easy");
  assert.equal(out.routing_contract_version, "routing/v1");
  assert.equal(out.classification_version, "classifier/v1");
  assert.equal(out.decomposition_state, "not_required");
  assert.equal(out.planning_state, "not_required");
  assert.equal(out.understanding_risk, "unknown");
  assert.equal(out.rationale_required, false);
  assert.equal(out.provisional_hard, false);
  assert.equal(out.provisional, false);
});

test("inspectGoalExecutionPath reports missing packet deterministically", () => {
  const repo = mkdtempSync(join(tmpdir(), "goal-execution-path-command-"));
  const out = inspectGoalExecutionPath({
    repo,
    goalIssueNumber: "2196",
    factoryId: "mothership",
  });
  assert.deepEqual(out, {
    found: false,
    goal_issue_number: "2196",
  });
});

test("classifyGoalExecutionPath rejects unknown execution paths", () => {
  const repo = mkdtempSync(join(tmpdir(), "goal-execution-path-command-"));
  assert.throws(() => classifyGoalExecutionPath({
    repo,
    goalIssueNumber: "2196",
    executionPath: "unknown",
    routingContractVersion: "routing/v1",
    classificationVersion: "classifier/v1",
    decompositionState: "required",
    planningState: "not_required",
    classifiedBy: "goal_queue.classifier",
    classificationReason: "bad input",
    classificationSignalsRaw: JSON.stringify({ feature_count: 99 }),
    factoryId: "mothership",
  }), /invalid_goal_execution_path_packet:.*invalid_execution_path:\(empty\)/);
});

test("classifyGoalExecutionPath fails closed when packet already exists, even for identical payload", () => {
  const repo = mkdtempSync(join(tmpdir(), "goal-execution-path-command-"));

  const first = classifyGoalExecutionPath({
    repo,
    goalIssueNumber: "2196",
    executionPath: "easy",
    routingContractVersion: "routing/v1",
    classificationVersion: "classifier/v1",
    decompositionState: "not_required",
    planningState: "not_required",
    classifiedAt: "2026-03-01T00:00:00.000Z",
    classifiedBy: "goal_queue.classifier",
    classificationReason: "Small bounded change.",
    classificationSignalsRaw: JSON.stringify({ changed_files: 1 }),
    factoryId: "mothership",
  });

  assert.throws(() => classifyGoalExecutionPath({
    repo,
    goalIssueNumber: "2196",
    executionPath: "easy",
    routingContractVersion: "routing/v1",
    classificationVersion: "classifier/v9",
    decompositionState: "not_required",
    planningState: "not_required",
    classifiedAt: "2026-03-02T00:00:00.000Z",
    classifiedBy: "goal_queue.classifier.override",
    classificationReason: "duplicate classify should fail closed",
    classificationSignalsRaw: JSON.stringify({ changed_files: 99 }),
    factoryId: "mothership",
  }), new RegExp(`${GOAL_EXECUTION_PATH_RECLASSIFIED_ERROR_CODE}:2196:reclassification_requires_reset:${first.packet_id}`));

  const out = inspectGoalExecutionPath({
    repo,
    goalIssueNumber: "2196",
    factoryId: "mothership",
  });

  assert.equal(out.found, true);
  assert.equal(out.execution_path, "easy");
  assert.equal(out.classification_version, "classifier/v1");
  assert.equal(out.classified_at, "2026-03-01T00:00:00.000Z");
});

test("classifyGoalExecutionPath fails closed when reclassification differs from stored payload", () => {
  const repo = mkdtempSync(join(tmpdir(), "goal-execution-path-command-"));

  const first = classifyGoalExecutionPath({
    repo,
    goalIssueNumber: "2196",
    executionPath: "easy",
    routingContractVersion: "routing/v1",
    classificationVersion: "classifier/v1",
    decompositionState: "not_required",
    planningState: "not_required",
    classifiedAt: "2026-03-01T00:00:00.000Z",
    classifiedBy: "goal_queue.classifier",
    classificationReason: "Small bounded change.",
    classificationSignalsRaw: JSON.stringify({ changed_files: 1 }),
    factoryId: "mothership",
  });

  assert.throws(() => classifyGoalExecutionPath({
    repo,
    goalIssueNumber: "2196",
    executionPath: "hard",
    routingContractVersion: "routing/v1",
    classificationVersion: "classifier/v2",
    decompositionState: "blocked",
    planningState: "required",
    classifiedAt: "2026-03-02T00:00:00.000Z",
    classifiedBy: "goal_queue.classifier",
    classificationReason: "Requires planning before execution.",
    classificationSignalsRaw: JSON.stringify({ dependencies: ["architecture review"] }),
    factoryId: "mothership",
  }), new RegExp(`${GOAL_EXECUTION_PATH_RECLASSIFIED_ERROR_CODE}:2196:reclassification_requires_reset:${first.packet_id}`));

  const out = inspectGoalExecutionPath({
    repo,
    goalIssueNumber: "2196",
    factoryId: "mothership",
  });

  assert.equal(out.found, true);
  assert.equal(out.packet_id, first.packet_id);
  assert.equal(out.execution_path, "easy");
  assert.equal(out.classification_version, "classifier/v1");
  assert.equal(out.classified_at, "2026-03-01T00:00:00.000Z");
});

test("classifyGoalExecutionPath normalizes hard routing/v1 to provisional decomposition metadata", () => {
  const repo = mkdtempSync(join(tmpdir(), "goal-execution-path-command-"));

  const out = classifyGoalExecutionPath({
    repo,
    goalIssueNumber: "2399",
    executionPath: "hard",
    routingContractVersion: "routing/v1",
    classificationVersion: "classifier/v4",
    decompositionState: "blocked",
    planningState: "required",
    classifiedBy: "goal_queue.classifier",
    classificationReason: "stage-1 provisional hard",
    classificationSignalsRaw: JSON.stringify({ target: "provisional_hard" }),
    factoryId: "mothership",
  });

  assert.equal(out.execution_path, "hard");
  assert.equal(out.decomposition_state, "required");
  assert.equal(out.planning_state, "not_required");
  assert.equal(out.understanding_risk, "high");
  assert.equal(out.rationale_required, true);
  assert.equal(out.provisional_hard, true);
  assert.equal(out.provisional, true);

  const inspected = inspectGoalExecutionPath({
    repo,
    goalIssueNumber: "2399",
    factoryId: "mothership",
  });
  assert.equal(inspected.execution_path, "hard");
  assert.equal(inspected.decomposition_state, "required");
  assert.equal(inspected.planning_state, "not_required");
  assert.equal(inspected.understanding_risk, "high");
  assert.equal(inspected.rationale_required, true);
  assert.equal(inspected.provisional_hard, true);
  assert.equal(inspected.provisional, true);
});

test("classifyGoalExecutionPath preserves explicit understanding-risk metadata for easy goals", () => {
  const repo = mkdtempSync(join(tmpdir(), "goal-execution-path-command-"));

  const out = classifyGoalExecutionPath({
    repo,
    goalIssueNumber: "2501",
    executionPath: "easy",
    routingContractVersion: "routing/v1",
    classificationVersion: "classifier/v1",
    decompositionState: "not_required",
    planningState: "not_required",
    understandingRisk: "high",
    rationaleRequired: true,
    classifiedBy: "goal_queue.classifier",
    classificationReason: "easy change with high understanding debt",
    classificationSignalsRaw: JSON.stringify({ understanding_risk: "high", rationale_required: true }),
    factoryId: "mothership",
  });

  assert.equal(out.understanding_risk, "high");
  assert.equal(out.rationale_required, true);
});

test("appendGoalRationaleFeature appends one rationale issue when required", () => {
  const out = appendGoalRationaleFeature({
    approvedFeaturesRaw: JSON.stringify([{
      feature_id: "feature-1",
      title: "Implement runtime boundary",
      summary: "Ship the actual runtime change.",
    }]),
    goalIssueRaw: JSON.stringify({
      number: 2401,
      title: "Goal: Ship runtime boundary change",
    }),
    executionPath: "easy",
    understandingRisk: "high",
    rationaleRequired: "true",
  });

  assert.equal(out.rationale_required, "true");
  assert.equal(out.rationale_feature_added, "true");
  const features = JSON.parse(out.approved_features);
  assert.equal(features.length, 2);
  assert.equal(features.at(-1).work_item_kind, "rationale_doc");
});

test("classifyGoalExecutionPath rejects invalid routing-state enums", () => {
  const repo = mkdtempSync(join(tmpdir(), "goal-execution-path-command-"));

  assert.throws(() => classifyGoalExecutionPath({
    repo,
    goalIssueNumber: "2196",
    executionPath: "easy",
    routingContractVersion: "routing/v1",
    classificationVersion: "classifier/v1",
    decompositionState: "decomposing",
    planningState: "queued",
    classifiedBy: "goal_queue.classifier",
    classificationReason: "invalid sticky states",
    classificationSignalsRaw: JSON.stringify({ invalid: true }),
    factoryId: "mothership",
  }), /invalid_goal_execution_path_packet:.*invalid_decomposition_state:decomposing.*invalid_planning_state:queued/);
});
