import { successfulCommandResult } from "../helpers/ops-command-fixtures.ts";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { classifyGoalExecutionPath, readGoalExecutionPath, transitionGoalExecutionPathPlanningState } from "../../src/commands/goal-execution-path.ts";
import { materializeApprovedHardPlan } from "../../src/commands/goal-hard-plan-materialize.ts";
import { resolveFeatureDependencies } from "../../src/commands/triage-resolve-feature-dependencies.ts";
import { getLatestGoalHardPlanMaterializationPacket } from "../../src/lib/goal-hard-plan-materialization-packet.ts";

function writePlanArtifact({
  dir,
  packetId = "plan-2201",
  goalIssueNumber = "2201",
  planningState = "approved",
  approvedFeatures = [],
  extra = {},
}) {
  const path = join(dir, `${packetId}.json`);
  writeFileSync(path, JSON.stringify({
    schema_version: "hard_plan_packet/v1",
    packet_type: "hard_plan_packet",
    packet_id: packetId,
    goal_issue_number: goalIssueNumber,
    planning_state: planningState,
    approved_features: approvedFeatures,
    ...extra,
  }, null, 2));
  return path;
}

function seedExecutionPath({ repoRoot, goalIssueNumber = "2201" }) {
  classifyGoalExecutionPath({
    repo: repoRoot,
    goalIssueNumber,
    executionPath: "hard",
    routingContractVersion: "routing/v1",
    classificationVersion: "classifier/v1",
    decompositionState: "required",
    planningState: "not_required",
    classifiedBy: "test.seed",
    classificationReason: "seed hard path",
    classificationSignalsRaw: JSON.stringify({ seeded: true }),
    factoryId: "mothership",
  });
}

function markPlanningApproved({ repoRoot, goalIssueNumber, planningArtifactPath }) {
  transitionGoalExecutionPathPlanningState({
    repo: repoRoot,
    goalIssueNumber,
    factoryId: "mothership",
    nextPlanningState: "pending_review",
    planningArtifactPath,
    goalExecutionPath: "hard",
    goalRoutingStateRaw: JSON.stringify({
      decomposition_state: "required",
      planning_state: "not_required",
    }),
    classifiedBy: "test.seed",
    classificationReason: "seed pending review",
    classificationSignalsRaw: JSON.stringify({ seeded: true, state: "pending_review" }),
  });

  transitionGoalExecutionPathPlanningState({
    repo: repoRoot,
    goalIssueNumber,
    factoryId: "mothership",
    nextPlanningState: "approved",
    planningArtifactPath,
    goalExecutionPath: "hard",
    goalRoutingStateRaw: JSON.stringify({
      decomposition_state: "required",
      planning_state: "pending_review",
      planning_artifact_path: planningArtifactPath,
    }),
    classifiedBy: "test.seed",
    classificationReason: "seed approved state",
    classificationSignalsRaw: JSON.stringify({ seeded: true, state: "approved" }),
  });
}

