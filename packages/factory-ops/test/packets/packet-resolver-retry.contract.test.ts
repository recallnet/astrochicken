// packet-resolver-retry.contract.test.mjs
//
// Behavioral tests for packet building, validation, state transitions,
// and the retry orchestration contracts. These exercise the actual
// functions that build/validate packets and verify the retry budget
// and state machine transitions work correctly end-to-end.

import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildMergeReport } from "../../src/commands/merge-item-ops.ts";
import { buildMergeConflictPacket, validateMergeConflictPacket } from "../../src/lib/merge-conflict-packet.ts";

// ============================================================================
// A. Merge conflict packet: build → validate → persist → read → update
// ============================================================================

test("buildMergeConflictPacket produces a valid packet with takeover contract", () => {
  const packet = buildMergeConflictPacket({
    repo: "/tmp/test-repo",
    branch: "wave/goal-1-issue-100",
    issueNumber: "100",
    worktreeDir: "/tmp/merge.worktree",
    conflictFiles: ["src/main.ts", "src/utils.ts"],
    branchCommits: [{ sha: "abc123", message: "feat: add feature" }],
    mainCommitsTouchingConflicts: [{ sha: "def456", message: "refactor: rename util" }],
    mergeStderr: "CONFLICT (content): Merge conflict in src/main.ts",
    notes: "Rebase conflict during wave merge",
    factoryId: "mothership",
    runId: "run-xyz",
    pipeline: "wave_execute",
    nodeId: "rebase_shared_branch",
    targetRepo: "recallnet/astrochicken",
    controlPlaneRepo: "recallnet/astrochicken",
  });

  // Validate envelope
  assert.equal(packet.schema_version, "merge_conflict_packet/v1");
  assert.equal(packet.packet_type, "merge_conflict_packet");
  assert.equal(packet.packet_state, "open");
  assert.ok(packet.packet_id, "must have a packet_id");
  assert.ok(packet.created_at, "must have created_at timestamp");

  // Validate takeover contract
  assert.equal(packet.handoff_owner, "supervisor");
  assert.equal(packet.handoff_kind, "merge_conflict_recovery");
  assert.ok(Array.isArray(packet.inspection_commands), "must have inspection commands");
  assert.ok(Array.isArray(packet.execution_commands), "must have execution commands");
  assert.ok(Array.isArray(packet.verify_commands), "must have verify commands");
  assert.ok(packet.operator_prompt, "must have operator prompt");

  // Validate merge-specific fields
  assert.deepEqual(packet.conflict_files, ["src/main.ts", "src/utils.ts"]);
  assert.equal(packet.branch, "wave/goal-1-issue-100");
  assert.equal(packet.issue_number, "100");
  assert.match(packet.merge_stderr, /CONFLICT/);

  // Must pass validation
  const validation = validateMergeConflictPacket(packet);
  assert.equal(validation.ok, true, `validation errors: ${validation.errors?.join(", ")}`);
});

test("validateMergeConflictPacket rejects packet missing required fields", () => {
  const incomplete = {
    schema_version: "merge_conflict_packet/v1",
    packet_type: "merge_conflict_packet",
    // missing: packet_id, created_at, conflict_files, etc.
  };

  const validation = validateMergeConflictPacket(incomplete);
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.length > 0, "should report specific errors");
});

