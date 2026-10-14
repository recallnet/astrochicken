import { makeFinalInstantiationGoal, makePrerequisiteGoalA, makeReusableGapAnalysis } from "../helpers/ops-domain-fixtures.ts";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { HARD_PLAN_PACKET_SCHEMA_VERSION, HARD_PLAN_PACKET_TYPE, attachPlanningArtifacts, determineGoalRequestType, markGoalPlanned, persistHardPlanningArtifact, validatePlanningArtifact } from "../../src/commands/goal-hard-planning.ts";
import { classifyGoalExecutionPath, readGoalExecutionPath } from "../../src/commands/goal-execution-path.ts";
import { FACTORY_REQUEST_GOAL_GRAPH_SCHEMA_VERSION, buildFactoryRequestGoalGraph, normalizeFactoryRequestGoalGraph, parseOptionalObject as parseFactoryRequestGoalGraphObject } from "../../src/commands/goal-hard-planning-factory-request-goal-graph.ts";

test("factory-request goal-graph module exports deterministic schema constants and helpers", () => {
  assert.equal(FACTORY_REQUEST_GOAL_GRAPH_SCHEMA_VERSION, "factory_request_goal_graph/v1");

  const parsedObject = parseFactoryRequestGoalGraphObject(JSON.stringify({ goal_id: "g1" }));
  assert.equal(parsedObject.goal_id, "g1");

  const normalized = normalizeFactoryRequestGoalGraph({
    goals: [
      {
        goal_id: "prereq_1",
        goal_kind: "prerequisite",
        title: "Prereq",
        issue_set_id: "set_prereq",
      },
      {
        goal_id: "final_1",
        goal_kind: "final_instantiation",
        title: "Final",
        issue_set_id: "set_final",
      },
    ],
    goal_edges: [{ from_goal_id: "prereq_1", to_goal_id: "final_1" }],
  }, {
    approvedFeatures: [{ id: "F-1", goal_id: "prereq_1", issue_set_id: "set_prereq" }],
    normalizeTextList: (value) => Array.isArray(value) ? value : [value].filter(Boolean),
  });

  assert.equal(normalized.errors.length, 0);
  assert.equal(normalized.normalized.final_instantiation_goal.goal_id, "final_1");

  const built = buildFactoryRequestGoalGraph({
    goalContext: {},
    approvedFeatures: [
      {
        id: "F-1",
        factory_request_bucket: "reusable_capability_gaps",
      },
      {
        id: "F-2",
        factory_request_bucket: "reusable_policy_profile_gaps",
      },
    ],
    factoryRequestPlan: {
      reusable_capability_gaps: [{ feature_id: "F-1" }],
      reusable_policy_profile_gaps: [{ feature_id: "F-2" }],
      factory_instance_wiring: [],
      domain_specific_residues: [],
      raw_bucket_text: {
        reusable_capability_gaps: [],
        reusable_policy_profile_gaps: [],
        factory_instance_wiring: [],
        domain_specific_residues: [],
      },
      normalization_warnings: [],
    },
    normalizeFactoryRequestPlanShape: (value) => value,
    normalizeTextList: (value) => Array.isArray(value) ? value : [value].filter(Boolean),
  });

  assert.equal(built.schema_version, "factory_request_goal_graph/v1");
});

function seedExecutionPathPacket(repoRoot, goalIssueNumber = "2332") {
  classifyGoalExecutionPath({
    repo: repoRoot,
    goalIssueNumber,
    executionPath: "hard",
    routingContractVersion: "routing/v1",
    classificationVersion: "classifier/v1",
    decompositionState: "required",
    planningState: "not_required",
    classifiedBy: "goal_queue.classifier",
    classificationReason: "hard path target",
    classificationSignalsRaw: JSON.stringify({ test: true }),
    factoryId: "mothership",
  });
}

test("persistHardPlanningArtifact writes durable hard_plan_packet and validatePlanningArtifact accepts it", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "goal-hard-plan-"));

  const out = persistHardPlanningArtifact({
    repoRoot,
    goalIssueNumber: "2332",
    goalIssueRaw: JSON.stringify({ number: 2332, title: "Hard goal" }),
    goalContextRaw: JSON.stringify({ constraints: ["auditability"] }),
    approvedFeaturesRaw: JSON.stringify([{ name: "Artifact publication" }]),
    reviewNotes: "Need operator verification.",
    factoryId: "mothership",
    runId: "run-hard-1",
    pipeline: "goal_hard_plan",
    nodeId: "persist_hard_plan_packet",
    targetRepo: "recallnet/astrochicken",
    controlPlaneRepo: "recallnet/astrochicken",
  });

  assert.equal(Boolean(out.hard_plan_packet_path), true);
  assert.equal(Boolean(out.hard_plan_packet_id), true);
  assert.equal(out.hard_plan_packet_type, HARD_PLAN_PACKET_TYPE);
  assert.equal(out.hard_plan_packet_schema_version, HARD_PLAN_PACKET_SCHEMA_VERSION);

  const packet = JSON.parse(readFileSync(out.hard_plan_packet_path, "utf8"));
  assert.equal(packet.packet_type, HARD_PLAN_PACKET_TYPE);
  assert.equal(packet.schema_version, HARD_PLAN_PACKET_SCHEMA_VERSION);
  assert.equal(packet.goal_issue_number, "2332");
  assert.equal(packet.goal_request_type, "standard");
  assert.equal(packet.factory_request_plan, undefined);
  assert.equal(packet.run_id, "run-hard-1");
  assert.equal(packet.target_repo, "recallnet/astrochicken");
  assert.equal(out.goal_request_type, "standard");

  const validation = validatePlanningArtifact({ packetPath: out.hard_plan_packet_path });
  assert.equal(validation.planning_artifact_valid, "true");
  assert.equal(validation.planning_artifact_error, "");
  assert.equal(validation.goal_issue_number, "2332");
  assert.equal(validation.approved_feature_count, "1");
});