test("materializeApprovedHardPlan creates one issue per approved feature and wires blockedBy", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "goal-hard-materialize-"));
  const goalIssueNumber = "2201";
  const planPacketId = "plan-2201";

  seedExecutionPath({ repoRoot, goalIssueNumber });

  const planningArtifactPath = writePlanArtifact({
    dir: repoRoot,
    packetId: planPacketId,
    goalIssueNumber,
    approvedFeatures: [
      {
        feature_id: "F-1",
        name: "Build deterministic plan materializer",
        summary: "Create issue materializer command.",
        acceptance_criteria: ["Command materializes issues deterministically."],
      },
      {
        feature_id: "F-2",
        name: "Wire blockedBy relationships",
        summary: "Apply dependency graph as blockedBy edges.",
        dependencies: ["F-1"],
      },
    ],
    extra: { rationale_required: false },
  });

  markPlanningApproved({ repoRoot, goalIssueNumber, planningArtifactPath });

  let nextIssue = 500;
  const issueCreateCalls = [];
  const subIssueCalls = [];
  const blockedByCalls = [];
  const goalLabelEdits = [];

  const out = materializeApprovedHardPlan({
    repoRoot,
    repo: "recallnet/astrochicken",
    goalNumber: goalIssueNumber,
    planPacketId,
    planningArtifactPath,
    factoryId: "mothership",
    runId: "run-1",
    targetRepo: "recallnet/astrochicken",
    controlPlaneRepo: "recallnet/astrochicken",
    createIssueFn: ({ issueSpecRaw }) => {
      issueCreateCalls.push(JSON.parse(issueSpecRaw));
      const issueNumber = nextIssue;
      nextIssue += 1;
      return {
        ok: true,
        issue_url: `https://github.com/recallnet/astrochicken/issues/${issueNumber}`,
        created_issue_number: String(issueNumber),
      };
    },
    addSubIssueFn: ({ parentNumber, childNumber }) => {
      subIssueCalls.push({ parentNumber, childNumber });
      return { ok: true };
    },
    syncBlockedByFn: ({ issueNumber, blockedByRaw }) => {
      blockedByCalls.push({ issueNumber, blockedByRaw });
      return { synced: true, added: 1, removed: 0 };
    },
    ghExecFn: (args) => {
      goalLabelEdits.push(args);
      return successfulCommandResult();
    },
  });

  assert.equal(issueCreateCalls.length, 2);
  assert.equal(subIssueCalls.length, 2);
  assert.equal(blockedByCalls.length, 2);
  assert.equal(goalLabelEdits.length, 1);

  assert.deepEqual(out.created_issue_numbers, [500, 501]);
  assert.deepEqual(out.factory_request_prerequisite_materialization, []);
  assert.deepEqual(out.issue_set_map, {});
  assert.deepEqual(out.prerequisite_goal_issue_numbers, []);
  assert.equal(out.final_instantiation_goal_issue_number, null);
  assert.deepEqual(out.goal_feature_issue_map, {});
  assert.deepEqual(out.feature_materialization_markers, []);
  assert.deepEqual(out.blocked_by_edges, [
    { issue_number: 500, blocked_by: [] },
    { issue_number: 501, blocked_by: [500] },
  ]);
  assert.deepEqual(out.goal_issue, {
    number: 2201,
    title: "Goal 2201",
  });
  assert.equal(out.goal_context && typeof out.goal_context, "object");
  assert.equal(Array.isArray(out.approved_features), true);
  assert.equal(out.approved_features.length, 2);
  assert.equal(out.materialization_state, "completed");
  assert.equal(out.already_completed, "false");
  assert.equal(out.awaiting_human_label_removed, "true");
  assert.equal(out.decomposition_packet_id && out.decomposition_packet_id.startsWith("goal_decomposition_packet_"), true);
  assert.equal(Boolean(out.decomposition_packet_path), true);
  assert.deepEqual(out.traceability_chain, {
    goal_issue_number: "2201",
    plan_packet_id: "plan-2201",
    decomposition_packet_id: out.decomposition_packet_id,
    issue_numbers: [500, 501],
  });

  assert.deepEqual(
    JSON.parse(blockedByCalls.find((entry) => Number(entry.issueNumber) === 501).blockedByRaw),
    [500],
  );

  assert.deepEqual(goalLabelEdits[0], [
    "issue",
    "edit",
    "2201",
    "--repo",
    "recallnet/astrochicken",
    "--remove-label",
    "awaiting-human",
  ]);

  const persisted = getLatestGoalHardPlanMaterializationPacket({
    repo: repoRoot,
    factoryId: "mothership",
    goalIssueNumber,
    planPacketId,
  });
  assert.ok(persisted?.packet);
  assert.equal(persisted.packet.materialization_state, "completed");
  assert.equal(persisted.packet.decomposition_packet_id, out.decomposition_packet_id);
  assert.equal(persisted.packet.decomposition_packet_path, out.decomposition_packet_path);

  const executionPath = readGoalExecutionPath({
    repo: repoRoot,
    goalIssueNumber,
    factoryId: "mothership",
  });
  assert.equal(executionPath.planning_state, "approved");
  assert.equal(executionPath.goal_routing_state.planning_artifact_path, planningArtifactPath);

  const packetOnDisk = JSON.parse(readFileSync(out.materialization_packet_path, "utf8"));
  assert.equal(packetOnDisk.plan_packet_id, planPacketId);
  assert.deepEqual(packetOnDisk.created_issue_numbers, [500, 501]);
  assert.equal(packetOnDisk.decomposition_packet_id, out.decomposition_packet_id);
  assert.equal(packetOnDisk.decomposition_packet_path, out.decomposition_packet_path);
});

