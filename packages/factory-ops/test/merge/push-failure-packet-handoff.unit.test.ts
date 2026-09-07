import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildConflictPacket } from "../../src/commands/merge-item-ops.ts";

function sh(args, cwd) {
  const p = spawnSync(args[0], args.slice(1), { cwd, encoding: "utf8" });
  if ((p.status ?? 1) !== 0) throw new Error((p.stderr || p.stdout || "cmd failed").trim());
  return String(p.stdout || "").trim();
}

function initRepo() {
  const repo = mkdtempSync(join(tmpdir(), "taxi-push-failure-"));
  sh(["git", "init", "-b", "main"], repo);
  sh(["git", "config", "user.email", "taxi@example.com"], repo);
  sh(["git", "config", "user.name", "Hatch"], repo);
  writeFileSync(join(repo, "file.txt"), "base\n", "utf8");
  sh(["git", "add", "file.txt"], repo);
  sh(["git", "commit", "-m", "base"], repo);
  return repo;
}

test("buildConflictPacket emits push_failure aliases for push recovery handoff", () => {
  const repo = initRepo();
  sh(["git", "checkout", "-b", "wave/1"], repo);
  writeFileSync(join(repo, "extra.txt"), "new\n", "utf8");
  sh(["git", "add", "extra.txt"], repo);
  sh(["git", "commit", "-m", "feat"], repo);
  sh(["git", "checkout", "main"], repo);

  const out = buildConflictPacket({
    repo,
    branch: "wave/1",
    issueNumber: "205",
    mergeStderr: "fatal: Not possible to fast-forward, aborting.",
    factoryId: "example-trading",
    runId: "run-push-123",
    pipeline: "goal_execute",
    nodeId: "build_push_failure_packet",
    targetRepo: "example-org/example-trading",
    controlPlaneRepo: "recallnet/astrochicken",
  });

  assert.equal(out.conflict_packet_path, out.push_failure_packet_path);
  assert.equal(out.conflict_packet_id, out.push_failure_packet_id);
  assert.equal(out.conflict_packet_schema_version, out.push_failure_packet_schema_version);
  assert.equal(out.conflict_packet_storage_class, out.push_failure_packet_storage_class);
  assert.match(out.push_failure_packet_path, /\.hatch\/example-trading\/runs\/run-push-123\/packets\/merge_conflict_packet\//);
});