test("determineGoalRequestType honors explicit goal_context signal", () => {
  const goalRequestType = determineGoalRequestType(
    { title: "Refactor CLI wiring", body: "No factory setup requested." },
    { goal_request_type: "factory_request" },
  );
  assert.equal(goalRequestType, "factory_request");
});

test("persistHardPlanningArtifact classifies managed factory setup as factory_request without explicit signal and persists normalized factory_request_plan", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "goal-hard-plan-factory-request-"));

  const out = persistHardPlanningArtifact({
    repoRoot,
    goalIssueNumber: "2349",
    goalIssueRaw: JSON.stringify({
      number: 2349,
      title: "Stand up a new managed factory client for docs ops",
      body: "Need managed factory client wiring for a novel managed-client shape.",
    }),
    goalContextRaw: JSON.stringify({ constraints: ["reusable first"] }),
    approvedFeaturesRaw: JSON.stringify([
      {
        id: "F-1",
        name: "Build reusable capability contract",
        summary: "Add shared hard-path reusable capability primitives.",
        factory_request_bucket: "reusable_capability_gaps",
        factory_request_bucket_text: ["shared capability contract for new managed-factory classes"],
      },
      {
        id: "F-2",
        name: "Add policy/profile templates",
        summary: "Define reusable policy profile defaults.",
        factory_request_bucket: "reusable_policy_profile_gaps",
        factory_request_bucket_text: ["policy profile defaults for new managed factories"],
      },
      {
        id: "F-3",
        name: "Wire target factory instance",
        summary: "Connect target factory instance to reusable primitives.",
        factory_request_bucket: "factory_instance_wiring",
        factory_request_bucket_text: ["wire target factory to reusable capability + profile surfaces"],
      },
      {
        id: "F-4",
        name: "Document local residues",
        summary: "Track domain specific residues that remain local.",
        factory_request_bucket: "domain_specific_residues",
        factory_request_bucket_text: ["local domain residues requiring factory-local implementation"],
      },
    ]),
    reviewNotes: "Classify request type before downstream validation.",
    factoryId: "mothership",
    runId: "run-hard-factory-request",
    pipeline: "goal_hard_plan",
    nodeId: "persist_hard_plan_packet",
    targetRepo: "recallnet/astrochicken",
    controlPlaneRepo: "recallnet/astrochicken",
  });

  const packet = JSON.parse(readFileSync(out.hard_plan_packet_path, "utf8"));
  assert.equal(packet.goal_request_type, "factory_request");
  assert.equal(Array.isArray(packet.factory_request_plan.reusable_capability_gaps), true);
  assert.equal(Array.isArray(packet.factory_request_plan.reusable_policy_profile_gaps), true);
  assert.equal(Array.isArray(packet.factory_request_plan.factory_instance_wiring), true);
  assert.equal(Array.isArray(packet.factory_request_plan.domain_specific_residues), true);
  assert.equal(packet.factory_request_plan.reusable_capability_gaps.length, 1);
  assert.equal(packet.factory_request_plan.reusable_policy_profile_gaps.length, 1);
  assert.equal(packet.factory_request_plan.factory_instance_wiring.length, 1);
  assert.equal(packet.factory_request_plan.domain_specific_residues.length, 1);
  assert.equal(packet.factory_request_plan.raw_bucket_text.reusable_capability_gaps.includes(
    "shared capability contract for new managed-factory classes",
  ), true);
  assert.equal(packet.factory_request_goal_graph.schema_version, "factory_request_goal_graph/v1");
  assert.equal(packet.factory_request_goal_graph.final_instantiation_goal.goal_kind, "final_instantiation");
  assert.equal(packet.factory_request_goal_graph.prerequisite_goals.length, 2);
  assert.equal(packet.factory_request_goal_graph.goal_edges.length, 2);
  assert.equal(out.goal_request_type, "factory_request");

  const validation = validatePlanningArtifact({ packetPath: out.hard_plan_packet_path });
  assert.equal(validation.planning_artifact_valid, "true");
});