test("materializeApprovedHardPlan is idempotent for existing plan packet", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "goal-hard-materialize-idempotent-"));
  const goalIssueNumber = "2202";
  const planPacketId = "plan-2202";

  seedExecutionPath({ repoRoot, goalIssueNumber });

  const planningArtifactPath = writePlanArtifact({
    dir: repoRoot,
    packetId: planPacketId,
    goalIssueNumber,
    approvedFeatures: [
      {
        feature_id: "F-1",
        name: "Materialize hard plan",
        summary: "Create deterministic issue.",
      },
    ],
    extra: { rationale_required: false },
  });

  markPlanningApproved({ repoRoot, goalIssueNumber, planningArtifactPath });

  let createCalls = 0;
  const labelEdits = [];
  const ghExecFn = (args) => {
    assert.equal(args[0], "issue");
    assert.equal(args[1], "edit");
    assert.ok(args.includes(goalIssueNumber));
    assert.ok(args.includes("--remove-label"));
    labelEdits.push(args);
    return { ok: true, stdout: "", stderr: "" };
  };

  const first = materializeApprovedHardPlan({
    repoRoot,
    repo: "recallnet/astrochicken",
    goalNumber: goalIssueNumber,
    planPacketId,
    planningArtifactPath,
    factoryId: "mothership",
    ghExecFn,
    createIssueFn: () => {
      createCalls += 1;
      return {
        ok: true,
        issue_url: "https://github.com/recallnet/astrochicken/issues/700",
        created_issue_number: "700",
      };
    },
    addSubIssueFn: () => ({ ok: true }),
    syncBlockedByFn: () => ({ synced: true, added: 0, removed: 0 }),
  });

  assert.equal(first.already_completed, "false");
  assert.equal(createCalls, 1);
  assert.equal(labelEdits.length, 1);
  assert.equal(first.awaiting_human_label_removed, "true");

  const second = materializeApprovedHardPlan({
    repoRoot,
    repo: "recallnet/astrochicken",
    goalNumber: goalIssueNumber,
    planPacketId,
    planningArtifactPath,
    factoryId: "mothership",
    createIssueFn: () => {
      createCalls += 1;
      return {
        ok: true,
        issue_url: "https://github.com/recallnet/astrochicken/issues/701",
        created_issue_number: "701",
      };
    },
    addSubIssueFn: () => ({ ok: true }),
    syncBlockedByFn: () => ({ synced: true, added: 0, removed: 0 }),
    ghExecFn: () => {
      throw new Error("replay_should_not_edit_labels");
    },
  });

  assert.equal(second.already_completed, "true");
  assert.equal(createCalls, 1, "second invocation must not create additional issues");
  assert.deepEqual(second.created_issue_numbers, [700]);
  assert.deepEqual(second.issue_set_map, {});
  assert.deepEqual(second.prerequisite_goal_issue_numbers, []);
  assert.equal(second.final_instantiation_goal_issue_number, null);
  assert.deepEqual(second.goal_feature_issue_map, {});
  assert.deepEqual(second.feature_materialization_markers, []);
  assert.equal(second.decomposition_packet_id && second.decomposition_packet_id.startsWith("goal_decomposition_packet_"), true);
  assert.equal(Boolean(second.decomposition_packet_path), true);
  assert.equal(second.awaiting_human_label_removed, "false");
  assert.match(String(second.awaiting_human_label_remove_error || ""), /replay_should_not_edit_labels/);
  assert.deepEqual(second.goal_issue, {
    number: 2202,
    title: "Goal 2202",
  });
  assert.equal(Array.isArray(second.approved_features), true);
  assert.equal(second.approved_features.length, 1);
  assert.deepEqual(second.traceability_chain, {
    goal_issue_number: "2202",
    plan_packet_id: "plan-2202",
    decomposition_packet_id: second.decomposition_packet_id,
    issue_numbers: [700],
  });
});

test("materializeApprovedHardPlan rejects non-approved planning artifacts", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "goal-hard-materialize-invalid-state-"));
  const goalIssueNumber = "2203";

  seedExecutionPath({ repoRoot, goalIssueNumber });

  const planningArtifactPath = writePlanArtifact({
    dir: repoRoot,
    packetId: "plan-2203",
    goalIssueNumber,
    planningState: "pending_review",
    approvedFeatures: [
      { feature_id: "F-1", name: "Feature 1", summary: "Summary" },
    ],
  });

  assert.throws(() => materializeApprovedHardPlan({
    repoRoot,
    repo: "recallnet/astrochicken",
    goalNumber: goalIssueNumber,
    planPacketId: "plan-2203",
    planningArtifactPath,
    factoryId: "mothership",
    createIssueFn: () => ({ ok: true }),
    addSubIssueFn: () => ({ ok: true }),
    syncBlockedByFn: () => ({ synced: true }),
  }), /planning_state_not_approved:pending_review/);
});

