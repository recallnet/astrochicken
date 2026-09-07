import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  GOAL_RUN_ADMISSION_DECISIONS,
  GOAL_RUN_ADMISSION_ERROR_CODES,
  buildGoalRunAdmissionFailure,
  inspectGoalRunAdmission,
  resetGoalRunAdmissionLocks,
} from "../../src/commands/goal-run-admission.ts";
import { HARD_GOAL_STATES } from "../../src/commands/goal-hard-state.ts";
import { persistGoalDecompositionLedger } from "../../src/commands/goal-decomposition-packet.ts";
import { classifyGoalExecutionPath } from "../../src/commands/goal-execution-path.ts";
import { getLatestGoalExecutionPathPacket } from "../../src/lib/goal-execution-path-packet.ts";
import { listGoalDecompositionPackets } from "../../src/lib/goal-decomposition-packet.ts";

function persistDecompositionPacket(repo, goalIssueNumber = "2196") {
  persistGoalDecompositionLedger({
    repo,
    goalIssueRaw: JSON.stringify({ number: Number(goalIssueNumber), title: `Goal ${goalIssueNumber}`, url: `https://example.test/issues/${goalIssueNumber}` }),
    goalIssueNumber,
    approvedFeaturesRaw: JSON.stringify([{ name: "feature", summary: "summary" }]),
    issueUrlsRaw: JSON.stringify([`https://example.test/issues/${Number(goalIssueNumber) + 1}`]),
    factoryId: "mothership",
  });
}

function persistExecutionPathPacket({
  repo,
  goalIssueNumber = "2196",
  executionPath = "medium",
  decompositionState = "required",
  planningState = "not_required",
} = {}) {
  classifyGoalExecutionPath({
    repo,
    goalIssueNumber,
    executionPath,
    routingContractVersion: "routing/v1",
    classificationVersion: "classifier/v1",
    decompositionState,
    planningState,
    classifiedBy: "goal_queue.classifier",
    classificationReason: "route persisted for admission coverage",
    classificationSignalsRaw: JSON.stringify({ test: true }),
    factoryId: "mothership",
  });
}

function inspectAdmissionWithoutPrerequisiteBlockers(input = {}) {
  return inspectGoalRunAdmission({
    resolveGhRepoFn: () => "recallnet/astrochicken",
    hasOpenPrerequisiteBlockerFn: () => ({ ok: true, error: "", openBlockers: [] }),
    ...input,
  });
}

test("inspectGoalRunAdmission allows first decomposition when planning is not required and no packet exists", () => {
  const repo = mkdtempSync(join(tmpdir(), "goal-run-admission-"));

  const out = inspectAdmissionWithoutPrerequisiteBlockers({
    repo,
    goalIssueNumber: "2196",
    goalExecutionPath: "medium",
    goalRoutingState: {
      decomposition_state: "required",
      planning_state: "not_required",
    },
    factoryId: "mothership",
  });

  assert.equal(out.goal_admission_allowed, "true");
  assert.equal(out.goal_admission_decision, GOAL_RUN_ADMISSION_DECISIONS.ALLOW);
  assert.equal(out.decomposition_packet_present, "false");
  assert.equal(out.planning_locked, "false");
  assert.equal(out.hard_goal, "false");
  assert.equal(out.hard_goal_state, "");
});

test("inspectGoalRunAdmission resolves hard-goal needs_planning when no hard-plan packet exists", () => {
  const repo = mkdtempSync(join(tmpdir(), "goal-run-admission-hard-state-"));

  const out = inspectAdmissionWithoutPrerequisiteBlockers({
    repo,
    goalIssueNumber: "2300",
    goalExecutionPath: "hard",
    goalRoutingState: {
      decomposition_state: "required",
      planning_state: "not_required",
    },
    goalLabels: [{ name: "goal" }, { name: "hard" }],
    factoryId: "mothership",
  });

  assert.equal(out.hard_goal, "true");
  assert.equal(out.hard_goal_state, HARD_GOAL_STATES.NEEDS_PLANNING);
  assert.equal(out.hard_plan_packet_present, "false");
});