test("persistHardPlanningArtifact preserves explicit goal_request_type even when heuristics do not match", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "goal-hard-plan-explicit-request-"));

  const out = persistHardPlanningArtifact({
    repoRoot,
    goalIssueNumber: "2350",
    goalIssueRaw: JSON.stringify({
      number: 2350,
      title: "Refactor release note formatter",
      body: "No managed factory setup text present.",
    }),
    goalContextRaw: JSON.stringify({ goal_request_type: "factory_request" }),
    approvedFeaturesRaw: JSON.stringify([
      {
        id: "F-1",
        name: "Feature explicitly marked capability gap",
        summary: "Reusable capability work from explicit goal_context signal.",
        factory_request_bucket: "reusable_capability_gaps",
        factory_request_bucket_text: ["explicit reusable capability coverage"],
      },
      {
        id: "F-2",
        name: "Feature explicitly marked policy/profile gap",
        summary: "Reusable policy/profile work from explicit goal_context signal.",
        factory_request_bucket: "reusable_policy_profile_gaps",
        factory_request_bucket_text: ["explicit reusable policy profile coverage"],
      },
    ]),
    reviewNotes: "Use explicit goal context signal.",
    factoryId: "mothership",
    runId: "run-hard-explicit-request",
    pipeline: "goal_hard_plan",
    nodeId: "persist_hard_plan_packet",
    targetRepo: "recallnet/astrochicken",
    controlPlaneRepo: "recallnet/astrochicken",
  });

  const packet = JSON.parse(readFileSync(out.hard_plan_packet_path, "utf8"));
  assert.equal(packet.goal_request_type, "factory_request");
  assert.equal(Array.isArray(packet.factory_request_plan.reusable_capability_gaps), true);
  assert.equal(packet.factory_request_plan.reusable_capability_gaps.length, 1);
  assert.equal(Array.isArray(packet.factory_request_plan.reusable_policy_profile_gaps), true);
  assert.equal(packet.factory_request_plan.reusable_policy_profile_gaps.length, 1);
  assert.equal(packet.factory_request_goal_graph.schema_version, "factory_request_goal_graph/v1");
  assert.equal(packet.factory_request_goal_graph.final_instantiation_goal.goal_id, "final_factory_instantiation");
  assert.equal(out.goal_request_type, "factory_request");

  const validation = validatePlanningArtifact({ packetPath: out.hard_plan_packet_path });
  assert.equal(validation.planning_artifact_valid, "true");
});

test("validatePlanningArtifact fails closed with missing_reuse_buckets when factory_request reusable coverage is incomplete", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "goal-hard-plan-factory-request-missing-reuse-"));

  const out = persistHardPlanningArtifact({
    repoRoot,
    goalIssueNumber: "2351",
    goalIssueRaw: JSON.stringify({
      number: 2351,
      title: "Stand up a new managed factory client for support",
      body: "Factory request requiring reusable-first plan.",
    }),
    goalContextRaw: JSON.stringify({ goal_request_type: "factory_request" }),
    approvedFeaturesRaw: JSON.stringify([
      {
        id: "F-1",
        name: "Reusable capability only",
        summary: "Missing reusable policy/profile bucket coverage.",
        factory_request_bucket: "reusable_capability_gaps",
        factory_request_bucket_text: ["shared capability prerequisite"],
      },
    ]),
    reviewNotes: "Invalid factory-request plan missing reusable policy/profile bucket.",
    factoryId: "mothership",
    runId: "run-hard-invalid-factory-request-missing-reuse",
    pipeline: "goal_hard_plan",
    nodeId: "persist_hard_plan_packet",
    targetRepo: "recallnet/astrochicken",
    controlPlaneRepo: "recallnet/astrochicken",
  });

  assert.throws(
    () => validatePlanningArtifact({ packetPath: out.hard_plan_packet_path }),
    /invalid_planning_artifact:.*missing_reuse_buckets/,
  );
});

test("validatePlanningArtifact fails closed when ui-refinement metadata is missing", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "goal-hard-plan-factory-request-ui-refinement-missing-meta-"));

  const out = persistHardPlanningArtifact({
    repoRoot,
    goalIssueNumber: "2351",
    goalIssueRaw: JSON.stringify({
      number: 2351,
      title: "Stand up a new managed factory for UI refinement flow",
      body: "Factory request requiring reusable-first plan with UI refinement profile.",
    }),
    goalContextRaw: JSON.stringify({ goal_request_type: "factory_request" }),
    approvedFeaturesRaw: JSON.stringify([
      {
        id: "F-1",
        name: "Reusable capability surface",
        summary: "Shared capability prerequisite.",
        factory_request_bucket: "reusable_capability_gaps",
        factory_request_bucket_text: ["shared capability prerequisite"],
      },
      {
        id: "F-2",
        name: "Reusable UI refinement policy",
        summary: "Add ui-refinement required metadata contract.",
        factory_request_bucket: "reusable_policy_profile_gaps",
        factory_request_bucket_text: ["ui-refinement contract"],
        domain: "ui-refinement",
        visual_risk_class: "high",
        hotspot_files: ["App.tsx"],
        scope_limit_minutes: 45,
        refinement_strategy: "serialize hotspot edits",
      },
    ]),
    reviewNotes: "Invalid UI refinement feature missing scenario_sources.",
    factoryId: "mothership",
    runId: "run-hard-invalid-ui-refinement-meta",
    pipeline: "goal_hard_plan",
    nodeId: "persist_hard_plan_packet",
    targetRepo: "recallnet/astrochicken",
    controlPlaneRepo: "recallnet/astrochicken",
  });

  assert.throws(
    () => validatePlanningArtifact({ packetPath: out.hard_plan_packet_path }),
    /invalid_planning_artifact:.*ui_refinement_metadata_missing/,
  );
});