test("materializeApprovedHardPlan rejects unresolved feature dependency references", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "goal-hard-materialize-invalid-deps-"));
  const goalIssueNumber = "2204";

  seedExecutionPath({ repoRoot, goalIssueNumber });

  const planningArtifactPath = writePlanArtifact({
    dir: repoRoot,
    packetId: "plan-2204",
    goalIssueNumber,
    approvedFeatures: [
      {
        feature_id: "F-1",
        name: "Feature 1",
        summary: "Summary",
        dependencies: ["F-missing"],
      },
    ],
  });

  markPlanningApproved({ repoRoot, goalIssueNumber, planningArtifactPath });

  assert.throws(() => materializeApprovedHardPlan({
    repoRoot,
    repo: "recallnet/astrochicken",
    goalNumber: goalIssueNumber,
    planPacketId: "plan-2204",
    planningArtifactPath,
    factoryId: "mothership",
    createIssueFn: () => ({
      ok: true,
      issue_url: "https://github.com/recallnet/astrochicken/issues/901",
      created_issue_number: "901",
    }),
    addSubIssueFn: () => ({ ok: true }),
    syncBlockedByFn: () => ({ synced: true }),
  }), /unresolved_feature_dependency:F-1->F-missing/);
});

test("materializeApprovedHardPlan materializes prerequisite goal issue sets for factory_request plans", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "goal-hard-materialize-factory-request-prereqs-"));
  const goalIssueNumber = "2210";
  const planPacketId = "plan-2210";

  seedExecutionPath({ repoRoot, goalIssueNumber });

  const planningArtifactPath = writePlanArtifact({
    dir: repoRoot,
    packetId: planPacketId,
    goalIssueNumber,
    approvedFeatures: [
      {
        feature_id: "F-cap",
        name: "Capability prerequisite feature",
        summary: "Ship reusable capability surface.",
        issue_set_id: "set_capability",
        goal_id: "goal_capability",
      },
      {
        feature_id: "F-pol",
        name: "Policy prerequisite feature",
        summary: "Ship reusable policy profile.",
        issue_set_id: "set_policy",
        goal_id: "goal_policy",
      },
      {
        feature_id: "F-final",
        name: "Final instantiation wiring feature",
        summary: "Ship the thin-client factory wiring on shared capabilities.",
        issue_set_id: "set_final",
        goal_id: "goal_final",
      },
    ],
    extra: {
      rationale_required: false,
      goal_request_type: "factory_request",
      goal_context: {
        factory_request_goal_issue_numbers: {
          goal_capability: "7301",
          goal_policy: "7302",
          goal_final: "7303",
        },
      },
      factory_request_goal_graph: {
        schema_version: "factory_request_goal_graph/v1",
        goals: [
          {
            goal_id: "goal_capability",
            goal_kind: "prerequisite",
            title: "Capability prerequisite goal",
            issue_set_id: "set_capability",
            goal_issue_number: "7301",
          },
          {
            goal_id: "goal_policy",
            goal_kind: "prerequisite",
            title: "Policy prerequisite goal",
            issue_set_id: "set_policy",
            goal_issue_number: "7302",
          },
          {
            goal_id: "goal_final",
            goal_kind: "final_instantiation",
            title: "Final instantiation goal",
            issue_set_id: "set_final",
            goal_issue_number: "7303",
          },
        ],
        goal_edges: [
          { from_goal_id: "goal_capability", to_goal_id: "goal_final" },
          { from_goal_id: "goal_policy", to_goal_id: "goal_final" },
        ],
        goal_issue_sets: [
          {
            issue_set_id: "set_capability",
            title: "Capability set",
            goal_ids: ["goal_capability"],
            feature_ids: ["F-cap"],
          },
          {
            issue_set_id: "set_policy",
            title: "Policy set",
            goal_ids: ["goal_policy"],
            feature_ids: ["F-pol"],
          },
          {
            issue_set_id: "set_final",
            title: "Final set",
            goal_ids: ["goal_final"],
            feature_ids: ["F-final"],
          },
        ],
      },
    },
  });

  markPlanningApproved({ repoRoot, goalIssueNumber, planningArtifactPath });

  let nextIssue = 1200;
  const issueCreateCalls = [];
  const subIssueCalls = [];
  const syncCalls = [];

  const out = materializeApprovedHardPlan({
    repoRoot,
    repo: "recallnet/astrochicken",
    goalNumber: goalIssueNumber,
    planPacketId,
    planningArtifactPath,
    factoryId: "mothership",
    ghExecFn: (args) => {
      assert.deepEqual(args.slice(0, 5), ["issue", "edit", "2210", "--repo", "recallnet/astrochicken"]);
      assert.equal(args[5], "--remove-label");
      assert.match(args[6], /awaiting.human/);
      return successfulCommandResult();
    },
    createIssueFn: ({ issueSpecRaw }) => {
      const issueSpec = JSON.parse(issueSpecRaw);
      issueCreateCalls.push(issueSpec);
      const issueNumber = nextIssue;
      nextIssue += 1;
      return {
        ok: true,
        issue_url: `https://github.com/recallnet/astrochicken/issues/${issueNumber}`,
        created_issue_number: String(issueNumber),
      };
    },
    addSubIssueFn: ({ parentNumber, childNumber }) => {
      subIssueCalls.push({ parentNumber: String(parentNumber), childNumber: Number(childNumber) });
      return { ok: true };
    },
    syncBlockedByFn: ({ issueNumber, blockedByRaw }) => {
      syncCalls.push({ issueNumber: Number(issueNumber), blockedByRaw: JSON.parse(blockedByRaw) });
      return { synced: true, added: 0, removed: 0 };
    },
  });

  assert.equal(issueCreateCalls.length, 3);
  assert.deepEqual(subIssueCalls, [
    { parentNumber: "7301", childNumber: 1200 },
    { parentNumber: "7302", childNumber: 1201 },
    { parentNumber: "2210", childNumber: 1202 },
  ]);
  assert.deepEqual(out.factory_request_prerequisite_materialization, [
    {
      goal_id: "goal_capability",
      goal_issue_number: "7301",
      issue_set_id: "set_capability",
      feature_ids: ["F-cap"],
      created_issue_numbers: [1200],
    },
    {
      goal_id: "goal_policy",
      goal_issue_number: "7302",
      issue_set_id: "set_policy",
      feature_ids: ["F-pol"],
      created_issue_numbers: [1201],
    },
  ]);
  assert.deepEqual(out.feature_issue_map, [
    {
      feature_id: "F-cap",
      issue_number: 1200,
      issue_url: "https://github.com/recallnet/astrochicken/issues/1200",
      blocked_by_feature_ids: [],
      source_goal_id: "goal_capability",
      source_issue_set_id: "set_capability",
      parent_goal_issue_number: "7301",
    },
    {
      feature_id: "F-pol",
      issue_number: 1201,
      issue_url: "https://github.com/recallnet/astrochicken/issues/1201",
      blocked_by_feature_ids: [],
      source_goal_id: "goal_policy",
      source_issue_set_id: "set_policy",
      parent_goal_issue_number: "7302",
    },
    {
      feature_id: "F-final",
      issue_number: 1202,
      issue_url: "https://github.com/recallnet/astrochicken/issues/1202",
      blocked_by_feature_ids: [],
      source_goal_id: "goal_final",
      source_issue_set_id: "set_final",
      parent_goal_issue_number: "2210",
    },
  ]);
  assert.deepEqual(out.goal_issue_map, {
    goal_capability: "7301",
    goal_final: "2210",
    goal_policy: "7302",
  });
  assert.deepEqual(out.issue_set_map, {
    set_capability: {
      issue_set_id: "set_capability",
      title: "Capability set",
      goal_ids: ["goal_capability"],
      goal_issue_numbers: ["7301"],
      feature_ids: ["F-cap"],
      created_issue_numbers: [1200],
      created_issue_urls: ["https://github.com/recallnet/astrochicken/issues/1200"],
    },
    set_final: {
      issue_set_id: "set_final",
      title: "Final set",
      goal_ids: ["goal_final"],
      goal_issue_numbers: ["2210"],
      feature_ids: ["F-final"],
      created_issue_numbers: [1202],
      created_issue_urls: ["https://github.com/recallnet/astrochicken/issues/1202"],
    },
    set_policy: {
      issue_set_id: "set_policy",
      title: "Policy set",
      goal_ids: ["goal_policy"],
      goal_issue_numbers: ["7302"],
      feature_ids: ["F-pol"],
      created_issue_numbers: [1201],
      created_issue_urls: ["https://github.com/recallnet/astrochicken/issues/1201"],
    },
  });
  assert.deepEqual(out.prerequisite_goal_issue_numbers, [7301, 7302]);
  assert.equal(out.final_instantiation_goal_issue_number, 2210);
  assert.deepEqual(out.goal_feature_issue_map, {
    goal_capability: [{
      feature_id: "F-cap",
      issue_number: 1200,
      issue_url: "https://github.com/recallnet/astrochicken/issues/1200",
      issue_set_id: "set_capability",
      parent_goal_issue_number: "7301",
    }],
    goal_final: [{
      feature_id: "F-final",
      issue_number: 1202,
      issue_url: "https://github.com/recallnet/astrochicken/issues/1202",
      issue_set_id: "set_final",
      parent_goal_issue_number: "2210",
    }],
    goal_policy: [{
      feature_id: "F-pol",
      issue_number: 1201,
      issue_url: "https://github.com/recallnet/astrochicken/issues/1201",
      issue_set_id: "set_policy",
      parent_goal_issue_number: "7302",
    }],
  });
  assert.deepEqual(out.feature_materialization_markers, [
    "plan-2210::feature::F-cap",
    "plan-2210::feature::F-final",
    "plan-2210::feature::F-pol",
    "plan-2210::goal::goal_capability::feature::F-cap",
    "plan-2210::goal::goal_final::feature::F-final",
    "plan-2210::goal::goal_policy::feature::F-pol",
  ]);
  assert.deepEqual(out.goal_blocked_by_edges, [
    { issue_number: 2210, blocked_by: [7301, 7302] },
  ]);
  assert.deepEqual(syncCalls, [
    { issueNumber: 1200, blockedByRaw: [] },
    { issueNumber: 1201, blockedByRaw: [] },
    { issueNumber: 1202, blockedByRaw: [] },
    { issueNumber: 2210, blockedByRaw: [7301, 7302] },
  ]);

  const packetOnDisk = JSON.parse(readFileSync(out.materialization_packet_path, "utf8"));
  assert.deepEqual(packetOnDisk.factory_request_prerequisite_materialization, out.factory_request_prerequisite_materialization);
  assert.deepEqual(packetOnDisk.feature_issue_map.map((entry) => entry.source_issue_set_id), [
    "set_final",
    "set_capability",
    "set_policy",
  ]);
  assert.deepEqual(packetOnDisk.goal_issue_map, out.goal_issue_map);
  assert.deepEqual(packetOnDisk.issue_set_map, out.issue_set_map);
  assert.deepEqual(packetOnDisk.prerequisite_goal_issue_numbers, out.prerequisite_goal_issue_numbers);
  assert.equal(packetOnDisk.final_instantiation_goal_issue_number, out.final_instantiation_goal_issue_number);
  assert.deepEqual(packetOnDisk.goal_feature_issue_map, out.goal_feature_issue_map);
  assert.deepEqual(packetOnDisk.feature_materialization_markers, out.feature_materialization_markers);
  assert.deepEqual(packetOnDisk.goal_blocked_by_edges, out.goal_blocked_by_edges);

  const replay = materializeApprovedHardPlan({
    repoRoot,
    repo: "recallnet/astrochicken",
    goalNumber: goalIssueNumber,
    planPacketId,
    planningArtifactPath,
    factoryId: "mothership",
    createIssueFn: () => {
      throw new Error("replay_should_not_create_factory_request_prereq_issues");
    },
    addSubIssueFn: () => ({ ok: true }),
    syncBlockedByFn: () => ({ synced: true }),
  });

  assert.equal(replay.already_completed, "true");
  assert.deepEqual(replay.factory_request_prerequisite_materialization, out.factory_request_prerequisite_materialization);
  assert.deepEqual(replay.goal_issue_map, out.goal_issue_map);
  assert.deepEqual(replay.issue_set_map, out.issue_set_map);
  assert.deepEqual(replay.prerequisite_goal_issue_numbers, out.prerequisite_goal_issue_numbers);
  assert.equal(replay.final_instantiation_goal_issue_number, out.final_instantiation_goal_issue_number);
  assert.deepEqual(replay.goal_feature_issue_map, out.goal_feature_issue_map);
  assert.deepEqual(replay.feature_materialization_markers, out.feature_materialization_markers);
  assert.deepEqual(replay.goal_blocked_by_edges, out.goal_blocked_by_edges);
});

