import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { materializeApprovedHardPlan } from "../../src/commands/goal-hard-plan-materialize.ts";
import {
  makeGhStub,
  makeTempDir,
  parseJsonStdout,
  runGoalMaterializeApprovedPlan,
  seedApprovedHardPlanningState,
  writeFactoryRequestPlanArtifact,
} from "./helpers/command-test-helpers.ts";

function writeSimplePlanArtifact({ packetRepoRoot, goalIssueNumber }) {
  const planningArtifactPath = join(packetRepoRoot, "plan-2299.json");
  const packet = {
    schema_version: "hard_plan_packet/v1",
    packet_type: "hard_plan_packet",
    packet_id: "plan-2299",
    goal_issue_number: goalIssueNumber,
    planning_state: "approved",
    approved_features: [
      { feature_id: "F-1", name: "Materialize", summary: "Create issues" },
      { feature_id: "F-2", name: "Wire blockers", summary: "Apply blockedBy", dependencies: ["F-1"] },
    ],
  };
  writeFileSync(planningArtifactPath, JSON.stringify(packet, null, 2));
  return planningArtifactPath;
}

function buildCliEnv(stub) {
  return {
    PATH: `${stub.binDir}:${process.env.PATH || ""}`,
    HATCH_TEST_GH_STATE_PATH: stub.statePath,
  };
}

function assertGoalMaterializeReplay({
  first,
  second,
  expectedGoalNumber,
  expectedPlanPacketId,
  expectedCreatedIssueNumbers = [900, 901, 902],
  compareIssueNumbersAsSet = false,
}) {
  const firstIssueNumbers = first.created_issue_numbers || [];
  const secondIssueNumbers = second.created_issue_numbers || [];

  assert.equal(first.already_completed, "false");
  if (compareIssueNumbersAsSet) {
    assert.deepEqual([...firstIssueNumbers].sort((a, b) => a - b), [...expectedCreatedIssueNumbers].sort((a, b) => a - b));
  } else {
    assert.deepEqual(firstIssueNumbers, expectedCreatedIssueNumbers);
  }
  assert.deepEqual(first.goal_issue, { number: expectedGoalNumber, title: `Goal ${expectedGoalNumber}` });
  assert.equal(Array.isArray(first.approved_features), true);
  assert.equal(first.decomposition_packet_id?.startsWith("goal_decomposition_packet_"), true);
  assert.equal(Boolean(first.decomposition_packet_path), true);

  assert.equal(second.already_completed, "true");
  if (compareIssueNumbersAsSet) {
    assert.deepEqual([...secondIssueNumbers].sort((a, b) => a - b), [...firstIssueNumbers].sort((a, b) => a - b));
  } else {
    assert.deepEqual(secondIssueNumbers, firstIssueNumbers);
  }
  assert.deepEqual(second.goal_issue, first.goal_issue);
  assert.equal(Array.isArray(second.approved_features), true);
  assert.equal(second.decomposition_packet_id?.startsWith("goal_decomposition_packet_"), true);
  assert.equal(Boolean(second.decomposition_packet_path), true);

  assert.deepEqual(first.traceability_chain, {
    goal_issue_number: String(expectedGoalNumber),
    plan_packet_id: expectedPlanPacketId,
    decomposition_packet_id: first.decomposition_packet_id,
    issue_numbers: firstIssueNumbers,
  });
  assert.deepEqual(second.traceability_chain, {
    goal_issue_number: String(expectedGoalNumber),
    plan_packet_id: expectedPlanPacketId,
    decomposition_packet_id: second.decomposition_packet_id,
    issue_numbers: secondIssueNumbers,
  });
}

function assertSimpleReplayPayload(secondPayload) {
  assert.deepEqual(secondPayload.issue_set_map, {});
  assert.deepEqual(secondPayload.prerequisite_goal_issue_numbers, []);
  assert.equal(secondPayload.final_instantiation_goal_issue_number, null);
  assert.deepEqual(secondPayload.goal_feature_issue_map, {});
  assert.deepEqual(secondPayload.feature_materialization_markers, []);
}

