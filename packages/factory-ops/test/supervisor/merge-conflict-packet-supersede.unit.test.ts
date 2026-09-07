import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  mapPersistedPacketEntryToActionItem,
} from "../../src/lib/supervisor-state-snapshot-packet-first.ts";

const FACTORY_OPS_CLI_ENTRYPOINT = fileURLToPath(new URL("../../src/cli.ts", import.meta.url));

function createRunsDir(prefix = "merge-conflict-supersede-") {
  const rootDir = mkdtempSync(join(tmpdir(), prefix));
  const runsDir = join(rootDir, "runs");
  mkdirSync(runsDir, { recursive: true });
  return runsDir;
}

function writeMergeConflictPacket({
  runsDir,
  runId,
  packetId,
  branch = "goal/2182",
  issueNumber = "2182",
  mergeCandidateIssues = [],
  mergeStatus = "",
  pushStatus = "",
  resolutionStatus = "",
} = {}) {
  const packetDir = join(runsDir, runId, "packets", "merge_conflict_packet");
  mkdirSync(packetDir, { recursive: true });
  const packetPath = join(packetDir, `${packetId}.json`);
  writeFileSync(packetPath, JSON.stringify({
    schema_version: "merge_conflict_packet/v1",
    packet_type: "merge_conflict_packet",
    packet_id: packetId,
    created_at: "2026-03-17T00:39:45.000Z",
    packet_state: "open",
    factory_id: "mothership",
    run_id: runId,
    pipeline: "goal_execute",
    node_id: "build_conflict_packet",
    target_repo: "recallnet/astrochicken",
    control_plane_repo: "recallnet/astrochicken",
    handoff_owner: "supervisor",
    handoff_kind: "merge_conflict_recovery",
    inspection_commands: ["echo inspect"],
    execution_commands: ["echo execute"],
    verify_commands: ["echo verify"],
    expected_outcomes: ["resolved"],
    preserve_work: { preserve_work_required: true },
    operator_prompt: "resolve the merge conflict",
    resource_refs: {
      repo: "/tmp/nonexistent-repo",
      branch,
      worktree_dir: "/tmp/nonexistent-worktree",
      issue_number: issueNumber,
    },
    issue_number: issueNumber,
    branch,
    repo: "/tmp/nonexistent-repo",
    worktree_dir: "/tmp/nonexistent-worktree",
    conflict_files: ["packages/factory-ops/test/supervisor/daemon-scheduled-jobs.unit.test.mjs"],
    branch_commits: [
      { hash: "549c2e0d", subject: "test(factory-ops): add regressions (Closes #2191)" },
      { hash: "56267591", subject: "feat(factory-ops): enrich manifest (Closes #2190)" },
      { hash: "6be3fdc5", subject: "Add bundle manifest (Closes #2189)" },
    ],
    main_commits_touching_conflicts: [],
    merge_candidate_issues: mergeCandidateIssues,
  }, null, 2));

  writeFileSync(join(runsDir, runId, "state.json"), JSON.stringify({
    pipeline: "goal_execute",
    context: {
      ...(mergeStatus ? { merge_status: mergeStatus } : {}),
      ...(pushStatus ? { push_status: pushStatus } : {}),
      ...(resolutionStatus ? { resolution_status: resolutionStatus } : {}),
    },
  }, null, 2));

  return packetPath;
}

// ── Action item problem field includes merge candidate info ──────────

test("action item problem field includes merge_candidate_issues when present", () => {
  const entry = {
    packet: {
      packet_type: "merge_conflict_packet",
      packet_id: "merge_conflict_packet_test",
      run_id: "run-1",
      branch: "goal/2182",
      issue_number: "2182",
      merge_candidate_issues: ["2191"],
      conflict_files: ["foo.mjs"],
      worktree_dir: "/tmp/wt",
    },
    registry_entry: { family: "merge_conflict_packet" },
    packet_ref: {},
    packet_path: "/tmp/packet.json",
  };

  const item = mapPersistedPacketEntryToActionItem(entry);
  assert.match(item.problem, /2191/,
    "problem field must include the specific unmerged sub-issue number");
  assert.match(item.problem, /unmerged.*candidate|candidate.*unmerged|merge.*candidate/i,
    "problem field should indicate these are merge candidates");
});