test("inspectGoalRunAdmission resolves hard-goal awaiting_post_plan_review when packet exists but ready not restored", () => {
  const repo = mkdtempSync(join(tmpdir(), "goal-run-admission-hard-state-"));

  const out = inspectAdmissionWithoutPrerequisiteBlockers({
    repo,
    goalIssueNumber: "2301",
    goalExecutionPath: "hard",
    goalRoutingState: {
      decomposition_state: "required",
      planning_state: "required",
    },
    goalLabels: [{ name: "goal" }, { name: "hard" }, { name: "awaiting-human" }],
    hardGoal: "true",
    hardGoalState: HARD_GOAL_STATES.AWAITING_POST_PLAN_REVIEW,
    hardGoalStateReason: "awaiting_human_review_hold",
    readyLabelPresent: "false",
    awaitingHumanLabelPresent: "true",
    hardPlanPacketPresent: "true",
    hardPlanPacketId: "plan-awaiting",
    hardPlanPacketPath: ".hatch/mothership/packets/goal_hard_plan_packet/plan-awaiting.json",
    hardPlanArtifactCount: "2",
    hardPlanArtifactRefsRaw: JSON.stringify([
      { path: "artifacts/plan.md" },
      { url: "https://example.test/plan" },
    ]),
    factoryId: "mothership",
  });

  assert.equal(out.hard_goal, "true");
  assert.equal(out.hard_goal_state, HARD_GOAL_STATES.AWAITING_POST_PLAN_REVIEW);
  assert.equal(out.hard_plan_packet_present, "true");
  assert.equal(out.hard_plan_packet_id, "plan-awaiting");
  assert.equal(out.hard_plan_artifact_count, "2");
  assert.equal(out.goal_admission_decision, GOAL_RUN_ADMISSION_DECISIONS.DENY_PLANNING_LOCKED);
  assert.equal(out.goal_admission_error_code, GOAL_RUN_ADMISSION_ERROR_CODES.PLANNING_LOCKED);
});

test("inspectGoalRunAdmission allows approved hard-plan resume without planning lock", () => {
  const repo = mkdtempSync(join(tmpdir(), "goal-run-admission-hard-state-"));

  const out = inspectAdmissionWithoutPrerequisiteBlockers({
    repo,
    goalIssueNumber: "2302",
    goalExecutionPath: "hard",
    goalRoutingState: {
      decomposition_state: "required",
      planning_state: "required",
    },
    goalLabels: [{ name: "goal" }, { name: "hard" }, { name: "ready" }],
    hardGoal: "true",
    hardGoalState: HARD_GOAL_STATES.APPROVED_PLAN_RESUME,
    hardGoalStateReason: "hard_plan_packet_present_and_ready_restored",
    readyLabelPresent: "true",
    awaitingHumanLabelPresent: "false",
    hardPlanPacketPresent: "true",
    hardPlanPacketId: "plan-approved",
    hardPlanPacketPath: ".hatch/mothership/packets/goal_hard_plan_packet/plan-approved.json",
    hardPlanArtifactCount: "1",
    hardPlanArtifactRefsRaw: JSON.stringify([{ path: "artifacts/plan.md" }]),
    factoryId: "mothership",
  });

  assert.equal(out.goal_admission_allowed, "true");
  assert.equal(out.goal_admission_decision, GOAL_RUN_ADMISSION_DECISIONS.ALLOW_APPROVED_PLAN_RESUME);
  assert.equal(out.goal_admission_reason, "approved_plan_resume");
  assert.equal(out.planning_locked, "false");
  assert.equal(out.planning_lock_bypassed, "true");
  assert.equal(out.hard_goal_state, HARD_GOAL_STATES.APPROVED_PLAN_RESUME);
  assert.equal(out.hard_plan_packet_id, "plan-approved");
});

test("inspectGoalRunAdmission denies duplicate decomposition for medium route when execution metadata already persisted", () => {
  const repo = mkdtempSync(join(tmpdir(), "goal-run-admission-"));
  persistExecutionPathPacket({ repo, goalIssueNumber: "2196", executionPath: "medium" });
  persistDecompositionPacket(repo, "2196");

  const out = inspectAdmissionWithoutPrerequisiteBlockers({
    repo,
    goalIssueNumber: "2196",
    goalExecutionPath: "medium",
    goalRoutingStateRaw: JSON.stringify({
      decomposition_state: "required",
      planning_state: "not_required",
    }),
    factoryId: "mothership",
  });

  assert.equal(out.goal_admission_allowed, "false");
  assert.equal(out.goal_admission_decision, GOAL_RUN_ADMISSION_DECISIONS.DENY_DUPLICATE_DECOMPOSITION);
  assert.equal(out.goal_admission_error_code, GOAL_RUN_ADMISSION_ERROR_CODES.DUPLICATE_DECOMPOSITION);
  assert.equal(out.goal_execution_route_class, "medium");
  assert.equal(out.goal_admission_reason, "decomposition_packet_exists_medium");
  assert.equal(out.decomposition_packet_present, "true");
  assert.equal(out.planning_locked, "false");
});