test("goal-hard-plan-materialize.mjs materializes approved plans in CLI mode and supports replay", () => {
  const stub = makeGhStub();
  const packetRepoRoot = makeTempDir("goal-hard-materialize-cli-");
  const goalIssueNumber = "2299";
  const planningArtifactPath = writeSimplePlanArtifact({ packetRepoRoot, goalIssueNumber });

  seedApprovedHardPlanningState({
    packetRepoRoot,
    goalIssueNumber,
    planningArtifactPath,
    factoryId: "mothership",
  });

  try {
    const firstRun = runGoalMaterializeApprovedPlan({
      packetRepoRoot,
      goalIssueNumber,
      planPacket: "plan-2299",
      planningArtifactPath,
      factoryId: "mothership",
      env: buildCliEnv(stub),
    });
    const secondRun = runGoalMaterializeApprovedPlan({
      packetRepoRoot,
      goalIssueNumber,
      planPacket: "plan-2299",
      planningArtifactPath,
      factoryId: "mothership",
      env: buildCliEnv(stub),
    });

    assert.equal(firstRun.status, 0, `stderr=${firstRun.stderr}\nstdout=${firstRun.stdout}`);
    assert.equal(secondRun.status, 0, `stderr=${secondRun.stderr}\nstdout=${secondRun.stdout}`);

    const firstPayload = parseJsonStdout(firstRun.stdout);
    const secondPayload = parseJsonStdout(secondRun.stdout);

    assertGoalMaterializeReplay({
      first: firstPayload,
      second: secondPayload,
      expectedGoalNumber: 2299,
      expectedPlanPacketId: "plan-2299",
    });

    assert.equal(firstPayload.awaiting_human_label_removed, "true");
    assertSimpleReplayPayload(secondPayload);

    const calls = JSON.parse(readFileSync(stub.statePath, "utf8")).calls || [];
    const createCalls = calls.filter((args) => args[0] === "issue" && args[1] === "create");
    const awaitingHumanRemoveCalls = calls.filter((args) => args[0] === "issue"
      && args[1] === "edit"
      && args.includes("--remove-label")
      && args.includes("awaiting-human"));
    assert.equal(createCalls.length, 3, "replay must not create additional issues");
    assert.equal(awaitingHumanRemoveCalls.length >= 1, true, "awaiting-human hold should be cleared during approved-plan resume");
  } finally {
    rmSync(packetRepoRoot, { recursive: true, force: true });
    stub.cleanup();
  }
});

