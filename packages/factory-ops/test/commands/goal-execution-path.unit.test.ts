import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  GOAL_EXECUTION_PATH_MALFORMED_ERROR_CODE,
  GOAL_EXECUTION_PATH_MIGRATION_CLASSIFICATION_VERSION,
  GOAL_EXECUTION_PATH_RECLASSIFIED_ERROR_CODE,
  GOAL_EXECUTION_PATH_ROUTING_CONTRACT_VERSION,
  classifyGoalExecutionPath,
  ensureGoalExecutionPath,
  ensureGoalExecutionPaths,
  readGoalExecutionPath,
  resolveGoalExecutionPath,
  transitionGoalExecutionPathPlanningState,
} from "../../src/commands/goal-execution-path.ts";
import { persistGoalDecompositionLedger } from "../../src/commands/goal-decomposition-packet.ts";

test("ensureGoalExecutionPath migrates legacy goals missing execution-path metadata", () => {
  const repo = mkdtempSync(join(tmpdir(), "goal-execution-path-ensure-"));

  const out = ensureGoalExecutionPath({
    repo,
    goalIssueNumber: "2196",
    factoryId: "mothership",
  });

  assert.equal(out.ensured, true);
  assert.equal(out.goal_issue_number, "2196");
  assert.equal(out.goal_execution_path, "medium");
  assert.equal(out.goal_execution_path_version, GOAL_EXECUTION_PATH_ROUTING_CONTRACT_VERSION);
  assert.equal(out.classification_version, GOAL_EXECUTION_PATH_MIGRATION_CLASSIFICATION_VERSION);
  assert.equal(out.goal_routing_state.decomposition_state, "required");
  assert.equal(out.goal_routing_state.planning_state, "not_required");
  assert.equal(out.understanding_risk, "unknown");
  assert.equal(out.rationale_required, false);
  assert.equal(out.provisional_hard, false);
  assert.equal(out.provisional, false);
  assert.equal(out.goal_execution_path_source, "packet_store");
  assert.equal(out.migration_status, "migrated_missing_metadata");
  assert.equal(out.goal_is_decomposed, "false");
  assert.equal(out.routing_contract_upgrade_required, false);
  assert.equal(out.required_goal_execution_path_version, GOAL_EXECUTION_PATH_ROUTING_CONTRACT_VERSION);
  assert.match(out.goal_execution_path_packet_path, /\.hatch\/mothership\/packets\/goal_execution_path_packet\//);
});

test("ensureGoalExecutionPath fails closed for decomposed goals missing execution-path metadata", () => {
  const repo = mkdtempSync(join(tmpdir(), "goal-execution-path-ensure-"));

  persistGoalDecompositionLedger({
    repo,
    goalIssueRaw: JSON.stringify({ number: 2196, title: "Goal 2196", url: "https://example.test/issues/2196" }),
    goalIssueNumber: "2196",
    approvedFeaturesRaw: JSON.stringify([{ name: "durable routing" }]),
    issueUrlsRaw: JSON.stringify(["https://example.test/issues/3001"]),
    factoryId: "mothership",
  });

  assert.throws(
    () => ensureGoalExecutionPath({ repo, goalIssueNumber: "2196", factoryId: "mothership" }),
    new RegExp(`${GOAL_EXECUTION_PATH_MALFORMED_ERROR_CODE}:2196:missing_execution_path_for_decomposed_goal`),
  );
});

test("readGoalExecutionPath fails when goal issue number is missing", () => {
  assert.throws(
    () => readGoalExecutionPath({ repo: ".", goalIssueNumber: "", factoryId: "mothership" }),
    /missing_goal_issue_number/,
  );
});

test("ensureGoalExecutionPaths validates all goals in batch payload", () => {
  const repo = mkdtempSync(join(tmpdir(), "goal-execution-path-batch-"));

  classifyGoalExecutionPath({
    repo,
    goalIssueNumber: "101",
    executionPath: "easy",
    routingContractVersion: "routing/v1",
    classificationVersion: "classifier/v1",
    decompositionState: "not_required",
    planningState: "not_required",
    classifiedBy: "goal_queue.classifier",
    classificationReason: "small",
    classificationSignalsRaw: JSON.stringify({ changed_files: 1 }),
    factoryId: "mothership",
  });
  classifyGoalExecutionPath({
    repo,
    goalIssueNumber: "102",
    executionPath: "medium",
    routingContractVersion: "routing/v1",
    classificationVersion: "classifier/v1",
    decompositionState: "required",
    planningState: "not_required",
    classifiedBy: "goal_queue.classifier",
    classificationReason: "decompose",
    classificationSignalsRaw: JSON.stringify({ changed_files: 6 }),
    factoryId: "mothership",
  });
  classifyGoalExecutionPath({
    repo,
    goalIssueNumber: "103",
    executionPath: "hard",
    routingContractVersion: "routing/v1",
    classificationVersion: "classifier/v2",
    decompositionState: "blocked",
    planningState: "required",
    classifiedBy: "goal_queue.classifier",
    classificationReason: "provisional hard",
    classificationSignalsRaw: JSON.stringify({ changed_files: 20 }),
    factoryId: "mothership",
  });

  const out = ensureGoalExecutionPaths({
    repo,
    goalIssueNumbersRaw: JSON.stringify([101, 102, 103, 101]),
    factoryId: "mothership",
  });

  assert.equal(out.goal_execution_path_count, 3);
  assert.equal(out.goal_execution_path_records.length, 3);
  assert.equal(out.goal_execution_paths["101"].goal_execution_path, "easy");
  assert.equal(out.goal_execution_paths["101"].understanding_risk, "unknown");
  assert.equal(out.goal_execution_paths["101"].rationale_required, false);
  assert.equal(out.goal_execution_paths["101"].provisional_hard, false);
  assert.equal(out.goal_execution_paths["101"].provisional, false);
  assert.equal(out.goal_execution_paths["102"].goal_execution_path, "medium");
  assert.equal(out.goal_execution_paths["102"].provisional_hard, false);
  assert.equal(out.goal_execution_paths["102"].provisional, false);
  assert.equal(out.goal_execution_paths["103"].goal_execution_path, "hard");
  assert.equal(out.goal_execution_paths["103"].goal_routing_state.decomposition_state, "required");
  assert.equal(out.goal_execution_paths["103"].goal_routing_state.planning_state, "not_required");
  assert.equal(out.goal_execution_paths["103"].understanding_risk, "high");
  assert.equal(out.goal_execution_paths["103"].rationale_required, true);
  assert.equal(out.goal_execution_paths["103"].provisional_hard, true);
  assert.equal(out.goal_execution_paths["103"].provisional, true);
});

test("ensureGoalExecutionPath preserves valid pre-existing metadata without reclassification", () => {
  const repo = mkdtempSync(join(tmpdir(), "goal-execution-path-existing-"));

  classifyGoalExecutionPath({
    repo,
    goalIssueNumber: "2201",
    executionPath: "hard",
    routingContractVersion: "routing/v1",
    classificationVersion: "classifier/v3",
    decompositionState: "blocked",
    planningState: "required",
    classifiedBy: "goal_queue.classifier",
    classificationReason: "needs planning",
    classificationSignalsRaw: JSON.stringify({ blockers: 2 }),
    factoryId: "mothership",
  });

  const out = ensureGoalExecutionPath({
    repo,
    goalIssueNumber: "2201",
    factoryId: "mothership",
  });

  assert.equal(out.goal_execution_path, "hard");
  assert.equal(out.goal_execution_path_version, "routing/v1");
  assert.equal(out.classification_version, "classifier/v3");
  assert.equal(out.goal_routing_state.decomposition_state, "required");
  assert.equal(out.goal_routing_state.planning_state, "not_required");
  assert.equal(out.provisional_hard, true);
  assert.equal(out.provisional, true);
  assert.equal(out.goal_execution_path_source, "packet_store");
  assert.equal(out.migration_status, "migration_complete_existing");
  assert.equal(out.routing_contract_upgrade_required, false);
});

test("ensureGoalExecutionPath marks decomposed goals with valid metadata as migration complete", () => {
  const repo = mkdtempSync(join(tmpdir(), "goal-execution-path-decomposed-existing-"));

  classifyGoalExecutionPath({
    repo,
    goalIssueNumber: "2208",
    executionPath: "medium",
    routingContractVersion: "routing/v1",
    classificationVersion: "classifier/v1",
    decompositionState: "required",
    planningState: "not_required",
    classifiedBy: "goal_queue.classifier",
    classificationReason: "decompose",
    classificationSignalsRaw: JSON.stringify({ migrated: false }),
    factoryId: "mothership",
  });

  persistGoalDecompositionLedger({
    repo,
    goalIssueRaw: JSON.stringify({ number: 2208, title: "Goal 2208", url: "https://example.test/issues/2208" }),
    goalIssueNumber: "2208",
    approvedFeaturesRaw: JSON.stringify([{ name: "goal decomposition" }]),
    issueUrlsRaw: JSON.stringify(["https://example.test/issues/3208"]),
    factoryId: "mothership",
  });

  const out = ensureGoalExecutionPath({
    repo,
    goalIssueNumber: "2208",
    factoryId: "mothership",
  });

  assert.equal(out.goal_execution_path, "medium");
  assert.equal(out.goal_is_decomposed, "true");
  assert.equal(out.migration_status, "migration_complete_decomposed");
  assert.equal(out.routing_contract_upgrade_required, false);
});

test("ensureGoalExecutionPath marks routing contract upgrade requirement without mutating legacy packet", () => {
  const repo = mkdtempSync(join(tmpdir(), "goal-execution-path-upgrade-"));

  classifyGoalExecutionPath({
    repo,
    goalIssueNumber: "2202",
    executionPath: "easy",
    routingContractVersion: "routing/v0",
    classificationVersion: "classifier/v0",
    decompositionState: "not_required",
    planningState: "not_required",
    classifiedBy: "goal_queue.classifier",
    classificationReason: "legacy packet",
    classificationSignalsRaw: JSON.stringify({ migration: false }),
    factoryId: "mothership",
  });

  const out = ensureGoalExecutionPath({
    repo,
    goalIssueNumber: "2202",
    factoryId: "mothership",
  });

  assert.equal(out.goal_execution_path, "easy");
  assert.equal(out.goal_execution_path_version, "routing/v0");
  assert.equal(out.migration_status, "migration_complete_existing");
  assert.equal(out.routing_contract_upgrade_required, true);
  assert.equal(out.required_goal_execution_path_version, GOAL_EXECUTION_PATH_ROUTING_CONTRACT_VERSION);
});

test("ensureGoalExecutionPath fails closed with deterministic malformed metadata error", () => {
  const repo = mkdtempSync(join(tmpdir(), "goal-execution-path-malformed-"));

  const persisted = classifyGoalExecutionPath({
    repo,
    goalIssueNumber: "2203",
    executionPath: "medium",
    routingContractVersion: "routing/v1",
    classificationVersion: "classifier/v1",
    decompositionState: "required",
    planningState: "not_required",
    classifiedBy: "goal_queue.classifier",
    classificationReason: "baseline",
    classificationSignalsRaw: JSON.stringify({ baseline: true }),
    factoryId: "mothership",
  });

  const packetPath = persisted.packet_path;
  const packet = JSON.parse(readFileSync(packetPath, "utf8"));
  packet.execution_path = "";
  writeFileSync(packetPath, `${JSON.stringify(packet, null, 2)}\n`, "utf8");

  assert.throws(
    () => ensureGoalExecutionPath({ repo, goalIssueNumber: "2203", factoryId: "mothership" }),
    new RegExp(`${GOAL_EXECUTION_PATH_MALFORMED_ERROR_CODE}:2203:invalid_goal_execution_path_packet:.*invalid_execution_path`),
  );
});

test("resolveGoalExecutionPath uses provided supervisor context when available", () => {
  const out = resolveGoalExecutionPath({
    goalIssueNumber: "101",
    goalExecutionPathsRaw: JSON.stringify({
      "101": {
        goal_execution_path: "hard",
        goal_routing_state: {
          decomposition_state: "blocked",
          planning_state: "required",
        },
        goal_execution_path_version: "routing/v2",
        classification_version: "classifier/v3",
      },
    }),
  });

  assert.equal(out.goal_issue_number, "101");
  assert.equal(out.goal_execution_path, "hard");
  assert.equal(out.goal_execution_path_version, "routing/v2");
  assert.equal(out.goal_routing_state.decomposition_state, "blocked");
  assert.equal(out.goal_execution_path_source, "supervisor_context");
  assert.equal(out.provisional_hard, false);
  assert.equal(out.provisional, false);
});

test("resolveGoalExecutionPath fails closed on malformed supervisor context", () => {
  assert.throws(() => resolveGoalExecutionPath({
    goalIssueNumber: "101",
    goalExecutionPathsRaw: JSON.stringify({
      "101": {
        goal_execution_path: "fast",
      },
    }),
  }), new RegExp(`${GOAL_EXECUTION_PATH_MALFORMED_ERROR_CODE}:101:invalid_execution_path`));
});

test("resolveGoalExecutionPath falls back to persisted packet lookup", () => {
  const repo = mkdtempSync(join(tmpdir(), "goal-execution-path-resolve-"));

  classifyGoalExecutionPath({
    repo,
    goalIssueNumber: "303",
    executionPath: "easy",
    routingContractVersion: "routing/v1",
    classificationVersion: "classifier/v1",
    decompositionState: "not_required",
    planningState: "not_required",
    classifiedBy: "goal_queue.classifier",
    classificationReason: "tiny",
    classificationSignalsRaw: JSON.stringify({ changed_files: 1 }),
    factoryId: "mothership",
  });

  const out = resolveGoalExecutionPath({
    repo,
    goalIssueNumber: "303",
    goalExecutionPathsRaw: "",
    factoryId: "mothership",
  });

  assert.equal(out.goal_issue_number, "303");
  assert.equal(out.goal_execution_path, "easy");
  assert.equal(out.goal_execution_path_source, "packet_store");
  assert.equal(out.provisional_hard, false);
  assert.equal(out.provisional, false);
});

test("resolveGoalExecutionPath rejects supervisor-context reclassification against persisted medium packet", () => {
  const repo = mkdtempSync(join(tmpdir(), "goal-execution-path-resolve-reclassify-"));

  const persisted = classifyGoalExecutionPath({
    repo,
    goalIssueNumber: "404",
    executionPath: "medium",
    routingContractVersion: "routing/v1",
    classificationVersion: "classifier/v5",
    decompositionState: "required",
    planningState: "not_required",
    classifiedBy: "goal_queue.classifier",
    classificationReason: "persisted medium",
    classificationSignalsRaw: JSON.stringify({ persisted: true }),
    factoryId: "mothership",
  });

  assert.throws(() => resolveGoalExecutionPath({
    repo,
    goalIssueNumber: "404",
    goalExecutionPathsRaw: JSON.stringify({
      "404": {
        goal_execution_path: "hard",
        goal_routing_state: {
          decomposition_state: "required",
          planning_state: "not_required",
        },
        goal_execution_path_version: "routing/v1",
        classification_version: "classifier/v5",
      },
    }),
    factoryId: "mothership",
  }), new RegExp(`${GOAL_EXECUTION_PATH_RECLASSIFIED_ERROR_CODE}:404:supervisor_context_reclassified:${persisted.packet_id}`));
});

test("resolveGoalExecutionPath rejects supervisor-context reclassification against persisted provisional hard packet", () => {
  const repo = mkdtempSync(join(tmpdir(), "goal-execution-path-resolve-reclassify-"));

  const persisted = classifyGoalExecutionPath({
    repo,
    goalIssueNumber: "405",
    executionPath: "hard",
    routingContractVersion: "routing/v1",
    classificationVersion: "classifier/v6",
    decompositionState: "required",
    planningState: "not_required",
    classifiedBy: "goal_queue.classifier",
    classificationReason: "persisted provisional hard",
    classificationSignalsRaw: JSON.stringify({ persisted: true }),
    factoryId: "mothership",
  });

  assert.throws(() => resolveGoalExecutionPath({
    repo,
    goalIssueNumber: "405",
    goalExecutionPathsRaw: JSON.stringify({
      "405": {
        goal_execution_path: "medium",
        goal_routing_state: {
          decomposition_state: "required",
          planning_state: "not_required",
        },
        goal_execution_path_version: "routing/v1",
        classification_version: "classifier/v6",
      },
    }),
    factoryId: "mothership",
  }), new RegExp(`${GOAL_EXECUTION_PATH_RECLASSIFIED_ERROR_CODE}:405:supervisor_context_reclassified:${persisted.packet_id}`));
});

test("transitionGoalExecutionPathPlanningState moves hard goals through pending_review to approved", () => {
  const repo = mkdtempSync(join(tmpdir(), "goal-execution-path-transition-"));

  classifyGoalExecutionPath({
    repo,
    goalIssueNumber: "2332",
    executionPath: "hard",
    routingContractVersion: "routing/v1",
    classificationVersion: "classifier/v6",
    decompositionState: "required",
    planningState: "not_required",
    classifiedBy: "goal_queue.classifier",
    classificationReason: "hard path",
    classificationSignalsRaw: JSON.stringify({ route: "hard" }),
    factoryId: "mothership",
  });

  const pending = transitionGoalExecutionPathPlanningState({
    repo,
    goalIssueNumber: "2332",
    factoryId: "mothership",
    nextPlanningState: "pending_review",
    planningArtifactPath: "/tmp/hard-plan.json",
    goalExecutionPath: "hard",
    goalRoutingStateRaw: JSON.stringify({ decomposition_state: "required", planning_state: "not_required" }),
    classifiedBy: "goal.hard_plan",
    classificationReason: "planning complete",
    classificationSignalsRaw: JSON.stringify({ transition: "pending_review" }),
  });

  assert.equal(pending.planning_state, "pending_review");
  assert.equal(pending.planning_artifact_path, "/tmp/hard-plan.json");

  const approved = transitionGoalExecutionPathPlanningState({
    repo,
    goalIssueNumber: "2332",
    factoryId: "mothership",
    nextPlanningState: "approved",
    goalExecutionPath: "hard",
    goalRoutingStateRaw: JSON.stringify({ decomposition_state: "required", planning_state: "pending_review" }),
    classifiedBy: "goal.run.admission",
    classificationReason: "ready re-applied",
    classificationSignalsRaw: JSON.stringify({ transition: "approved" }),
  });

  assert.equal(approved.planning_state, "approved");
  assert.equal(approved.planning_artifact_path, "/tmp/hard-plan.json");

  const resolved = readGoalExecutionPath({
    repo,
    goalIssueNumber: "2332",
    factoryId: "mothership",
  });
  assert.equal(resolved.planning_state, "approved");
  assert.equal(resolved.goal_routing_state.planning_artifact_path, "/tmp/hard-plan.json");
});

test("ensureGoalExecutionPaths requires 'repo' param, not 'repoRoot' (regression: action-registry mismatch)", () => {
  const repo = mkdtempSync(join(tmpdir(), "goal-exec-path-param-name-"));

  // Passing repoRoot (wrong param name from action registry) should fail
  // because the function destructures { repo } and repoRoot is silently ignored.
  assert.throws(
    () => ensureGoalExecutionPaths({
      repoRoot: repo,
      goalIssueNumbersRaw: JSON.stringify(["9001"]),
      factoryId: "mothership",
    }),
    /missing_repo_for_packet_storage/,
    "repoRoot is not a valid parameter — function expects 'repo'",
  );

  // Passing repo (correct param name) should work
  const out = ensureGoalExecutionPaths({
    repo,
    goalIssueNumbersRaw: JSON.stringify(["9001"]),
    factoryId: "mothership",
  });
  assert.equal(out.goal_execution_path_count, 1);
  assert.equal(out.goal_execution_paths["9001"].goal_execution_path, "medium");
});
