import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildGoalExecutionPathPacket,
  getGoalExecutionPath,
  getGoalExecutionStickyState,
  getGoalRoutingContractVersion,
  getLatestGoalExecutionPathPacket,
  parseGoalExecutionPathPacketShape,
  persistGoalExecutionPathPacket,
  validateGoalExecutionPathPacket,
} from "../../src/lib/goal-execution-path-packet.ts";

test("goal execution-path packet builds registered durable packet family", () => {
  const packet = buildGoalExecutionPathPacket({
    goalIssueNumber: "2196",
    executionPath: "medium",
    routingContractVersion: "routing/v1",
    classificationVersion: "classifier/v1",
    decompositionState: "required",
    planningState: "not_required",
    classifiedBy: "goal_queue.classifier",
    classificationReason: "Has multiple sub-deliverables requiring decomposition.",
    classificationSignalsRaw: JSON.stringify({ complexity: "multi-issue", confidence: 0.78 }),
    factoryId: "mothership",
  });

  const validation = validateGoalExecutionPathPacket(packet);
  assert.equal(validation.ok, true, validation.errors.join(","));
  assert.equal(packet.packet_type, "goal_execution_path_packet");
  assert.equal(packet.schema_version, "goal_execution_path_packet/v1");
  assert.equal(packet.execution_path, "medium");
  assert.equal(packet.handoff_kind, "goal_execution_path");
  assert.equal(packet.resource_refs.goal_issue_number, "2196");
  assert.equal(packet.understanding_risk, "unknown");
  assert.equal(packet.rationale_required, false);
  assert.deepEqual(packet.execution_commands, []);
  assert.match(packet.operator_prompt, /canonical execution-path contract/i);
});

test("goal execution-path packet rejects invalid execution_path", () => {
  const packet = buildGoalExecutionPathPacket({
    goalIssueNumber: "2196",
    executionPath: "unknown",
    routingContractVersion: "routing/v1",
    classificationVersion: "classifier/v1",
    decompositionState: "required",
    planningState: "not_required",
    classifiedBy: "goal_queue.classifier",
    classificationReason: "bad",
    classificationSignalsRaw: JSON.stringify({ why: "test" }),
    factoryId: "mothership",
  });

  const validation = validateGoalExecutionPathPacket(packet);
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.includes("invalid_execution_path:(empty)"));
});

test("goal execution-path packet rejects missing version metadata", () => {
  const packet = buildGoalExecutionPathPacket({
    goalIssueNumber: "2196",
    executionPath: "easy",
    decompositionState: "completed",
    planningState: "failed",
    classifiedBy: "goal_queue.classifier",
    classificationReason: "single deterministic change",
    classificationSignalsRaw: JSON.stringify({ changed_files: 1 }),
    factoryId: "mothership",
  });

  const validation = validateGoalExecutionPathPacket(packet);
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.includes("missing_required_field:routing_contract_version"));
  assert.ok(validation.errors.includes("missing_required_field:classification_version"));
});

test("goal execution-path packet persists to factory-scoped durable packet root", () => {
  const repo = mkdtempSync(join(tmpdir(), "goal-execution-path-packet-"));
  const packet = buildGoalExecutionPathPacket({
    goalIssueNumber: "2196",
    executionPath: "hard",
    routingContractVersion: "routing/v1",
    classificationVersion: "classifier/v2",
    decompositionState: "blocked",
    planningState: "required",
    classifiedBy: "goal_queue.classifier",
    classificationReason: "Needs planning artifact before decomposition.",
    classificationSignalsRaw: JSON.stringify({ blockers: ["missing-research"] }),
    factoryId: "mothership",
  });

  const persisted = persistGoalExecutionPathPacket({ repo, packet });
  assert.match(persisted.packet_path, /\.hatch\/mothership\/packets\/goal_execution_path_packet\/goal_execution_path_packet_/);

  const latest = getLatestGoalExecutionPathPacket({
    repo,
    factoryId: "mothership",
    goalIssueNumber: "2196",
  });
  assert.ok(latest);
  assert.equal(getGoalExecutionPath(latest.packet), "hard");
  assert.equal(getGoalRoutingContractVersion(latest.packet), "routing/v1");
  assert.deepEqual(getGoalExecutionStickyState(latest.packet), {
    decomposition_state: "blocked",
    planning_state: "required",
  });
});

test("goal execution-path packet rejects invalid decomposition/planning state values", () => {
  const packet = buildGoalExecutionPathPacket({
    goalIssueNumber: "2196",
    executionPath: "medium",
    routingContractVersion: "routing/v1",
    classificationVersion: "classifier/v1",
    decompositionState: "decomposing",
    planningState: "queued",
    classifiedBy: "goal_queue.classifier",
    classificationReason: "invalid state test",
    classificationSignalsRaw: JSON.stringify({ test: true }),
    factoryId: "mothership",
  });

  const validation = validateGoalExecutionPathPacket(packet);
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.includes("invalid_decomposition_state:decomposing"));
  assert.ok(validation.errors.includes("invalid_planning_state:queued"));
});