test("validatePlanningArtifact accepts factory_request plans with complete ui-refinement metadata", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "goal-hard-plan-factory-request-ui-refinement-valid-meta-"));

  const out = persistHardPlanningArtifact({
    repoRoot,
    goalIssueNumber: "2352",
    goalIssueRaw: JSON.stringify({
      number: 2352,
      title: "Stand up a new managed factory for UI refinement flow",
      body: "Factory request requiring reusable-first plan with UI refinement profile.",
    }),
    goalContextRaw: JSON.stringify({ goal_request_type: "factory_request" }),
    approvedFeaturesRaw: JSON.stringify([
      {
        id: "F-1",
        name: "Reusable capability surface",
        summary: "Shared capability prerequisite.",
        factory_request_bucket: "reusable_capability_gaps",
        factory_request_bucket_text: ["shared capability prerequisite"],
      },
      {
        id: "F-2",
        name: "Reusable UI refinement policy",
        summary: "Add ui-refinement required metadata contract.",
        factory_request_bucket: "reusable_policy_profile_gaps",
        factory_request_bucket_text: ["ui-refinement contract"],
        domain: "ui-refinement",
        visual_risk_class: "high",
        hotspot_files: ["App.tsx", "ConstellationView.tsx"],
        scope_limit_minutes: 45,
        refinement_strategy: "serialize hotspot edits",
        scenario_sources: ["factories/example-web/scenarios/example-web/interactions/pan-zoom.md"],
      },
    ]),
    reviewNotes: "Valid UI refinement feature metadata present.",
    factoryId: "mothership",
    runId: "run-hard-valid-ui-refinement-meta",
    pipeline: "goal_hard_plan",
    nodeId: "persist_hard_plan_packet",
    targetRepo: "recallnet/astrochicken",
    controlPlaneRepo: "recallnet/astrochicken",
  });

  const validation = validatePlanningArtifact({ packetPath: out.hard_plan_packet_path });
  assert.equal(validation.planning_artifact_valid, "true");
});

test("validatePlanningArtifact fails closed with bypassed_reuse_analysis when factory_request starts with bespoke wiring", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "goal-hard-plan-factory-request-bespoke-first-"));

  const out = persistHardPlanningArtifact({
    repoRoot,
    goalIssueNumber: "2352",
    goalIssueRaw: JSON.stringify({
      number: 2352,
      title: "Stand up a new managed factory client for support",
      body: "Factory request requiring reusable-first plan.",
    }),
    goalContextRaw: JSON.stringify({ goal_request_type: "factory_request" }),
    approvedFeaturesRaw: JSON.stringify([
      {
        id: "F-1",
        name: "Only instance wiring",
        summary: "Jump straight to instance wiring.",
        factory_request_bucket: "factory_instance_wiring",
        factory_request_bucket_text: ["wire target instance directly"],
      },
    ]),
    reviewNotes: "Invalid factory-request plan with bespoke-first wiring.",
    factoryId: "mothership",
    runId: "run-hard-invalid-factory-request-bespoke-first",
    pipeline: "goal_hard_plan",
    nodeId: "persist_hard_plan_packet",
    targetRepo: "recallnet/astrochicken",
    controlPlaneRepo: "recallnet/astrochicken",
  });

  assert.throws(
    () => validatePlanningArtifact({ packetPath: out.hard_plan_packet_path }),
    /invalid_planning_artifact:.*bypassed_reuse_analysis/,
  );
});

test("validatePlanningArtifact fails closed when factory_request approved_features omit bucket metadata", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "goal-hard-plan-factory-request-missing-bucket-meta-"));

  const out = persistHardPlanningArtifact({
    repoRoot,
    goalIssueNumber: "2352",
    goalIssueRaw: JSON.stringify({
      number: 2352,
      title: "New managed factory request",
      body: "Needs reusable capability and policy coverage.",
    }),
    goalContextRaw: JSON.stringify({ goal_request_type: "factory_request" }),
    approvedFeaturesRaw: JSON.stringify([
      {
        id: "F-1",
        name: "Capability gap without bucket metadata",
        summary: "Missing factory_request_bucket metadata intentionally.",
      },
      {
        id: "F-2",
        name: "Policy gap without bucket metadata",
        summary: "Missing bucket metadata intentionally.",
      },
    ]),
    reviewNotes: "Invalid factory-request plan missing bucket metadata.",
    factoryId: "mothership",
    runId: "run-hard-invalid-factory-request-bucket-meta",
    pipeline: "goal_hard_plan",
    nodeId: "persist_hard_plan_packet",
    targetRepo: "recallnet/astrochicken",
    controlPlaneRepo: "recallnet/astrochicken",
  });

  assert.throws(
    () => validatePlanningArtifact({ packetPath: out.hard_plan_packet_path }),
    /invalid_planning_artifact:.*factory_request_bucket_metadata_missing/,
  );
});