test("goal-hard-plan-materialize.mjs replays cached factory-request ledger fields without creating new issues", () => {
  const stub = makeGhStub();
  const packetRepoRoot = makeTempDir("goal-hard-materialize-cli-factory-request-");
  const goalIssueNumber = "2300";
  const planningArtifactPath = writeFactoryRequestPlanArtifact({ packetRepoRoot, goalIssueNumber });

  seedApprovedHardPlanningState({
    packetRepoRoot,
    goalIssueNumber,
    planningArtifactPath,
    factoryId: "mothership",
  });

  try {
    const firstRun = runGoalMaterializeApprovedPlan({
      packetRepoRoot,
      goalIssueNumber,
      planPacket: "plan-factory-request-2300",
      planningArtifactPath,
      factoryId: "mothership",
      env: buildCliEnv(stub),
    });
    assert.equal(firstRun.status, 0, `stderr=${firstRun.stderr}\nstdout=${firstRun.stdout}`);
    const firstPayload = parseJsonStdout(firstRun.stdout);

    const secondRun = runGoalMaterializeApprovedPlan({
      packetRepoRoot,
      goalIssueNumber,
      planPacket: "plan-factory-request-2300",
      planningArtifactPath,
      factoryId: "mothership",
      env: buildCliEnv(stub),
    });
    assert.equal(secondRun.status, 0, `stderr=${secondRun.stderr}\nstdout=${secondRun.stdout}`);
    const secondPayload = parseJsonStdout(secondRun.stdout);

    assertGoalMaterializeReplay({
      first: firstPayload,
      second: secondPayload,
      expectedGoalNumber: 2300,
      expectedPlanPacketId: "plan-factory-request-2300",
      expectedCreatedIssueNumbers: firstPayload.created_issue_numbers,
      compareIssueNumbersAsSet: true,
    });

    assert.deepEqual(firstPayload.goal_issue_map, {
      goal_capability: "7401",
      goal_final: "2300",
      goal_policy: "7402",
    });
    assert.deepEqual(firstPayload.prerequisite_goal_issue_numbers, [7401, 7402]);
    assert.equal(firstPayload.final_instantiation_goal_issue_number, 2300);
    assert.deepEqual(firstPayload.issue_set_map, {
      set_capability: {
        issue_set_id: "set_capability",
        title: "Capability set",
        goal_ids: ["goal_capability"],
        goal_issue_numbers: ["7401"],
        feature_ids: ["F-cap"],
        created_issue_numbers: [900],
        created_issue_urls: ["https://github.com/recallnet/astrochicken/issues/900"],
      },
      set_final: {
        issue_set_id: "set_final",
        title: "Final set",
        goal_ids: ["goal_final"],
        goal_issue_numbers: ["2300"],
        feature_ids: ["F-final"],
        created_issue_numbers: [902],
        created_issue_urls: ["https://github.com/recallnet/astrochicken/issues/902"],
      },
      set_policy: {
        issue_set_id: "set_policy",
        title: "Policy set",
        goal_ids: ["goal_policy"],
        goal_issue_numbers: ["7402"],
        feature_ids: ["F-pol"],
        created_issue_numbers: [901],
        created_issue_urls: ["https://github.com/recallnet/astrochicken/issues/901"],
      },
    });
    assert.deepEqual(firstPayload.goal_feature_issue_map, {
      goal_capability: [{
        feature_id: "F-cap",
        issue_number: 900,
        issue_url: "https://github.com/recallnet/astrochicken/issues/900",
        issue_set_id: "set_capability",
        parent_goal_issue_number: "7401",
      }],
      goal_final: [{
        feature_id: "F-final",
        issue_number: 902,
        issue_url: "https://github.com/recallnet/astrochicken/issues/902",
        issue_set_id: "set_final",
        parent_goal_issue_number: "2300",
      }],
      goal_policy: [{
        feature_id: "F-pol",
        issue_number: 901,
        issue_url: "https://github.com/recallnet/astrochicken/issues/901",
        issue_set_id: "set_policy",
        parent_goal_issue_number: "7402",
      }],
    });
    assert.deepEqual(firstPayload.feature_materialization_markers, [
      "plan-factory-request-2300::feature::F-cap",
      "plan-factory-request-2300::feature::F-final",
      "plan-factory-request-2300::feature::F-pol",
      "plan-factory-request-2300::feature::rationale-doc-goal",
      "plan-factory-request-2300::goal::goal_capability::feature::F-cap",
      "plan-factory-request-2300::goal::goal_final::feature::F-final",
      "plan-factory-request-2300::goal::goal_policy::feature::F-pol",
    ]);

    assert.deepEqual(secondPayload.goal_issue_map, firstPayload.goal_issue_map);
    assert.deepEqual(secondPayload.issue_set_map, firstPayload.issue_set_map);
    assert.deepEqual(secondPayload.prerequisite_goal_issue_numbers, firstPayload.prerequisite_goal_issue_numbers);
    assert.equal(secondPayload.final_instantiation_goal_issue_number, firstPayload.final_instantiation_goal_issue_number);
    assert.deepEqual(secondPayload.goal_feature_issue_map, firstPayload.goal_feature_issue_map);
    assert.deepEqual(secondPayload.feature_materialization_markers, firstPayload.feature_materialization_markers);

    const calls = JSON.parse(readFileSync(stub.statePath, "utf8")).calls || [];
    const createCalls = calls.filter((args) => args[0] === "issue" && args[1] === "create");
    assert.equal(createCalls.length, 4, "replay must not create additional issues");
  } finally {
    rmSync(packetRepoRoot, { recursive: true, force: true });
    stub.cleanup();
  }
});

test("goal-hard-plan-materialize.mjs command module exports materializeApprovedHardPlan", () => {
  assert.equal(typeof materializeApprovedHardPlan, "function");
});