test("inspectGoalRunAdmission denies duplicate decomposition for provisional hard route when execution metadata already persisted", () => {
  const repo = mkdtempSync(join(tmpdir(), "goal-run-admission-"));
  persistExecutionPathPacket({
    repo,
    goalIssueNumber: "2198",
    executionPath: "hard",
    decompositionState: "required",
    planningState: "not_required",
  });
  persistDecompositionPacket(repo, "2198");

  const out = inspectAdmissionWithoutPrerequisiteBlockers({
    repo,
    goalIssueNumber: "2198",
    goalExecutionPath: "hard",
    goalRoutingState: {
      decomposition_state: "required",
      planning_state: "not_required",
    },
    factoryId: "mothership",
  });

  assert.equal(out.goal_admission_allowed, "false");
  assert.equal(out.goal_admission_decision, GOAL_RUN_ADMISSION_DECISIONS.DENY_DUPLICATE_DECOMPOSITION);
  assert.equal(out.goal_admission_error_code, GOAL_RUN_ADMISSION_ERROR_CODES.DUPLICATE_DECOMPOSITION);
  assert.equal(out.goal_execution_route_class, "provisional_hard");
  assert.equal(out.goal_admission_reason, "decomposition_packet_exists_provisional_hard");
  assert.equal(out.decomposition_packet_present, "true");
  assert.equal(out.planning_locked, "false");
});

test("inspectGoalRunAdmission allows provisional hard decomposition when planning is not required", () => {
  const repo = mkdtempSync(join(tmpdir(), "goal-run-admission-"));

  const out = inspectAdmissionWithoutPrerequisiteBlockers({
    repo,
    goalIssueNumber: "2197",
    goalExecutionPath: "hard",
    goalRoutingState: {
      decomposition_state: "required",
      planning_state: "not_required",
    },
    factoryId: "mothership",
  });

  assert.equal(out.goal_admission_allowed, "true");
  assert.equal(out.goal_admission_decision, GOAL_RUN_ADMISSION_DECISIONS.ALLOW);
  assert.equal(out.planning_locked, "false");
});

test("inspectGoalRunAdmission denies planning-locked goals even without decomposition packets", () => {
  const repo = mkdtempSync(join(tmpdir(), "goal-run-admission-"));

  const out = inspectAdmissionWithoutPrerequisiteBlockers({
    repo,
    goalIssueNumber: "2197",
    goalExecutionPath: "hard",
    goalRoutingState: {
      decomposition_state: "blocked",
      planning_state: "required",
    },
    factoryId: "mothership",
  });

  assert.equal(out.goal_admission_allowed, "false");
  assert.equal(out.goal_admission_decision, GOAL_RUN_ADMISSION_DECISIONS.DENY_PLANNING_LOCKED);
  assert.equal(out.goal_admission_error_code, GOAL_RUN_ADMISSION_ERROR_CODES.PLANNING_LOCKED);
  assert.equal(out.planning_locked, "true");
});

test("inspectGoalRunAdmission denies when prerequisite blockers are open", () => {
  const repo = mkdtempSync(join(tmpdir(), "goal-run-admission-prereq-"));

  const out = inspectGoalRunAdmission({
    repo,
    goalIssueNumber: "2396",
    goalExecutionPath: "easy",
    goalRoutingState: {
      decomposition_state: "required",
      planning_state: "not_required",
    },
    resolveGhRepoFn: () => "recallnet/astrochicken",
    hasOpenPrerequisiteBlockerFn: () => ({ ok: true, error: "", openBlockers: [101, 88, 101] }),
    factoryId: "mothership",
  });

  assert.equal(out.goal_admission_allowed, "false");
  assert.equal(out.goal_admission_decision, GOAL_RUN_ADMISSION_DECISIONS.DENY_PREREQUISITE_BLOCKED);
  assert.equal(out.goal_admission_error_code, GOAL_RUN_ADMISSION_ERROR_CODES.PREREQUISITE_BLOCKED);
  assert.equal(out.goal_admission_reason, "prerequisite_blockers_present:88,101");
  assert.deepEqual(out.prerequisite_open_blockers, [88, 101]);
});

