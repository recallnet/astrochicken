import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildGoalHardPlanMaterializationPacket,
  getLatestGoalHardPlanMaterializationPacket,
  persistGoalHardPlanMaterializationPacket,
  validateGoalHardPlanMaterializationPacket,
} from "../../src/lib/goal-hard-plan-materialization-packet.ts";

test("goal hard-plan materialization packet builds deterministic durable contract", () => {
  const packet = buildGoalHardPlanMaterializationPacket({
    goalIssueNumber: "2201",
    planPacketId: "plan-2201",
    planningArtifactPath: ".hatch/mothership/packets/hard_plan_packet/plan-2201.json",
    decompositionPacketId: "goal_decomposition_packet_2201",
    decompositionPacketPath: ".hatch/mothership/packets/goal_decomposition_packet/goal-2201.json",
    approvedFeatureIds: ["F-1", "F-2"],
    approvedFeatures: [{ feature_id: "F-1" }, { feature_id: "F-2" }],
    createdIssueNumbers: [801, 802],
    createdIssueUrls: [
      "https://github.com/recallnet/astrochicken/issues/801",
      "https://github.com/recallnet/astrochicken/issues/802",
    ],
    featureIssueMap: [
      { feature_id: "F-1", issue_number: 801, issue_url: "https://github.com/recallnet/astrochicken/issues/801" },
      { feature_id: "F-2", issue_number: 802, issue_url: "https://github.com/recallnet/astrochicken/issues/802", blocked_by_feature_ids: ["F-1"] },
    ],
    blockedByEdges: [
      { issue_number: 801, blocked_by: [] },
      { issue_number: 802, blocked_by: [801] },
    ],
    goalBlockedByEdges: [
      { issue_number: 900, blocked_by: [801, 802] },
    ],
    goalIssueMap: {
      goal_capability: "801",
      goal_policy: "802",
      goal_final: "900",
    },
    factoryId: "mothership",
  });

  const validation = validateGoalHardPlanMaterializationPacket(packet);
  assert.equal(validation.ok, true, validation.errors.join(","));
  assert.equal(packet.packet_type, "goal_hard_plan_materialization_packet");
  assert.equal(packet.schema_version, "goal_hard_plan_materialization_packet/v1");
  assert.equal(packet.handoff_kind, "goal_hard_plan_materialization");
  assert.equal(packet.materialization_state, "completed");
  assert.deepEqual(packet.goal_issue_map, {
    goal_capability: "801",
    goal_final: "900",
    goal_policy: "802",
  });
  assert.deepEqual(packet.goal_blocked_by_edges, [
    { issue_number: 900, blocked_by: [801, 802] },
  ]);
  assert.deepEqual(packet.issue_set_map, {});
  assert.deepEqual(packet.prerequisite_goal_issue_numbers, []);
  assert.equal(packet.final_instantiation_goal_issue_number, null);
  assert.deepEqual(packet.goal_feature_issue_map, {});
  assert.deepEqual(packet.feature_materialization_markers, []);
});

