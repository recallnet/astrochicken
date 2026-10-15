import { useCanonicalEventStoreFixture } from "./factory-status-postgres-fixture.ts";

const eventStoreFixture = useCanonicalEventStoreFixture();

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildStateSnapshot } from "../../src/commands/supervisor-state-snapshot.ts";

function ghStub(_args, fallback = []) {
  return fallback;
}

function sh(args, cwd) {
  const run = spawnSync(args[0], args.slice(1), { cwd, encoding: "utf8" });
  if ((run.status ?? 1) !== 0) {
    throw new Error(run.stderr || run.stdout || `command failed: ${args.join(" ")}`);
  }
  return String(run.stdout || "").trim();
}

test("buildStateSnapshot surfaces actionable merge conflict packets as supervisor action items", async () => {
  const runsDir = mkdtempSync(join(tmpdir(), "snapshot-merge-conflict-packets-"));
  const repoRoot = mkdtempSync(join(tmpdir(), "snapshot-merge-conflict-repo-"));
  sh(["git", "init", "-b", "main"], repoRoot);
  sh(["git", "config", "user.email", "hatch@example.com"], repoRoot);
  sh(["git", "config", "user.name", "Hatch"], repoRoot);
  writeFileSync(join(repoRoot, "file.txt"), "base\n");
  sh(["git", "add", "file.txt"], repoRoot);
  sh(["git", "commit", "-m", "base"], repoRoot);
  sh(["git", "checkout", "-b", "wave/goal-205-wave-1"], repoRoot);
  writeFileSync(join(repoRoot, "file.txt"), "wave change\n");
  sh(["git", "commit", "-am", "wave change"], repoRoot);
  sh(["git", "checkout", "main"], repoRoot);

  const packetDir = join(runsDir, "run-merge-1", "packets", "merge_conflict_packet");
  mkdirSync(packetDir, { recursive: true });
  writeFileSync(join(packetDir, "merge_conflict_packet_abc.json"), JSON.stringify({
    schema_version: "merge_conflict_packet/v1",
    packet_type: "merge_conflict_packet",
    packet_id: "merge_conflict_packet_abc",
    created_at: "2026-03-10T00:00:00.000Z",
    packet_state: "open",
    factory_id: "mothership",
    run_id: "run-merge-1",
    pipeline: "wave_execute",
    node_id: "build_push_failure_packet",
    target_repo: "recallnet/astrochicken",
    control_plane_repo: "recallnet/astrochicken",
    handoff_owner: "supervisor",
    handoff_kind: "merge_conflict_recovery",
    inspection_commands: ["echo inspect"],
    execution_commands: ["echo execute"],
    verify_commands: ["echo verify"],
    expected_outcomes: ["resolved"],
    preserve_work: { preserve_work_required: true },
    operator_prompt: "recover the merge conflict",
    issue_number: "205",
    branch: "wave/goal-205-wave-1",
    repo: repoRoot,
    worktree_dir: "",
    conflict_files: [],
    branch_commits: [],
    main_commits_touching_conflicts: [],
    merge_stderr: "failed to push some refs",
    notes: "Inspect push failure and recover safely.",
  }, null, 2));

  await eventStoreFixture.seedPacketFile({ packetPath: join(packetDir, "merge_conflict_packet_abc.json") });
  const out = JSON.parse(buildStateSnapshot({
    repo: "recallnet/astrochicken",
    factoryId: "mothership",
    ghJsonFn: ghStub,
    recoverySweepFn: () => ({ stale_runs: [] }),
    nowMs: Date.parse("2026-03-10T01:00:00.000Z"),
    runsDir,
  }));

  const item = (out.action_items || []).find((entry) => entry.type === "merge_conflict_packet");
  assert.ok(item, "expected merge conflict packet action item");
  assert.match(String(item.problem || ""), /MERGE_CONFLICT_PACKET_OPEN/);
  assert.equal(item.diagnostics?.packet_storage_class, "factory_run_packet");
  assert.equal(item.packet_ref?.packet_type, "merge_conflict_packet");
  assert.match(String(item.suggested_action || ""), /resolve the conflicts|recover/i);
});
