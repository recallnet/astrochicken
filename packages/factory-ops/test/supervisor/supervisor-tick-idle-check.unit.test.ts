import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { countOpenDurablePackets, detectExternalChanges, tickIdleCheck, updateTickIdleCursor, TICK_IDLE_CURSOR_SCHEMA } from "../../src/commands/supervisor-tick-idle-check.ts";

test("returns idle when waves in flight and nothing new", () => {
  const result = tickIdleCheck({ inFlightCount: 3, selectedCount: 0, stalledWaveCount: 0, spawnSuccessCount: 0 });
  assert.equal(result.tick_idle, "true");
  assert.match(result.tick_idle_reason, /3 wave.*in flight/);
});

test("returns not idle when new waves dispatched", () => {
  const result = tickIdleCheck({ inFlightCount: 3, selectedCount: 2, stalledWaveCount: 0, spawnSuccessCount: 0 });
  assert.equal(result.tick_idle, "false");
  assert.match(result.tick_idle_reason, /2_new_dispatches/);
});

test("returns not idle when stalled waves detected", () => {
  const result = tickIdleCheck({ inFlightCount: 3, selectedCount: 0, stalledWaveCount: 1, spawnSuccessCount: 0 });
  assert.equal(result.tick_idle, "false");
  assert.match(result.tick_idle_reason, /1_stalled_waves/);
});

test("returns not idle when new wave processes spawned", () => {
  const result = tickIdleCheck({ inFlightCount: 3, selectedCount: 0, stalledWaveCount: 0, spawnSuccessCount: 5 });
  assert.equal(result.tick_idle, "false");
  assert.match(result.tick_idle_reason, /5_new_spawns/);
});

test("returns not idle when no waves in flight", () => {
  const result = tickIdleCheck({ inFlightCount: 0, selectedCount: 0, stalledWaveCount: 0, spawnSuccessCount: 0 });
  assert.equal(result.tick_idle, "false");
  assert.match(result.tick_idle_reason, /no_waves/);
});

test("returns not idle with zero everything — no waves means not idle", () => {
  const result = tickIdleCheck({});
  assert.equal(result.tick_idle, "false");
  assert.match(result.tick_idle_reason, /no_waves_in_flight/);
});

test("returns not idle when all signals active", () => {
  const result = tickIdleCheck({ inFlightCount: 5, selectedCount: 2, stalledWaveCount: 1, spawnSuccessCount: 3 });
  assert.equal(result.tick_idle, "false");
  assert.match(result.tick_idle_reason, /2_new_dispatches/);
  assert.match(result.tick_idle_reason, /1_stalled_waves/);
  assert.match(result.tick_idle_reason, /3_new_spawns/);
});

test("handles string inputs from CLI context", () => {
  const result = tickIdleCheck({ inFlightCount: "7", selectedCount: "0", stalledWaveCount: "0", spawnSuccessCount: "0" });
  assert.equal(result.tick_idle, "true");
  assert.match(result.tick_idle_reason, /7 wave.*in flight/);
});

test("handles empty string inputs gracefully", () => {
  const result = tickIdleCheck({ inFlightCount: "", selectedCount: "", stalledWaveCount: "", spawnSuccessCount: "" });
  assert.equal(result.tick_idle, "false");
  assert.match(result.tick_idle_reason, /no_waves_in_flight/);
});

test("idle reason includes no_waves_in_flight when in_flight is zero but other signals present", () => {
  const result = tickIdleCheck({ inFlightCount: 0, selectedCount: 2, stalledWaveCount: 0, spawnSuccessCount: 0 });
  assert.equal(result.tick_idle, "false");
  assert.match(result.tick_idle_reason, /no_waves_in_flight/);
  assert.match(result.tick_idle_reason, /2_new_dispatches/);
});

test("returns not idle when durable supervisor packets are open even if waves are otherwise steady", () => {
  const result = tickIdleCheck({
    inFlightCount: 3,
    selectedCount: 0,
    stalledWaveCount: 0,
    spawnSuccessCount: 0,
    openDurablePacketCount: 6,
  });
  assert.equal(result.tick_idle, "false");
  assert.match(result.tick_idle_reason, /6_open_durable_packets/);
});