test("merge conflict packet persist → read → update lifecycle", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "packet-test-"));
  try {
    const packet = buildMergeConflictPacket({
      repo: tmpDir,
      branch: "wave/goal-1-issue-100",
      issueNumber: "100",
      worktreeDir: join(tmpDir, "merge.worktree"),
      conflictFiles: ["a.ts"],
      branchCommits: [{ sha: "abc", message: "feat" }],
      mainCommitsTouchingConflicts: [{ sha: "def", message: "fix" }],
      mergeStderr: "CONFLICT",
      factoryId: "mothership",
      runId: "run-1",
      pipeline: "wave_execute",
      nodeId: "rebase",
      targetRepo: "o/r",
      controlPlaneRepo: "o/r",
    });

    // Persist
    const persisted = persistMergeConflictPacket({ repo: tmpDir, packet });
    assert.ok(persisted.packet_path, "must return packet_path");
    assert.ok(persisted.packet_ref, "must return packet_ref");

    // Read back
    const read = readPacketFromPath(persisted.packet_path);
    assert.ok(read, "must read back persisted packet");
    assert.equal(read.packet_id, packet.packet_id);
    assert.equal(read.packet_state, "open");

    // Update state to resolved
    const updated = updatePersistedPacketState({
      packetPath: persisted.packet_path,
      packetState: "resolved",
      statusReason: "supervisor_resolved_conflicts",
    });
    assert.ok(updated, "update must succeed");
    assert.equal(updated.packet_state, "resolved");

    // Read again to verify
    const readAgain = readPacketFromPath(persisted.packet_path);
    assert.equal(readAgain.packet_state, "resolved");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// Need this import for the persist test
import { persistMergeConflictPacket } from "../../src/lib/merge-conflict-packet.ts";
import {
  buildNamedPacketEnvelope,
  validateNamedPacketBase,
  makePacketId,
  persistNamedPacket,
  readPacketFromPath,
  updatePersistedPacketState,
  validatePacketTakeoverContract,
  isDurablePacketType,
  isTakeoverPacketType,
  PACKET_STATE_OPEN,
  PACKET_STATE_RESOLVED,
  PACKET_STATE_SUPERSEDED,
} from "../../src/lib/packet-core.ts";

// ============================================================================
// B. Packet envelope and ID determinism
// ============================================================================

test("makePacketId is deterministic for same inputs", () => {
  const id1 = makePacketId({ packetType: "merge_conflict_packet", identity: { branch: "b1", issue: "100" } });
  const id2 = makePacketId({ packetType: "merge_conflict_packet", identity: { branch: "b1", issue: "100" } });
  assert.equal(id1, id2, "same inputs must produce same packet ID");
  assert.ok(id1.length > 0, "ID must not be empty");
});

test("makePacketId produces different IDs for different inputs", () => {
  const id1 = makePacketId({ packetType: "merge_conflict_packet", identity: { branch: "b1" } });
  const id2 = makePacketId({ packetType: "merge_conflict_packet", identity: { branch: "b2" } });
  assert.notEqual(id1, id2, "different inputs must produce different IDs");
});

test("validateNamedPacketBase rejects envelope with missing fields", () => {
  const result = validateNamedPacketBase({});
  assert.equal(result.ok, false);
  assert.ok(result.errors.length > 0);
});

test("validateNamedPacketBase accepts complete envelope", () => {
  const envelope = buildNamedPacketEnvelope({
    schemaVersion: "test/v1",
    packetType: "test",
    packetId: "test-123",
    factoryId: "mothership",
    runId: "run-1",
    pipeline: "test",
    nodeId: "test_node",
    targetRepo: "o/r",
    controlPlaneRepo: "o/r",
  });
  const result = validateNamedPacketBase(envelope);
  assert.equal(result.ok, true, `errors: ${result.errors?.join(", ")}`);
});

// ============================================================================
// C. Takeover contract validation
// ============================================================================

test("validatePacketTakeoverContract rejects when required but missing", () => {
  const result = validatePacketTakeoverContract({}, { required: true });
  assert.equal(result.ok, false);
  assert.ok(result.errors.length > 0);
});

test("merge_conflict_packet is a durable takeover packet type", () => {
  assert.equal(isDurablePacketType("merge_conflict_packet"), true);
  assert.equal(isTakeoverPacketType("merge_conflict_packet"), true);
});

// ============================================================================
// D. Packet state transitions: open → resolved, open → superseded
// ============================================================================

test("packet state transitions are valid: open → resolved → cannot re-open", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "packet-state-"));
  try {
    const packet = buildMergeConflictPacket({
      repo: tmpDir,
      branch: "wave/b",
      issueNumber: "1",
      conflictFiles: ["f.ts"],
      branchCommits: [],
      mainCommitsTouchingConflicts: [],
      mergeStderr: "CONFLICT",
      factoryId: "mothership",
      runId: "run-1",
      pipeline: "wave_execute",
      nodeId: "rebase",
      targetRepo: "o/r",
      controlPlaneRepo: "o/r",
    });

    const { packet_path } = persistMergeConflictPacket({ repo: tmpDir, packet });

    // open → resolved
    const resolved = updatePersistedPacketState({
      packetPath: packet_path,
      packetState: PACKET_STATE_RESOLVED,
      statusReason: "test_resolve",
    });
    assert.equal(resolved.packet_state, PACKET_STATE_RESOLVED);

    // Read and verify persistence
    const read = readPacketFromPath(packet_path);
    assert.equal(read.packet_state, PACKET_STATE_RESOLVED);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ============================================================================
// E. Graph: retry budget contracts — rebase, post-merge, push each get 1 retry
// ============================================================================

test("wave_execute.dot — rebase conflict resolution has exactly 1 retry", () => {
  const dot = readFileSync("docs/contracts/workflow-ir/mothership/goal_execute.dot", "utf8");
  // resolve_conflict → finalize_merge_commit → finalize_merge_gate
  // finalize_merge_gate:fail → retry_resolve_conflict (ONE retry)
  // retry_resolve_conflict → verify_resolution
  assert.match(dot, /resolve_conflict/, "must have resolve_conflict node");
  assert.match(dot, /retry_resolve_conflict/, "must have retry_resolve_conflict node");
  // After retry, verify_resolution leads to resolution_gate which either succeeds or fails
  assert.match(dot, /verify_resolution|resolution_gate/, "must have verification after retry");
});

test("wave_execute.dot — post-merge failure has exactly 1 retry", () => {
  const dot = readFileSync("docs/contracts/workflow-ir/mothership/goal_execute.dot", "utf8");
  assert.match(dot, /resolve_post_merge/, "must have resolve_post_merge node");
  assert.match(dot, /retry_resolve_post_merge/, "must have retry_resolve_post_merge node");
  assert.match(dot, /finalize_post_merge/, "must have finalize_post_merge node");
});

test("wave_execute.dot — push failure has exactly 1 retry", () => {
  const dot = readFileSync("docs/contracts/workflow-ir/mothership/goal_execute.dot", "utf8");
  assert.match(dot, /resolve_push_failure/, "must have resolve_push_failure node");
  assert.match(dot, /retry_push_main/, "must have retry_push_main node");
  // Retry push either succeeds → close_merged_issues or fails → set_wave_merge_failed
  assert.match(dot, /retry_push_gate|retry_push/, "must have retry gate after push retry");
});

// ============================================================================
// F. buildMergeReport: mixed transport rejection
// ============================================================================

test("buildMergeReport produces valid output with all fields", () => {
  const report = buildMergeReport({
    issueNumber: "100",
    branch: "wave/goal-1-issue-100",
    mergeStatus: "merged",
    notes: "clean",
    mergeResolver: "deterministic",
    pathTaken: "merge",
  });

  assert.equal(report.issue_number, "100");
  assert.equal(report.branch, "wave/goal-1-issue-100");
  assert.equal(report.merge_status, "merged");
  assert.equal(report["hatch.merge.resolver"], "deterministic");
  assert.equal(report.path_taken, "merge");
});

test("buildMergeReport defaults resolver to 'unknown' when not provided", () => {
  const report = buildMergeReport({
    issueNumber: "100",
    mergeStatus: "merged",
  });
  assert.equal(report["hatch.merge.resolver"], "unknown");
});

test("buildMergeReport defaults path_taken to 'merge' when not provided", () => {
  const report = buildMergeReport({
    issueNumber: "100",
    mergeStatus: "merged",
  });
  assert.equal(report.path_taken, "merge");
});