test("validatePlanningArtifact fails closed when factory_request goal graph is missing", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "goal-hard-plan-factory-request-missing-goal-graph-"));
  const artifactPath = join(repoRoot, "hard-plan-missing-goal-graph.json");
  writeFileSync(artifactPath, JSON.stringify({
    schema_version: HARD_PLAN_PACKET_SCHEMA_VERSION,
    packet_type: HARD_PLAN_PACKET_TYPE,
    packet_id: "hard_plan_packet_missing_goal_graph",
    goal_issue_number: "2390",
    handoff_owner: "goal.hard_plan_review",
    handoff_kind: "goal_hard_plan_review",
    inspection_commands: ["inspect"],
    execution_commands: ["execute"],
    verify_commands: ["verify"],
    expected_outcomes: ["outcome"],
    resource_refs: { goal_issue_number: "2390" },
    preserve_work: { preserve_work_required: true },
    goal_request_type: "factory_request",
    approved_features: [
      {
        id: "F-1",
        name: "Reusable capability",
        factory_request_bucket: "reusable_capability_gaps",
      },
      {
        id: "F-2",
        name: "Reusable policy/profile",
        factory_request_bucket: "reusable_policy_profile_gaps",
      },
    ],
    factory_request_plan: makeReusableGapAnalysis(),
  }, null, 2));

  assert.throws(
    () => validatePlanningArtifact({ packetPath: artifactPath }),
    /invalid_planning_artifact:.*missing_factory_request_goal_graph/,
  );
});

test("validatePlanningArtifact fails closed when factory_request goal graph edges reference unknown goals", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "goal-hard-plan-factory-request-goal-graph-bad-edge-"));
  const artifactPath = join(repoRoot, "hard-plan-bad-goal-graph-edge.json");
  writeFileSync(artifactPath, JSON.stringify({
    schema_version: HARD_PLAN_PACKET_SCHEMA_VERSION,
    packet_type: HARD_PLAN_PACKET_TYPE,
    packet_id: "hard_plan_packet_bad_goal_graph_edge",
    goal_issue_number: "2391",
    handoff_owner: "goal.hard_plan_review",
    handoff_kind: "goal_hard_plan_review",
    inspection_commands: ["inspect"],
    execution_commands: ["execute"],
    verify_commands: ["verify"],
    expected_outcomes: ["outcome"],
    resource_refs: { goal_issue_number: "2391" },
    preserve_work: { preserve_work_required: true },
    goal_request_type: "factory_request",
    approved_features: [
      {
        id: "F-1",
        name: "Reusable capability",
        factory_request_bucket: "reusable_capability_gaps",
      },
      {
        id: "F-2",
        name: "Reusable policy/profile",
        factory_request_bucket: "reusable_policy_profile_gaps",
      },
    ],
    factory_request_plan: makeReusableGapAnalysis(),
    factory_request_goal_graph: {
      schema_version: "factory_request_goal_graph/v1",
      prerequisite_goals: [
        makePrerequisiteGoalA(),
      ],
      final_instantiation_goal: makeFinalInstantiationGoal(),
      goal_edges: [
        {
          from_goal_id: "prereq_a",
          to_goal_id: "missing_goal",
        },
      ],
      goal_issue_sets: [
        {
          issue_set_id: "set_prereq_a",
          title: "Prereq set",
          goal_ids: ["prereq_a"],
          feature_ids: ["F-1"],
        },
        {
          issue_set_id: "set_final",
          title: "Final set",
          goal_ids: ["final_inst"],
          feature_ids: ["F-2"],
        },
      ],
    },
  }, null, 2));

  assert.throws(
    () => validatePlanningArtifact({ packetPath: artifactPath }),
    /invalid_planning_artifact:.*factory_request_goal_graph_unknown_goal_edge_reference:prereq_a->missing_goal/,
  );
});