test("materializeApprovedHardPlan fails closed when goal edge issue mappings are missing", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "goal-hard-materialize-factory-request-missing-goal-map-"));
  const goalIssueNumber = "2212";
  const planPacketId = "plan-2212";

  seedExecutionPath({ repoRoot, goalIssueNumber });

  const planningArtifactPath = writePlanArtifact({
    dir: repoRoot,
    packetId: planPacketId,
    goalIssueNumber,
    approvedFeatures: [
      {
        feature_id: "F-cap",
        name: "Capability prerequisite feature",
        summary: "Ship reusable capability surface.",
        issue_set_id: "set_capability",
        goal_id: "goal_capability",
      },
    ],
    extra: {
      goal_request_type: "factory_request",
      goal_context: {
        factory_request_goal_issue_numbers: {
          goal_final: "7303",
        },
      },
      factory_request_goal_graph: {
        schema_version: "factory_request_goal_graph/v1",
        goals: [
          {
            goal_id: "goal_capability",
            goal_kind: "prerequisite",
            title: "Capability prerequisite goal",
            issue_set_id: "set_capability",
          },
          {
            goal_id: "goal_final",
            goal_kind: "final_instantiation",
            title: "Final instantiation goal",
            issue_set_id: "set_final",
          },
        ],
        goal_edges: [
          { from_goal_id: "goal_capability", to_goal_id: "goal_final" },
        ],
        goal_issue_sets: [
          {
            issue_set_id: "set_capability",
            title: "Capability set",
            goal_ids: ["goal_capability"],
            feature_ids: ["F-cap"],
          },
          {
            issue_set_id: "set_final",
            title: "Final set",
            goal_ids: ["goal_final"],
            feature_ids: [],
          },
        ],
      },
    },
  });

  markPlanningApproved({ repoRoot, goalIssueNumber, planningArtifactPath });

  assert.throws(() => materializeApprovedHardPlan({
    repoRoot,
    repo: "recallnet/astrochicken",
    goalNumber: goalIssueNumber,
    planPacketId,
    planningArtifactPath,
    factoryId: "mothership",
    createIssueFn: () => ({
      ok: true,
      issue_url: "https://github.com/recallnet/astrochicken/issues/1250",
      created_issue_number: "1250",
    }),
    addSubIssueFn: () => ({ ok: true }),
    syncBlockedByFn: () => ({ synced: true, added: 0, removed: 0 }),
  }), /missing_factory_request_goal_issue_number:goal_capability/);
});