test("inspectGoalRunAdmission denies fail-closed on prerequisite lookup failure", () => {
  const repo = mkdtempSync(join(tmpdir(), "goal-run-admission-prereq-"));

  const out = inspectGoalRunAdmission({
    repo,
    goalIssueNumber: "2396",
    goalExecutionPath: "easy",
    goalRoutingState: {
      decomposition_state: "required",
      planning_state: "not_required",
    },
    resolveGhRepoFn: () => "recallnet/astrochicken",
    hasOpenPrerequisiteBlockerFn: () => ({ ok: false, error: "failed_lookup", openBlockers: [] }),
    factoryId: "mothership",
  });

  assert.equal(out.goal_admission_allowed, "false");
  assert.equal(out.goal_admission_decision, GOAL_RUN_ADMISSION_DECISIONS.DENY_PREREQUISITE_LOOKUP_FAILURE);
  assert.equal(out.goal_admission_error_code, GOAL_RUN_ADMISSION_ERROR_CODES.PREREQUISITE_LOOKUP_FAILURE);
  assert.equal(out.goal_admission_reason, "prerequisite_blocker_lookup_failed:failed_lookup");
  assert.deepEqual(out.prerequisite_open_blockers, []);
});

test("inspectGoalRunAdmission still allows when prerequisites resolved", () => {
  const repo = mkdtempSync(join(tmpdir(), "goal-run-admission-prereq-"));

  const out = inspectGoalRunAdmission({
    repo,
    goalIssueNumber: "2396",
    goalExecutionPath: "easy",
    goalRoutingState: {
      decomposition_state: "required",
      planning_state: "not_required",
    },
    resolveGhRepoFn: () => "recallnet/astrochicken",
    hasOpenPrerequisiteBlockerFn: () => ({ ok: true, error: "", openBlockers: [] }),
    factoryId: "mothership",
  });

  assert.equal(out.goal_admission_allowed, "true");
  assert.equal(out.goal_admission_decision, GOAL_RUN_ADMISSION_DECISIONS.ALLOW);
  assert.deepEqual(out.prerequisite_open_blockers, []);
});

test("buildGoalRunAdmissionFailure returns deterministic error envelope", () => {
  const out = buildGoalRunAdmissionFailure({
    goalIssueNumber: "2196",
    goalAdmissionDecision: GOAL_RUN_ADMISSION_DECISIONS.DENY_DUPLICATE_DECOMPOSITION,
    goalAdmissionReason: "decomposition_packet_exists_medium",
    goalAdmissionErrorCode: GOAL_RUN_ADMISSION_ERROR_CODES.DUPLICATE_DECOMPOSITION,
    decompositionPacketPresent: "true",
    planningLocked: "false",
  });

  assert.equal(out.ok, false);
  assert.equal(
    out.error,
    "E_GOAL_RUN_ADMISSION_DUPLICATE_DECOMPOSITION:2196:deny_duplicate_decomposition:decomposition_packet_exists_medium",
  );
});

test("resetGoalRunAdmissionLocks supersedes decomposition and execution-path packets for explicit operator reset", () => {
  const repo = mkdtempSync(join(tmpdir(), "goal-run-admission-reset-"));
  const goalIssueNumber = "2296";

  persistDecompositionPacket(repo, goalIssueNumber);
  classifyGoalExecutionPath({
    repo,
    goalIssueNumber,
    executionPath: "medium",
    routingContractVersion: "routing/v1",
    classificationVersion: "classifier/v1",
    decompositionState: "required",
    planningState: "not_required",
    classifiedBy: "goal_queue.classifier",
    classificationReason: "reset coverage",
    classificationSignalsRaw: JSON.stringify({ test: true }),
    factoryId: "mothership",
  });

  const reset = resetGoalRunAdmissionLocks({
    repo,
    goalIssueNumber,
    factoryId: "mothership",
    reason: "operator_requested_reclassification",
  });

  assert.equal(reset.ok, true);
  assert.equal(reset.superseded_count, 2);
  assert.equal(reset.decomposition_packets_superseded, 1);
  assert.equal(reset.execution_path_packets_superseded, 1);

  const activeDecompose = listGoalDecompositionPackets({
    repo,
    factoryId: "mothership",
    goalIssueNumber,
  });
  assert.equal(activeDecompose.length, 0);

  const latestExecutionPathPacket = getLatestGoalExecutionPathPacket({
    repo,
    factoryId: "mothership",
    goalIssueNumber,
  });
  assert.equal(latestExecutionPathPacket, null);
});