test("validatePlanningArtifact fails closed when factory_request goal graph contains a self-edge", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "goal-hard-plan-factory-request-goal-graph-self-edge-"));
  const artifactPath = join(repoRoot, "hard-plan-goal-graph-self-edge.json");
  writeFileSync(artifactPath, JSON.stringify({
    schema_version: HARD_PLAN_PACKET_SCHEMA_VERSION,
    packet_type: HARD_PLAN_PACKET_TYPE,
    packet_id: "hard_plan_packet_goal_graph_self_edge",
    goal_issue_number: "2392",
    handoff_owner: "goal.hard_plan_review",
    handoff_kind: "goal_hard_plan_review",
    inspection_commands: ["inspect"],
    execution_commands: ["execute"],
    verify_commands: ["verify"],
    expected_outcomes: ["outcome"],
    resource_refs: { goal_issue_number: "2392" },
    preserve_work: { preserve_work_required: true },
    goal_request_type: "factory_request",
    approved_features: [
      {
        id: "F-1",
        name: "Reusable capability",
        factory_request_bucket: "reusable_capability_gaps",
      },
      {
        id: "F-2",
        name: "Reusable policy/profile",
        factory_request_bucket: "reusable_policy_profile_gaps",
      },
    ],
    factory_request_plan: makeReusableGapAnalysis(),
    factory_request_goal_graph: {
      schema_version: "factory_request_goal_graph/v1",
      prerequisite_goals: [
        makePrerequisiteGoalA(),
      ],
      final_instantiation_goal: makeFinalInstantiationGoal(),
      goal_edges: [
        {
          from_goal_id: "prereq_a",
          to_goal_id: "prereq_a",
        },
      ],
      goal_issue_sets: [
        {
          issue_set_id: "set_prereq_a",
          title: "Prereq set",
          goal_ids: ["prereq_a"],
          feature_ids: ["F-1"],
        },
        {
          issue_set_id: "set_final",
          title: "Final set",
          goal_ids: ["final_inst"],
          feature_ids: ["F-2"],
        },
      ],
    },
  }, null, 2));

  assert.throws(
    () => validatePlanningArtifact({ packetPath: artifactPath }),
    /invalid_planning_artifact:.*factory_request_goal_graph_self_goal_edge:prereq_a/,
  );
});

test("validatePlanningArtifact fails closed when final goal has outgoing edges", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "goal-hard-plan-factory-request-goal-graph-invalid-final-edge-"));
  const artifactPath = join(repoRoot, "hard-plan-goal-graph-invalid-final-edge.json");
  writeFileSync(artifactPath, JSON.stringify({
    schema_version: HARD_PLAN_PACKET_SCHEMA_VERSION,
    packet_type: HARD_PLAN_PACKET_TYPE,
    packet_id: "hard_plan_packet_goal_graph_invalid_final_edge",
    goal_issue_number: "2393",
    handoff_owner: "goal.hard_plan_review",
    handoff_kind: "goal_hard_plan_review",
    inspection_commands: ["inspect"],
    execution_commands: ["execute"],
    verify_commands: ["verify"],
    expected_outcomes: ["outcome"],
    resource_refs: { goal_issue_number: "2393" },
    preserve_work: { preserve_work_required: true },
    goal_request_type: "factory_request",
    approved_features: [
      {
        id: "F-1",
        name: "Reusable capability",
        factory_request_bucket: "reusable_capability_gaps",
      },
      {
        id: "F-2",
        name: "Reusable policy/profile",
        factory_request_bucket: "reusable_policy_profile_gaps",
      },
    ],
    factory_request_plan: makeReusableGapAnalysis(),
    factory_request_goal_graph: {
      schema_version: "factory_request_goal_graph/v1",
      prerequisite_goals: [
        makePrerequisiteGoalA(),
      ],
      final_instantiation_goal: makeFinalInstantiationGoal(),
      goal_edges: [
        {
          from_goal_id: "final_inst",
          to_goal_id: "prereq_a",
        },
      ],
      goal_issue_sets: [
        {
          issue_set_id: "set_prereq_a",
          title: "Prereq set",
          goal_ids: ["prereq_a"],
          feature_ids: ["F-1"],
        },
        {
          issue_set_id: "set_final",
          title: "Final set",
          goal_ids: ["final_inst"],
          feature_ids: ["F-2"],
        },
      ],
    },
  }, null, 2));

  assert.throws(
    () => validatePlanningArtifact({ packetPath: artifactPath }),
    /invalid_planning_artifact:.*factory_request_goal_graph_invalid_final_outgoing_edge:final_inst->prereq_a/,
  );
});

test("validatePlanningArtifact fails closed when factory_request goal graph omits final instantiation goal", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "goal-hard-plan-factory-request-goal-graph-missing-final-"));
  const artifactPath = join(repoRoot, "hard-plan-goal-graph-missing-final.json");
  writeFileSync(artifactPath, JSON.stringify({
    schema_version: HARD_PLAN_PACKET_SCHEMA_VERSION,
    packet_type: HARD_PLAN_PACKET_TYPE,
    packet_id: "hard_plan_packet_missing_final_goal",
    goal_issue_number: "2392",
    handoff_owner: "goal.hard_plan_review",
    handoff_kind: "goal_hard_plan_review",
    inspection_commands: ["inspect"],
    execution_commands: ["execute"],
    verify_commands: ["verify"],
    expected_outcomes: ["outcome"],
    resource_refs: { goal_issue_number: "2392" },
    preserve_work: { preserve_work_required: true },
    goal_request_type: "factory_request",
    approved_features: [
      {
        id: "F-1",
        name: "Reusable capability",
        factory_request_bucket: "reusable_capability_gaps",
      },
      {
        id: "F-2",
        name: "Reusable policy/profile",
        factory_request_bucket: "reusable_policy_profile_gaps",
      },
    ],
    factory_request_plan: makeReusableGapAnalysis(),
    factory_request_goal_graph: {
      schema_version: "factory_request_goal_graph/v1",
      prerequisite_goals: [
        makePrerequisiteGoalA(),
      ],
      goal_edges: [],
      goal_issue_sets: [
        {
          issue_set_id: "set_prereq_a",
          title: "Prereq set",
          goal_ids: ["prereq_a"],
          feature_ids: ["F-1", "F-2"],
        },
      ],
    },
  }, null, 2));

  assert.throws(
    () => validatePlanningArtifact({ packetPath: artifactPath }),
    /invalid_planning_artifact:.*factory_request_goal_graph_final_instantiation_goal_count:0/,
  );
});