test("materializeApprovedHardPlan fails closed when prerequisite issue set cannot be resolved", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "goal-hard-materialize-factory-request-missing-issueset-"));
  const goalIssueNumber = "2211";
  const planPacketId = "plan-2211";

  seedExecutionPath({ repoRoot, goalIssueNumber });

  const planningArtifactPath = writePlanArtifact({
    dir: repoRoot,
    packetId: planPacketId,
    goalIssueNumber,
    approvedFeatures: [
      {
        feature_id: "F-only",
        name: "Only policy feature",
        summary: "Feature does not map to capability issue set.",
        issue_set_id: "set_policy",
        goal_id: "goal_policy",
      },
    ],
    extra: {
      goal_request_type: "factory_request",
      goal_context: {
        factory_request_goal_issue_numbers: {
          goal_capability: "7401",
          goal_policy: "7402",
          goal_final: "7403",
        },
      },
      factory_request_goal_graph: {
        schema_version: "factory_request_goal_graph/v1",
        goals: [
          {
            goal_id: "goal_capability",
            goal_kind: "prerequisite",
            title: "Capability prerequisite goal",
            issue_set_id: "set_capability",
            goal_issue_number: "7401",
          },
          {
            goal_id: "goal_policy",
            goal_kind: "prerequisite",
            title: "Policy prerequisite goal",
            issue_set_id: "set_policy",
            goal_issue_number: "7402",
          },
          {
            goal_id: "goal_final",
            goal_kind: "final_instantiation",
            title: "Final instantiation goal",
            issue_set_id: "set_final",
            goal_issue_number: "7403",
          },
        ],
        goal_edges: [
          { from_goal_id: "goal_capability", to_goal_id: "goal_final" },
          { from_goal_id: "goal_policy", to_goal_id: "goal_final" },
        ],
        goal_issue_sets: [
          {
            issue_set_id: "set_capability",
            title: "Capability set",
            goal_ids: ["goal_capability"],
            feature_ids: ["F-missing"],
          },
          {
            issue_set_id: "set_policy",
            title: "Policy set",
            goal_ids: ["goal_policy"],
            feature_ids: ["F-only"],
          },
          {
            issue_set_id: "set_final",
            title: "Final set",
            goal_ids: ["goal_final"],
            feature_ids: [],
          },
        ],
      },
    },
  });

  markPlanningApproved({ repoRoot, goalIssueNumber, planningArtifactPath });

  assert.throws(() => materializeApprovedHardPlan({
    repoRoot,
    repo: "recallnet/astrochicken",
    goalNumber: goalIssueNumber,
    planPacketId,
    planningArtifactPath,
    factoryId: "mothership",
    createIssueFn: () => {
      throw new Error("should_not_create_issues_when_issue_set_missing");
    },
    addSubIssueFn: () => ({ ok: true }),
    syncBlockedByFn: () => ({ synced: true }),
  }), /unresolved_prerequisite_goal_issue_set:goal_capability:set_capability/);
});