test("countOpenDurablePackets counts open durable packets in the factory runs dir", () => {
  const runsDir = mkdtempSync(join(tmpdir(), "tick-idle-packets-"));
  const packetDir = join(runsDir, "run-1", "packets", "merge_conflict_packet");
  mkdirSync(packetDir, { recursive: true });
  writeFileSync(join(packetDir, "merge_conflict_packet_1.json"), JSON.stringify({
    schema_version: "merge_conflict_packet/v1",
    packet_type: "merge_conflict_packet",
    packet_id: "merge_conflict_packet_1",
    packet_state: "open",
    created_at: "2026-03-11T18:00:00.000Z",
    factory_id: "mothership",
    run_id: "run-1",
    pipeline: "wave_execute",
    node_id: "build_conflict_packet",
    target_repo: "recallnet/astrochicken",
    control_plane_repo: "recallnet/astrochicken",
    branch: "wave/goal-1823-wave-1",
    worktree_dir: "/tmp/worktree",
    issue_number: "1828",
    conflict_files: ["a.txt"],
    inspection_commands: ["git status"],
    execution_commands: ["resolve files"],
    verify_commands: ["git diff --name-only --diff-filter=U"],
    expected_outcomes: ["clean"],
    operator_prompt: "resolve it",
    handoff_kind: "merge_conflict_recovery",
    handoff_owner: "supervisor",
    preserve_work: true,
    repo: ".",
    resource_refs: {
      branch: "wave/goal-1823-wave-1",
      worktree_dir: "/tmp/worktree",
    },
  }, null, 2));

  assert.equal(
    countOpenDurablePackets({
      runsDir,
      nowMs: Date.parse("2026-03-12T12:00:00.000Z"),
    }),
    1,
  );
});

// --- tickIdleCheck: externalChangesDetected parameter ---

test("returns idle when inFlight=0 and externalChangesDetected=false", () => {
  const result = tickIdleCheck({ inFlightCount: 0, externalChangesDetected: false });
  assert.equal(result.tick_idle, "true");
  assert.equal(result.tick_idle_reason, "no_waves_no_external_changes");
});

test("returns not idle when inFlight=0 and externalChangesDetected=true", () => {
  const result = tickIdleCheck({ inFlightCount: 0, externalChangesDetected: true });
  assert.equal(result.tick_idle, "false");
  assert.match(result.tick_idle_reason, /external_changes_detected/);
});

test("returns not idle when inFlight=0 and externalChangesDetected=undefined (backward compat)", () => {
  const result = tickIdleCheck({ inFlightCount: 0 });
  assert.equal(result.tick_idle, "false");
  assert.match(result.tick_idle_reason, /external_check_not_performed/);
});

test("externalChangesDetected=false with inFlight > 0 is still idle (no new activity)", () => {
  const result = tickIdleCheck({ inFlightCount: 3, externalChangesDetected: false });
  assert.equal(result.tick_idle, "true");
  assert.match(result.tick_idle_reason, /3 wave.*in flight/);
});

test("externalChangesDetected=true with inFlight > 0 is NOT idle (e.g. wave merge landed)", () => {
  const result = tickIdleCheck({ inFlightCount: 3, externalChangesDetected: true });
  assert.equal(result.tick_idle, "false");
  assert.match(result.tick_idle_reason, /external_changes_detected/);
});

test("inFlight=0 with externalChangesDetected=false but dispatches present is not idle", () => {
  const result = tickIdleCheck({ inFlightCount: 0, selectedCount: 2, externalChangesDetected: false });
  assert.equal(result.tick_idle, "false");
  assert.match(result.tick_idle_reason, /2_new_dispatches/);
});

// --- detectExternalChanges ---

test("detectExternalChanges returns changes_detected=true on first run (no cursor)", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "idle-cursor-"));
  const mockSpawn = (cmd, args) => {
    if (cmd === "git") return { status: 0, stdout: "abc123\n", stderr: "" };
    return { status: 1, stdout: "", stderr: "unexpected" };
  };
  const result = detectExternalChanges({ factoryId: "test", rootDir, spawnSyncFn: mockSpawn });
  assert.equal(result.changes_detected, true);
  assert.equal(result.reason, "no_prior_cursor");
  // detectExternalChanges is read-only — cursor should NOT be created
  const cursorPath = join(rootDir, ".hatch", "factories", "test", "tick-idle-cursor.json");
  assert.equal(existsSync(cursorPath), false);
});