test("goal execution-path packet parser normalizes typed shape", () => {
  const packet = buildGoalExecutionPathPacket({
    goalIssueNumber: "2200",
    executionPath: "HARD",
    routingContractVersion: "routing/v1",
    classificationVersion: "classifier/v2",
    decompositionState: "REQUIRED",
    planningState: "NOT_REQUIRED",
    classifiedBy: "goal_queue.classifier",
    classificationReason: "normalize",
    classificationSignalsRaw: JSON.stringify({ normalize: true }),
    factoryId: "mothership",
  });

  const parsed = parseGoalExecutionPathPacketShape(packet);
  assert.deepEqual(parsed, {
    goal_issue_number: "2200",
    execution_path: "hard",
    routing_contract_version: "routing/v1",
    classification_version: "classifier/v2",
    decomposition_state: "required",
    planning_state: "not_required",
    understanding_risk: "high",
    rationale_required: true,
  });
});

test("goal execution-path packet persists explicit understanding-risk metadata", () => {
  const packet = buildGoalExecutionPathPacket({
    goalIssueNumber: "2401",
    executionPath: "easy",
    routingContractVersion: "routing/v1",
    classificationVersion: "classifier/v3",
    decompositionState: "not_required",
    planningState: "not_required",
    understandingRisk: "high",
    rationaleRequired: true,
    classifiedBy: "goal_queue.classifier",
    classificationReason: "small implementation but high understanding debt",
    classificationSignalsRaw: JSON.stringify({ changed_files: 1 }),
    factoryId: "mothership",
  });

  const validation = validateGoalExecutionPathPacket(packet);
  assert.equal(validation.ok, true, validation.errors.join(","));
  assert.equal(packet.understanding_risk, "high");
  assert.equal(packet.rationale_required, true);
});

test("goal execution-path packet accepts canonical lifecycle enums for sticky routing state", () => {
  const packet = buildGoalExecutionPathPacket({
    goalIssueNumber: "2201",
    executionPath: "hard",
    routingContractVersion: "routing/v1",
    classificationVersion: "classifier/v2",
    decompositionState: "PENDING",
    planningState: "RUNNING",
    classifiedBy: "goal_queue.classifier",
    classificationReason: "canonical states",
    classificationSignalsRaw: JSON.stringify({ canonical: true }),
    factoryId: "mothership",
  });

  const validation = validateGoalExecutionPathPacket(packet);
  assert.equal(validation.ok, true, validation.errors.join(","));
  assert.deepEqual(getGoalExecutionStickyState(packet), {
    decomposition_state: "pending",
    planning_state: "running",
  });
});

test("goal execution-path packet accepts pending_review/approved states and carries planning artifact path", () => {
  const pendingReviewPacket = buildGoalExecutionPathPacket({
    goalIssueNumber: "2332",
    executionPath: "hard",
    routingContractVersion: "routing/v1",
    classificationVersion: "classifier/v3",
    decompositionState: "required",
    planningState: "pending_review",
    planningArtifactPath: "/tmp/hard-plan-packet.json",
    classifiedBy: "goal.hard_plan",
    classificationReason: "planning hold",
    classificationSignalsRaw: JSON.stringify({ transition: "pending_review" }),
    factoryId: "mothership",
  });

  const approvedPacket = buildGoalExecutionPathPacket({
    goalIssueNumber: "2332",
    executionPath: "hard",
    routingContractVersion: "routing/v1",
    classificationVersion: "classifier/v3",
    decompositionState: "required",
    planningState: "approved",
    planningArtifactPath: "/tmp/hard-plan-packet.json",
    classifiedBy: "goal.run.admission",
    classificationReason: "ready re-applied",
    classificationSignalsRaw: JSON.stringify({ transition: "approved" }),
    factoryId: "mothership",
  });

  const pendingValidation = validateGoalExecutionPathPacket(pendingReviewPacket);
  const approvedValidation = validateGoalExecutionPathPacket(approvedPacket);
  assert.equal(pendingValidation.ok, true, pendingValidation.errors.join(","));
  assert.equal(approvedValidation.ok, true, approvedValidation.errors.join(","));

  assert.deepEqual(getGoalExecutionStickyState(pendingReviewPacket), {
    decomposition_state: "required",
    planning_state: "pending_review",
    planning_artifact_path: "/tmp/hard-plan-packet.json",
  });
  assert.equal(parseGoalExecutionPathPacketShape(approvedPacket).planning_state, "approved");
});