test("materializeApprovedHardPlan resolves dependencies via shared triage helper before syncing", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "goal-hard-materialize-resolve-shared-"));
  const goalIssueNumber = "2205";

  seedExecutionPath({ repoRoot, goalIssueNumber });

  const planningArtifactPath = writePlanArtifact({
    dir: repoRoot,
    packetId: "plan-2205",
    goalIssueNumber,
    approvedFeatures: [
      {
        feature_id: "F-1",
        name: "Feature 1",
        summary: "Summary",
      },
      {
        feature_id: "F-2",
        name: "Feature 2",
        summary: "Summary",
        dependencies: ["F-1"],
      },
    ],
    extra: { rationale_required: false },
  });

  markPlanningApproved({ repoRoot, goalIssueNumber, planningArtifactPath });

  const resolveCalls = [];
  const syncCalls = [];

  const out = materializeApprovedHardPlan({
    repoRoot,
    repo: "recallnet/astrochicken",
    goalNumber: goalIssueNumber,
    planPacketId: "plan-2205",
    planningArtifactPath,
    factoryId: "mothership",
    ghExecFn: (args) => {
      assert.deepEqual(args.slice(0, 5), ["issue", "edit", "2205", "--repo", "recallnet/astrochicken"]);
      assert.equal(args[5], "--remove-label");
      assert.match(args[6], /awaiting.human/);
      return successfulCommandResult();
    },
    createIssueFn: ({ issueSpecRaw }) => {
      const spec = JSON.parse(issueSpecRaw);
      if (String(spec.issue_title).includes("Feature 1")) {
        return {
          ok: true,
          issue_url: "https://github.com/recallnet/astrochicken/issues/910",
          created_issue_number: "910",
        };
      }
      return {
        ok: true,
        issue_url: "https://github.com/recallnet/astrochicken/issues/911",
        created_issue_number: "911",
      };
    },
    addSubIssueFn: () => ({ ok: true }),
    syncBlockedByFn: ({ issueNumber, blockedByRaw }) => {
      syncCalls.push({ issueNumber: Number(issueNumber), blockedByRaw: JSON.parse(blockedByRaw) });
      return { synced: true, added: 1, removed: 0 };
    },
    resolveFeatureDependenciesFn: (args) => {
      resolveCalls.push(args);
      return resolveFeatureDependencies(args);
    },
  });

  assert.equal(resolveCalls.length, 1);
  assert.equal(resolveCalls[0].applySync, false);
  assert.equal(resolveCalls[0].failOnUnresolvedRefs, true);

  const mapped = JSON.parse(resolveCalls[0].featureIssueMapRaw);
  assert.deepEqual(mapped.map((entry) => entry.feature.id), ["F-1", "F-2"]);
  assert.deepEqual(mapped.map((entry) => Number(entry.issue_number)), [910, 911]);

  assert.deepEqual(syncCalls, [
    { issueNumber: 910, blockedByRaw: [] },
    { issueNumber: 911, blockedByRaw: [910] },
  ]);
  assert.deepEqual(out.blocked_by_edges, [
    { issue_number: 910, blocked_by: [] },
    { issue_number: 911, blocked_by: [910] },
  ]);
});