test("action item problem field is normal when no merge_candidate_issues", () => {
  const entry = {
    packet: {
      packet_type: "merge_conflict_packet",
      packet_id: "merge_conflict_packet_test2",
      run_id: "run-2",
      branch: "wave/goal-1-wave-1",
      issue_number: "100",
      conflict_files: ["bar.mjs"],
      worktree_dir: "/tmp/wt2",
    },
    registry_entry: { family: "merge_conflict_packet" },
    packet_ref: {},
    packet_path: "/tmp/packet2.json",
  };

  const item = mapPersistedPacketEntryToActionItem(entry);
  assert.match(item.problem, /#100/,
    "problem field must include the issue number");
});

test("action item problem field includes multiple merge_candidate_issues", () => {
  const entry = {
    packet: {
      packet_type: "merge_conflict_packet",
      packet_id: "merge_conflict_packet_test3",
      run_id: "run-3",
      branch: "goal/2200",
      issue_number: "2200",
      merge_candidate_issues: ["2201", "2202", "2203"],
      conflict_files: ["baz.mjs"],
      worktree_dir: "/tmp/wt3",
    },
    registry_entry: { family: "merge_conflict_packet" },
    packet_ref: {},
    packet_path: "/tmp/packet3.json",
  };

  const item = mapPersistedPacketEntryToActionItem(entry);
  assert.match(item.problem, /2201/);
  assert.match(item.problem, /2202/);
  assert.match(item.problem, /2203/);
});

test("persisted orphan triage packets replay with canonical control-plane CLI command", () => {
  const entry = {
    packet: {
      schema_version: "remediation_packet/v1",
      packet_type: "orphan_feature_triage",
      packet_id: "orphan_feature_triage_test",
      run_id: "",
      execution_commands: ["node packages/factory-ops/src/cli.ts supervisor remediate-orphan-features --repo 'example-org/example-trading'"],
      inspection_commands: ["gh issue view 1814 --repo example-org/example-trading --json number,title"],
      verify_commands: ["gh issue view 1814 --repo example-org/example-trading --json number,labels"],
      target_repo: "",
      resource_refs: {},
    },
    registry_entry: { family: "remediation_packet" },
    packet_ref: {},
    packet_path: "/tmp/orphan-packet.json",
  };

  const item = mapPersistedPacketEntryToActionItem(entry);
  assert.equal(
    item.remediation_packet.execution_commands[0],
    `node ${FACTORY_OPS_CLI_ENTRYPOINT} supervisor remediate-orphan-features --repo 'example-org/example-trading'`,
  );
});

test("persisted goal execution path packets strip prose execution commands on replay", () => {
  const entry = {
    packet: {
      schema_version: "goal_execution_path_packet/v1",
      packet_type: "goal_execution_path_packet",
      packet_id: "goal_execution_path_packet_test",
      run_id: "",
      pipeline: "factory_supervisor_tick",
      operator_prompt: "Use this packet as the canonical execution-path contract for the goal.",
      execution_commands: ["Route the goal using execution_path and state fields from this packet instead of re-estimating ad hoc."],
    },
    registry_entry: { family: "goal_execution_path_packet" },
    packet_ref: {},
    packet_path: "/tmp/goal-execution-path-packet.json",
  };

  const item = mapPersistedPacketEntryToActionItem(entry);
  assert.deepEqual(item.remediation_packet.execution_commands, []);
  assert.equal(
    item.suggested_action,
    "Use this packet as the canonical execution-path contract for the goal.",
  );
});
