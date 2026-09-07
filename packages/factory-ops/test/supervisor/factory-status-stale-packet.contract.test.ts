/**
 * Regression test for bug #2048: open durable packets from completed/failed/suspended
 * runs must not appear in factory status open_packets.
 *
 * Symptom: merge_conflict_packet entries from completed wave_execute runs appeared
 * as "active" in factory status, misleading operators during an unrelated supervisor
 * hang incident on 2026-03-13.
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { legacyFixtureFactoryStatus as factoryStatus } from "../../src/lib/factory-status-support.ts";

function writeRun(runsDir, id, state) {
  const dir = join(runsDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "state.json"), JSON.stringify(state, null, 2));
}

test("factoryStatus excludes open durable packets from completed runs — stale packet regression (#2048)", () => {
  // Regression: packets left "open" on disk after their source run completed were
  // showing up in factory status as active, misleading operators during unrelated
  // incidents (bug #2048).  Completed/failed/suspended runs must be excluded from
  // open_packets even if the packet file on disk still says packet_state="open".
  const rootDir = mkdtempSync(join(tmpdir(), "factory-status-stale-packet-"));
  const runsDir = join(rootDir, ".hatch", "mothership", "runs");
  mkdirSync(runsDir, { recursive: true });

  // Run 1: completed — its merge_conflict_packet must be excluded even though
  // the packet file still says packet_state="open".
  const completedRunId = "completed-wave-run";
  const completedPacketDir = join(runsDir, completedRunId, "packets", "merge_conflict_packet");
  mkdirSync(completedPacketDir, { recursive: true });
  writeFileSync(join(completedPacketDir, "merge_conflict_packet_stale.json"), JSON.stringify({
    schema_version: "merge_conflict_packet/v1",
    packet_type: "merge_conflict_packet",
    packet_id: "merge_conflict_packet_stale",
    packet_state: "open",
    created_at: new Date(Date.now() - 60_000).toISOString(),
    factory_id: "mothership",
    run_id: completedRunId,
    pipeline: "wave_execute",
    node_id: "build_post_merge_packet",
    handoff_owner: "supervisor",
    handoff_kind: "merge_conflict_recovery",
    inspection_commands: ["echo inspect"],
    execution_commands: ["echo execute"],
    verify_commands: ["echo verify"],
    expected_outcomes: ["resolved"],
    preserve_work: { preserve_work_required: true },
    operator_prompt: "resolve conflict",
    resource_refs: { milestone_title: "goal-55-wave-1" },
    repo: "/tmp/nonexistent",
    branch: "wave/goal-55-wave-1",
    conflict_files: ["src/index.ts"],
  }, null, 2));
  writeRun(runsDir, completedRunId, {
    runId: completedRunId,
    status: "completed",
    currentNode: "done",
    updatedAt: new Date().toISOString(),
  });

  // Run 2: active — its durable packet should still appear.
  const activeRunId = "active-judge-run";
  const activePacketDir = join(runsDir, activeRunId, "packets", "judge_context_contract_recovery");
  mkdirSync(activePacketDir, { recursive: true });
  writeFileSync(join(activePacketDir, "judge_context_contract_recovery_live.json"), JSON.stringify({
    schema_version: "remediation_packet/v1",
    packet_type: "judge_context_contract_recovery",
    packet_id: "judge_context_contract_recovery_live",
    packet_state: "open",
    created_at: new Date(Date.now() - 30_000).toISOString(),
    factory_id: "mothership",
    run_id: activeRunId,
    pipeline: "wave_execute",
    node_id: "build_judge_context_recovery_packet",
    handoff_owner: "supervisor",
    handoff_kind: "judge_context_contract_recovery",
    inspection_commands: ["echo inspect"],
    execution_commands: ["echo execute"],
    verify_commands: ["echo verify"],
    expected_outcomes: ["recovered"],
    preserve_work: {},
    operator_prompt: "use packet",
    resource_refs: { milestone_title: "goal-56-wave-1" },
  }, null, 2));
  writeRun(runsDir, activeRunId, {
    runId: activeRunId,
    status: "running",
    currentNode: "build_judge_context_recovery_packet",
    updatedAt: new Date().toISOString(),
    pid: process.pid,
  });

  const out = factoryStatus({
    runsDir,
    context: { factory_id: "mothership" },
  });

  // The stale merge_conflict_packet from the completed run must be absent.
  const stalePacket = out.open_packets.find((p) => p.packet_id === "merge_conflict_packet_stale");
  assert.equal(stalePacket, undefined,
    "open_packets must not include packets from completed runs");

  // The active packet from the running run must still appear.
  const livePacket = out.open_packets.find((p) => p.packet_id === "judge_context_contract_recovery_live");
  assert.ok(livePacket,
    "open_packets must include packets from active runs");
  assert.equal(livePacket.packet_type, "judge_context_contract_recovery");
  assert.equal(livePacket.title, "goal-56-wave-1");
});

test("factoryStatus excludes open durable packets from failed runs", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "factory-status-stale-failed-"));
  const runsDir = join(rootDir, ".hatch", "mothership", "runs");
  mkdirSync(runsDir, { recursive: true });

  const failedRunId = "failed-wave-run";
  const failedPacketDir = join(runsDir, failedRunId, "packets", "judge_context_contract_recovery");
  mkdirSync(failedPacketDir, { recursive: true });
  writeFileSync(join(failedPacketDir, "judge_context_contract_recovery_failed.json"), JSON.stringify({
    schema_version: "remediation_packet/v1",
    packet_type: "judge_context_contract_recovery",
    packet_id: "judge_context_contract_recovery_failed",
    packet_state: "open",
    created_at: new Date(Date.now() - 60_000).toISOString(),
    factory_id: "mothership",
    run_id: failedRunId,
    pipeline: "wave_execute",
    node_id: "build_judge_context_recovery_packet",
    handoff_owner: "supervisor",
    handoff_kind: "judge_context_contract_recovery",
    inspection_commands: ["echo inspect"],
    execution_commands: ["echo execute"],
    verify_commands: ["echo verify"],
    expected_outcomes: ["recovered"],
    preserve_work: {},
    operator_prompt: "use packet",
    resource_refs: { milestone_title: "goal-57-wave-1" },
  }, null, 2));
  writeRun(runsDir, failedRunId, {
    runId: failedRunId,
    status: "failed",
    currentNode: "done",
    updatedAt: new Date().toISOString(),
  });

  const out = factoryStatus({
    runsDir,
    context: { factory_id: "mothership" },
  });

  const stalePacket = out.open_packets.find((p) => p.packet_id === "judge_context_contract_recovery_failed");
  assert.equal(stalePacket, undefined,
    "open_packets must not include packets from failed runs");
});