test("validatePlanningArtifact fails closed when factory_request goal graph introduces a cycle", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "goal-hard-plan-factory-request-goal-graph-cycle-"));
  const artifactPath = join(repoRoot, "hard-plan-goal-graph-cycle.json");
  writeFileSync(artifactPath, JSON.stringify({
    schema_version: HARD_PLAN_PACKET_SCHEMA_VERSION,
    packet_type: HARD_PLAN_PACKET_TYPE,
    packet_id: "hard_plan_packet_goal_graph_cycle",
    goal_issue_number: "2393",
    handoff_owner: "goal.hard_plan_review",
    handoff_kind: "goal_hard_plan_review",
    inspection_commands: ["inspect"],
    execution_commands: ["execute"],
    verify_commands: ["verify"],
    expected_outcomes: ["outcome"],
    resource_refs: { goal_issue_number: "2393" },
    preserve_work: { preserve_work_required: true },
    goal_request_type: "factory_request",
    approved_features: [
      {
        id: "F-1",
        name: "Reusable capability",
        factory_request_bucket: "reusable_capability_gaps",
      },
      {
        id: "F-2",
        name: "Reusable policy/profile",
        factory_request_bucket: "reusable_policy_profile_gaps",
      },
    ],
    factory_request_plan: makeReusableGapAnalysis(),
    factory_request_goal_graph: {
      schema_version: "factory_request_goal_graph/v1",
      prerequisite_goals: [
        makePrerequisiteGoalA(),
      ],
      final_instantiation_goal: makeFinalInstantiationGoal(),
      goal_edges: [
        {
          from_goal_id: "prereq_a",
          to_goal_id: "final_inst",
        },
        {
          from_goal_id: "final_inst",
          to_goal_id: "prereq_a",
        },
      ],
      goal_issue_sets: [
        {
          issue_set_id: "set_prereq_a",
          title: "Prereq set",
          goal_ids: ["prereq_a"],
          feature_ids: ["F-1"],
        },
        {
          issue_set_id: "set_final",
          title: "Final set",
          goal_ids: ["final_inst"],
          feature_ids: ["F-2"],
        },
      ],
    },
  }, null, 2));

  assert.throws(
    () => validatePlanningArtifact({ packetPath: artifactPath }),
    /invalid_planning_artifact:.*factory_request_goal_graph_goal_graph_cycle_detected/,
  );
});

test("validatePlanningArtifact fails closed when approved_features are missing", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "goal-hard-plan-invalid-"));
  const artifactPath = join(repoRoot, "bad-hard-plan.json");
  writeFileSync(artifactPath, JSON.stringify({
    schema_version: HARD_PLAN_PACKET_SCHEMA_VERSION,
    packet_type: HARD_PLAN_PACKET_TYPE,
    packet_id: "hard_plan_packet_bad",
    goal_issue_number: "2332",
    approved_features: [],
  }, null, 2));

  assert.throws(
    () => validatePlanningArtifact({ packetPath: artifactPath }),
    /invalid_planning_artifact:.*approved_features_empty/,
  );
});