test("detectExternalChanges returns changes_detected=false when HEAD unchanged and no issues changed", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "idle-cursor-"));
  const cursorDir = join(rootDir, ".hatch", "factories", "test");
  mkdirSync(cursorDir, { recursive: true });
  writeFileSync(join(cursorDir, "tick-idle-cursor.json"), JSON.stringify({
    schema: TICK_IDLE_CURSOR_SCHEMA,
    factory_id: "test",
    last_head_sha: "abc123",
    last_checked_at: "2026-03-11T20:00:00.000Z",
    updated_at: "2026-03-11T20:00:00.000Z",
  }));
  const mockSpawn = (cmd, args) => {
    if (cmd === "git") return { status: 0, stdout: "abc123\n", stderr: "" };
    if (cmd === "gh") return { status: 0, stdout: "0\n", stderr: "" };
    return { status: 1, stdout: "", stderr: "" };
  };
  const result = detectExternalChanges({ factoryId: "test", ghRepo: "acme/repo", rootDir, spawnSyncFn: mockSpawn });
  assert.equal(result.changes_detected, false);
  assert.equal(result.reason, "no_external_changes");
});

test("detectExternalChanges returns changes_detected=true when HEAD changed", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "idle-cursor-"));
  const cursorDir = join(rootDir, ".hatch", "factories", "test");
  mkdirSync(cursorDir, { recursive: true });
  writeFileSync(join(cursorDir, "tick-idle-cursor.json"), JSON.stringify({
    schema: TICK_IDLE_CURSOR_SCHEMA,
    factory_id: "test",
    last_head_sha: "old_sha",
    last_checked_at: "2026-03-11T20:00:00.000Z",
  }));
  const mockSpawn = (cmd) => {
    if (cmd === "git") return { status: 0, stdout: "new_sha\n", stderr: "" };
    return { status: 1, stdout: "", stderr: "" };
  };
  const result = detectExternalChanges({ factoryId: "test", rootDir, spawnSyncFn: mockSpawn });
  assert.equal(result.changes_detected, true);
  assert.equal(result.reason, "head_sha_changed");
});

test("detectExternalChanges returns changes_detected=true when issues changed", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "idle-cursor-"));
  const cursorDir = join(rootDir, ".hatch", "factories", "test");
  mkdirSync(cursorDir, { recursive: true });
  writeFileSync(join(cursorDir, "tick-idle-cursor.json"), JSON.stringify({
    schema: TICK_IDLE_CURSOR_SCHEMA,
    factory_id: "test",
    last_head_sha: "abc123",
    last_checked_at: "2026-03-11T20:00:00.000Z",
  }));
  const mockSpawn = (cmd) => {
    if (cmd === "git") return { status: 0, stdout: "abc123\n", stderr: "" };
    if (cmd === "gh") return { status: 0, stdout: "1\n", stderr: "" };
    return { status: 1, stdout: "", stderr: "" };
  };
  const result = detectExternalChanges({ factoryId: "test", ghRepo: "acme/repo", rootDir, spawnSyncFn: mockSpawn });
  assert.equal(result.changes_detected, true);
  assert.equal(result.reason, "1_issues_changed");
});

test("detectExternalChanges returns changes_detected=true when GitHub API fails (conservative)", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "idle-cursor-"));
  const cursorDir = join(rootDir, ".hatch", "factories", "test");
  mkdirSync(cursorDir, { recursive: true });
  writeFileSync(join(cursorDir, "tick-idle-cursor.json"), JSON.stringify({
    schema: TICK_IDLE_CURSOR_SCHEMA,
    factory_id: "test",
    last_head_sha: "abc123",
    last_checked_at: "2026-03-11T20:00:00.000Z",
  }));
  const mockSpawn = (cmd) => {
    if (cmd === "git") return { status: 0, stdout: "abc123\n", stderr: "" };
    if (cmd === "gh") return { status: 1, stdout: "", stderr: "auth required" };
    return { status: 1, stdout: "", stderr: "" };
  };
  const result = detectExternalChanges({ factoryId: "test", ghRepo: "acme/repo", rootDir, spawnSyncFn: mockSpawn });
  assert.equal(result.changes_detected, true);
  assert.equal(result.reason, "github_api_error");
});