test("goal hard-plan materialization packet preserves prerequisite provenance rows", () => {
  const packet = buildGoalHardPlanMaterializationPacket({
    goalIssueNumber: "2201",
    planPacketId: "plan-2201",
    planningArtifactPath: "plan-2201.json",
    decompositionPacketId: "goal_decomposition_packet_2201",
    decompositionPacketPath: ".hatch/mothership/packets/goal_decomposition_packet/goal-2201.json",
    approvedFeatureIds: ["F-cap", "F-pol"],
    approvedFeatures: [{ feature_id: "F-cap" }, { feature_id: "F-pol" }],
    createdIssueNumbers: [910, 911],
    createdIssueUrls: [
      "https://github.com/recallnet/astrochicken/issues/910",
      "https://github.com/recallnet/astrochicken/issues/911",
    ],
    featureIssueMap: [
      {
        feature_id: "F-pol",
        issue_number: 911,
        issue_url: "https://github.com/recallnet/astrochicken/issues/911",
        source_goal_id: "goal_policy",
        source_issue_set_id: "set_policy",
        parent_goal_issue_number: "7302",
      },
      {
        feature_id: "F-cap",
        issue_number: 910,
        issue_url: "https://github.com/recallnet/astrochicken/issues/910",
        source_goal_id: "goal_capability",
        source_issue_set_id: "set_capability",
        parent_goal_issue_number: "7301",
      },
    ],
    blockedByEdges: [
      { issue_number: 910, blocked_by: [] },
      { issue_number: 911, blocked_by: [910] },
    ],
    issueSetMap: {
      set_policy: {
        issue_set_id: "set_policy",
        title: "Policy set",
        goal_ids: ["goal_policy"],
        goal_issue_numbers: ["7302"],
        feature_ids: ["F-pol"],
        created_issue_numbers: [911],
        created_issue_urls: ["https://github.com/recallnet/astrochicken/issues/911"],
      },
      set_capability: {
        issue_set_id: "set_capability",
        title: "Capability set",
        goal_ids: ["goal_capability"],
        goal_issue_numbers: ["7301"],
        feature_ids: ["F-cap"],
        created_issue_numbers: [910],
        created_issue_urls: ["https://github.com/recallnet/astrochicken/issues/910"],
      },
      set_final: {
        issue_set_id: "set_final",
        title: "Final set",
        goal_ids: ["goal_final"],
        goal_issue_numbers: ["2201"],
        feature_ids: [],
        created_issue_numbers: [],
        created_issue_urls: [],
      },
    },
    prerequisiteGoalIssueNumbers: [7302, 7301],
    finalInstantiationGoalIssueNumber: 2201,
    goalFeatureIssueMap: {
      goal_policy: [{
        feature_id: "F-pol",
        issue_number: 911,
        issue_url: "https://github.com/recallnet/astrochicken/issues/911",
        issue_set_id: "set_policy",
        parent_goal_issue_number: "7302",
      }],
      goal_capability: [{
        feature_id: "F-cap",
        issue_number: 910,
        issue_url: "https://github.com/recallnet/astrochicken/issues/910",
        issue_set_id: "set_capability",
        parent_goal_issue_number: "7301",
      }],
    },
    featureMaterializationMarkers: [
      "plan-2201::goal::goal_policy::feature::F-pol",
      "plan-2201::feature::F-pol",
      "plan-2201::goal::goal_capability::feature::F-cap",
      "plan-2201::feature::F-cap",
    ],
    factoryRequestPrerequisiteMaterialization: [
      {
        goal_id: "goal_policy",
        goal_issue_number: "7302",
        issue_set_id: "set_policy",
        feature_ids: ["F-pol"],
        created_issue_numbers: [911],
      },
      {
        goal_id: "goal_capability",
        goal_issue_number: "7301",
        issue_set_id: "set_capability",
        feature_ids: ["F-cap"],
        created_issue_numbers: [910],
      },
    ],
    factoryId: "mothership",
  });

  assert.deepEqual(packet.factory_request_prerequisite_materialization, [
    {
      goal_id: "goal_capability",
      goal_issue_number: "7301",
      issue_set_id: "set_capability",
      feature_ids: ["F-cap"],
      created_issue_numbers: [910],
    },
    {
      goal_id: "goal_policy",
      goal_issue_number: "7302",
      issue_set_id: "set_policy",
      feature_ids: ["F-pol"],
      created_issue_numbers: [911],
    },
  ]);

  assert.deepEqual(packet.feature_issue_map, [
    {
      feature_id: "F-cap",
      issue_number: 910,
      issue_url: "https://github.com/recallnet/astrochicken/issues/910",
      blocked_by_feature_ids: [],
      source_goal_id: "goal_capability",
      source_issue_set_id: "set_capability",
      parent_goal_issue_number: "7301",
    },
    {
      feature_id: "F-pol",
      issue_number: 911,
      issue_url: "https://github.com/recallnet/astrochicken/issues/911",
      blocked_by_feature_ids: [],
      source_goal_id: "goal_policy",
      source_issue_set_id: "set_policy",
      parent_goal_issue_number: "7302",
    },
  ]);

  assert.deepEqual(packet.issue_set_map, {
    set_capability: {
      issue_set_id: "set_capability",
      title: "Capability set",
      goal_ids: ["goal_capability"],
      goal_issue_numbers: ["7301"],
      feature_ids: ["F-cap"],
      created_issue_numbers: [910],
      created_issue_urls: ["https://github.com/recallnet/astrochicken/issues/910"],
    },
    set_final: {
      issue_set_id: "set_final",
      title: "Final set",
      goal_ids: ["goal_final"],
      goal_issue_numbers: ["2201"],
      feature_ids: [],
      created_issue_numbers: [],
      created_issue_urls: [],
    },
    set_policy: {
      issue_set_id: "set_policy",
      title: "Policy set",
      goal_ids: ["goal_policy"],
      goal_issue_numbers: ["7302"],
      feature_ids: ["F-pol"],
      created_issue_numbers: [911],
      created_issue_urls: ["https://github.com/recallnet/astrochicken/issues/911"],
    },
  });
  assert.deepEqual(packet.prerequisite_goal_issue_numbers, [7301, 7302]);
  assert.equal(packet.final_instantiation_goal_issue_number, 2201);
  assert.deepEqual(packet.goal_feature_issue_map, {
    goal_capability: [{
      feature_id: "F-cap",
      issue_number: 910,
      issue_url: "https://github.com/recallnet/astrochicken/issues/910",
      issue_set_id: "set_capability",
      parent_goal_issue_number: "7301",
    }],
    goal_policy: [{
      feature_id: "F-pol",
      issue_number: 911,
      issue_url: "https://github.com/recallnet/astrochicken/issues/911",
      issue_set_id: "set_policy",
      parent_goal_issue_number: "7302",
    }],
  });
  assert.deepEqual(packet.feature_materialization_markers, [
    "plan-2201::feature::F-cap",
    "plan-2201::feature::F-pol",
    "plan-2201::goal::goal_capability::feature::F-cap",
    "plan-2201::goal::goal_policy::feature::F-pol",
  ]);

  const invalid = validateGoalHardPlanMaterializationPacket({
    ...packet,
    factory_request_prerequisite_materialization: [{
      goal_id: "goal_capability",
      goal_issue_number: "7301",
      issue_set_id: "",
    }],
  });
  assert.equal(invalid.ok, false);
  assert.match(invalid.errors.join(","), /factory_request_prerequisite_materialization.issue_set_id/);
});