test("attachPlanningArtifacts emits reusable-vs-instantiation summary for factory_request packets", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "goal-hard-plan-attach-factory-request-"));

  const persisted = persistHardPlanningArtifact({
    repoRoot,
    goalIssueNumber: "2332",
    goalIssueRaw: JSON.stringify({
      number: 2332,
      title: "Stand up a new managed factory client for ops",
      body: "Managed factory request requiring reusable-first decomposition.",
    }),
    goalContextRaw: JSON.stringify({ goal_request_type: "factory_request" }),
    approvedFeaturesRaw: JSON.stringify([
      {
        id: "F-1",
        name: "Shared capability contract",
        summary: "Create reusable platform capability surface.",
        factory_request_bucket: "reusable_capability_gaps",
        factory_request_bucket_text: ["shared capability surface"],
      },
      {
        id: "F-2",
        name: "Shared policy profile",
        summary: "Create reusable policy/profile defaults.",
        factory_request_bucket: "reusable_policy_profile_gaps",
        factory_request_bucket_text: ["shared policy profile defaults"],
      },
      {
        id: "F-3",
        name: "Wire target instance",
        summary: "Connect target client to shared primitives.",
        factory_request_bucket: "factory_instance_wiring",
        factory_request_bucket_text: ["wire target instance to shared surfaces"],
      },
      {
        id: "F-4",
        name: "Capture domain residue",
        summary: "Local residue that stays factory-specific.",
        factory_request_bucket: "domain_specific_residues",
        factory_request_bucket_text: ["domain residue remains local"],
      },
    ]),
    reviewNotes: "Attach summary should separate reusable and instantiation work.",
    factoryId: "mothership",
    runId: "run-hard-attach-summary",
    pipeline: "goal_hard_plan",
    nodeId: "persist_hard_plan_packet",
    targetRepo: "recallnet/astrochicken",
    controlPlaneRepo: "recallnet/astrochicken",
  });

  const calls = [];
  const ghJsonFn = (args, fallback) => {
    calls.push({ type: "json", args });
    if (args[0] === "issue" && args[1] === "view") {
      return { comments: [] };
    }
    return fallback;
  };
  const ghExec = (args) => {
    calls.push({ type: "exec", args });
    return { ok: true, stdout: "", stderr: "" };
  };

  const out = attachPlanningArtifacts({
    repo: "recallnet/astrochicken",
    goalIssueNumber: "2332",
    planningArtifactPath: persisted.hard_plan_packet_path,
    planningPacketId: persisted.hard_plan_packet_id,
    runId: "run-hard-attach-summary",
    summary: "hard_path_planning_completed",
    ghJsonFn,
    ghExec,
  });

  assert.equal(out.planning_attachment_posted, "true");

  const commentCall = calls.find((entry) =>
    entry.type === "exec"
      && entry.args[0] === "issue"
      && entry.args[1] === "comment"
  );
  assert.ok(commentCall, "must post planning artifact comment");

  const body = String(commentCall.args[6] || "");
  assert.match(body, /### Reusable platform work/);
  assert.match(body, /### Target factory instantiation/);
  assert.match(body, /### Prerequisite goal graph/);
  assert.match(body, /\*\*Goal order \(topological\)\*\*/);
  assert.match(body, /shared capability surface/);
  assert.match(body, /wire target instance to shared surfaces/);
  assert.match(body, /\*\*Final goal callout\*\*/);
  assert.match(body, /final_factory_instantiation/);
  assert.match(body, /prerequisite_reusable_capability_gaps → final_factory_instantiation/);
});

test("attachPlanningArtifacts posts through the mutation path even when marker comments already exist", () => {
  const calls = [];
  const ghExec = (args) => {
    calls.push({ type: "exec", args });
    return { ok: true, stdout: "", stderr: "" };
  };

  const out = attachPlanningArtifacts({
    repo: "recallnet/astrochicken",
    goalIssueNumber: "2332",
    planningArtifactPath: "/tmp/hard_plan.json",
    planningPacketId: "hard_plan_packet_abc",
    runId: "run-hard-2",
    summary: "hard_path_planning_completed",
    ghExec,
  });

  assert.equal(out.planning_attachment_posted, "true");
  assert.equal(calls.filter((entry) => entry.type === "json").length, 0);
  assert.equal(calls.filter((entry) => entry.type === "exec").length, 1);
});

test("markGoalPlanned removes ready, posts hold comment once, and transitions planning_state to pending_review", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "goal-hard-plan-mark-"));
  seedExecutionPathPacket(repoRoot, "2332");

  const ghCalls = [];
  const ghExec = (args) => {
    ghCalls.push({ type: "exec", args });
    return { ok: true, stdout: "", stderr: "" };
  };

  const first = markGoalPlanned({
    repoRoot,
    repo: "recallnet/astrochicken",
    goalIssueNumber: "2332",
    goalExecutionPath: "hard",
    goalRoutingStateRaw: JSON.stringify({ decomposition_state: "required", planning_state: "not_required" }),
    planningArtifactPath: "/tmp/hard_plan_packet.json",
    factoryId: "mothership",
    runId: "run-hard-3",
    pipeline: "goal_hard_plan",
    nodeId: "mark_hard_plan_pending_review",
    targetRepo: "recallnet/astrochicken",
    controlPlaneRepo: "recallnet/astrochicken",
    ghExec,
  });

  assert.equal(first.goal_execution_path, "hard");
  assert.equal(first.planning_state, "pending_review");
  assert.equal(first.goal_routing_state.planning_state, "pending_review");
  assert.equal(first.planning_artifact_path, "/tmp/hard_plan_packet.json");
  assert.equal(first.ready_label_removed, "true");
  assert.equal(first.ready_removed_comment_posted, "true");

  const persisted = readGoalExecutionPath({
    repo: repoRoot,
    goalIssueNumber: "2332",
    factoryId: "mothership",
  });
  assert.equal(persisted.planning_state, "pending_review");
  assert.equal(persisted.goal_routing_state.planning_artifact_path, "/tmp/hard_plan_packet.json");

  const postedComments = ghCalls.filter((entry) =>
    entry.type === "exec"
      && entry.args[0] === "issue"
      && entry.args[1] === "comment"
  );
  assert.equal(postedComments.length >= 1, true);
});