test("detectExternalChanges returns changes_detected=true when git rev-parse fails", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "idle-cursor-"));
  const mockSpawn = () => ({ status: 1, stdout: "", stderr: "fatal: not a git repository" });
  const result = detectExternalChanges({ factoryId: "test", rootDir, spawnSyncFn: mockSpawn });
  assert.equal(result.changes_detected, true);
  assert.equal(result.reason, "git_head_unresolvable");
});

test("detectExternalChanges skips GitHub check when ghRepo is empty", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "idle-cursor-"));
  const cursorDir = join(rootDir, ".hatch", "factories", "test");
  mkdirSync(cursorDir, { recursive: true });
  writeFileSync(join(cursorDir, "tick-idle-cursor.json"), JSON.stringify({
    schema: TICK_IDLE_CURSOR_SCHEMA,
    factory_id: "test",
    last_head_sha: "abc123",
    last_checked_at: "2026-03-11T20:00:00.000Z",
  }));
  let ghCalled = false;
  const mockSpawn = (cmd) => {
    if (cmd === "git") return { status: 0, stdout: "abc123\n", stderr: "" };
    if (cmd === "gh") { ghCalled = true; return { status: 0, stdout: "0\n", stderr: "" }; }
    return { status: 1, stdout: "", stderr: "" };
  };
  const result = detectExternalChanges({ factoryId: "test", ghRepo: "", rootDir, spawnSyncFn: mockSpawn });
  assert.equal(result.changes_detected, false);
  assert.equal(result.reason, "no_external_changes");
  assert.equal(ghCalled, false, "gh should not be called when ghRepo is empty");
});

// --- updateTickIdleCursor ---

test("updateTickIdleCursor writes cursor with current HEAD", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "idle-cursor-"));
  const mockSpawn = (cmd) => {
    if (cmd === "git") return { status: 0, stdout: "deadbeef\n", stderr: "" };
    return { status: 1, stdout: "", stderr: "" };
  };
  const result = updateTickIdleCursor({ factoryId: "test", rootDir, spawnSyncFn: mockSpawn });
  assert.equal(result.updated, true);
  assert.equal(result.reason, "cursor_advanced");
  const cursorPath = join(rootDir, ".hatch", "factories", "test", "tick-idle-cursor.json");
  assert.equal(existsSync(cursorPath), true);
  const cursor = JSON.parse(readFileSync(cursorPath, "utf8"));
  assert.equal(cursor.schema, TICK_IDLE_CURSOR_SCHEMA);
  assert.equal(cursor.last_head_sha, "deadbeef");
  assert.ok(cursor.last_checked_at);
});

test("updateTickIdleCursor returns updated=false when git fails", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "idle-cursor-"));
  const mockSpawn = () => ({ status: 1, stdout: "", stderr: "fatal" });
  const result = updateTickIdleCursor({ factoryId: "test", rootDir, spawnSyncFn: mockSpawn });
  assert.equal(result.updated, false);
  assert.equal(result.reason, "git_head_unresolvable");
});

test("end-to-end: detectExternalChanges reads cursor written by updateTickIdleCursor", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "idle-cursor-"));
  const mockSpawn = (cmd) => {
    if (cmd === "git") return { status: 0, stdout: "abc123\n", stderr: "" };
    if (cmd === "gh") return { status: 0, stdout: "0\n", stderr: "" };
    return { status: 1, stdout: "", stderr: "" };
  };
  // First: no cursor → changes detected
  const r1 = detectExternalChanges({ factoryId: "test", ghRepo: "acme/repo", rootDir, spawnSyncFn: mockSpawn });
  assert.equal(r1.changes_detected, true);
  assert.equal(r1.reason, "no_prior_cursor");
  // Write cursor at end of tick
  updateTickIdleCursor({ factoryId: "test", rootDir, spawnSyncFn: mockSpawn });
  // Next check: same HEAD, no issues → no changes
  const r2 = detectExternalChanges({ factoryId: "test", ghRepo: "acme/repo", rootDir, spawnSyncFn: mockSpawn });
  assert.equal(r2.changes_detected, false);
  assert.equal(r2.reason, "no_external_changes");
});