test("goal hard-plan materialization packet validates goal map shape", () => {
  const packet = buildGoalHardPlanMaterializationPacket({
    goalIssueNumber: "2201",
    planPacketId: "plan-2201",
    planningArtifactPath: "plan-2201.json",
    decompositionPacketId: "goal_decomposition_packet_2201",
    decompositionPacketPath: ".hatch/mothership/packets/goal_decomposition_packet/goal-2201.json",
    approvedFeatureIds: ["F-1"],
    approvedFeatures: [{ feature_id: "F-1" }],
    createdIssueNumbers: [900],
    createdIssueUrls: ["https://github.com/recallnet/astrochicken/issues/900"],
    featureIssueMap: [{ feature_id: "F-1", issue_number: 900, issue_url: "https://github.com/recallnet/astrochicken/issues/900" }],
    blockedByEdges: [{ issue_number: 900, blocked_by: [] }],
    goalBlockedByEdges: [{ issue_number: 2201, blocked_by: [900] }],
    goalIssueMap: {
      goal_final: "2201",
      goal_capability: "900",
      ignore_me: "not-a-number",
    },
    factoryId: "mothership",
  });

  assert.deepEqual(packet.goal_issue_map, {
    goal_capability: "900",
    goal_final: "2201",
  });

  const invalidGoalMap = validateGoalHardPlanMaterializationPacket({
    ...packet,
    goal_issue_map: ["not-an-object"],
  });
  assert.equal(invalidGoalMap.ok, false);
  assert.match(invalidGoalMap.errors.join(","), /invalid_field:goal_issue_map/);

  const invalidIssueSetMap = validateGoalHardPlanMaterializationPacket({
    ...packet,
    issue_set_map: [],
  });
  assert.equal(invalidIssueSetMap.ok, false);
  assert.match(invalidIssueSetMap.errors.join(","), /invalid_field:issue_set_map/);

  const invalidGoalFeatureIssueMap = validateGoalHardPlanMaterializationPacket({
    ...packet,
    goal_feature_issue_map: [],
  });
  assert.equal(invalidGoalFeatureIssueMap.ok, false);
  assert.match(invalidGoalFeatureIssueMap.errors.join(","), /invalid_field:goal_feature_issue_map/);

  const invalidGoalEdges = validateGoalHardPlanMaterializationPacket({
    ...packet,
    goal_blocked_by_edges: {},
  });
  assert.equal(invalidGoalEdges.ok, false);
  assert.match(invalidGoalEdges.errors.join(","), /invalid_field:goal_blocked_by_edges/);
});

test("goal hard-plan materialization packet persists and can be looked up by goal+plan", () => {
  const repo = mkdtempSync(join(tmpdir(), "goal-hard-plan-materialization-packet-"));

  const packet = buildGoalHardPlanMaterializationPacket({
    goalIssueNumber: "2201",
    planPacketId: "plan-2201",
    planningArtifactPath: "plan-2201.json",
    decompositionPacketId: "goal_decomposition_packet_2201",
    decompositionPacketPath: ".hatch/mothership/packets/goal_decomposition_packet/goal-2201.json",
    approvedFeatureIds: ["F-1"],
    approvedFeatures: [{ feature_id: "F-1" }],
    createdIssueNumbers: [900],
    createdIssueUrls: ["https://github.com/recallnet/astrochicken/issues/900"],
    featureIssueMap: [{ feature_id: "F-1", issue_number: 900, issue_url: "https://github.com/recallnet/astrochicken/issues/900" }],
    blockedByEdges: [{ issue_number: 900, blocked_by: [] }],
    factoryId: "mothership",
  });

  const persisted = persistGoalHardPlanMaterializationPacket({ repo, packet });
  assert.match(persisted.packet_path, /\.hatch\/mothership\/packets\/goal_hard_plan_materialization_packet\//);

  const latest = getLatestGoalHardPlanMaterializationPacket({
    repo,
    factoryId: "mothership",
    goalIssueNumber: "2201",
    planPacketId: "plan-2201",
  });

  assert.ok(latest?.packet);
  assert.equal(latest.packet.plan_packet_id, "plan-2201");
  assert.deepEqual(latest.packet.created_issue_numbers, [900]);
});
