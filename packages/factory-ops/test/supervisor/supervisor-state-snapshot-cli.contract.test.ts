import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../..");
const supervisorCliPath = join(repoRoot, "packages/factory-ops/src/cli/commands/supervisor.ts");
const opsCliPath = join(repoRoot, "packages/factory-ops/src/cli.ts");

test("supervisor state-snapshot CLI wiring includes rollout targeting flags", () => {
  const source = readFileSync(supervisorCliPath, "utf8");
  assert.match(source, /class SupervisorStateSnapshotCommand/);
  assert.match(source, /SupervisorStateSnapshotCommand[\s\S]*static paths = \[\["supervisor", "state-snapshot"\]\]/);
  assert.match(source, /SupervisorStateSnapshotCommand[\s\S]*Option\.String\("--runs-dir", ""\)/);
  assert.match(source, /SupervisorStateSnapshotCommand[\s\S]*Option\.String\("--registry-path", ""\)/);
  assert.match(source, /SupervisorStateSnapshotCommand[\s\S]*Option\.String\("--policy-path", ""\)/);
  assert.match(source, /SupervisorStateSnapshotCommand[\s\S]*Option\.String\("--policy-json", ""\)/);
  assert.match(source, /SupervisorStateSnapshotCommand[\s\S]*Option\.String\("--manifest-path", ""\)/);
  assert.match(source, /SupervisorStateSnapshotCommand[\s\S]*Option\.String\("--manifest-ref", ""\)/);
  assert.match(source, /SupervisorStateSnapshotCommand[\s\S]*Option\.String\("--manifest-fetch-cmd", ""\)/);
  assert.match(source, /SupervisorStateSnapshotCommand[\s\S]*Option\.Boolean\("--skip-recovery-sweep", false\)/);
  assert.match(source, /SupervisorActionItemGateCommand[\s\S]*Option\.String\("--runs-dir", ""\)/);
  assert.match(source, /SupervisorActionItemGateCommand[\s\S]*Option\.Boolean\("--skip-recovery-sweep", false\)/);
});

test("hatch-ops supervisor state-snapshot --help lists rollout targeting flags", () => {
  const run = spawnSync("node", [opsCliPath, "supervisor", "state-snapshot", "--help"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const output = `${run.stdout || ""}\n${run.stderr || ""}`;
  assert.match(output, /--registry-path/);
  assert.match(output, /--policy-path/);
  assert.match(output, /--policy-json/);
  assert.match(output, /--manifest-path/);
  assert.match(output, /--manifest-ref/);
  assert.match(output, /--manifest-fetch-cmd/);
  assert.match(output, /--skip-recovery-sweep/);
  assert.match(output, /--runs-dir/);
});

test("supervisor state-snapshot defaults to factory-scoped runs dir when factory-id is set", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "supervisor-state-snapshot-cli-"));
  const runsDir = join(tempRoot, ".hatch", "alpha", "runs");
  const fallbackDir = join(runsDir, "run-1", "fallback_defects");
  const ghBinDir = join(tempRoot, "bin");
  const ghPath = join(ghBinDir, "gh");
  mkdirSync(fallbackDir, { recursive: true });
  mkdirSync(ghBinDir, { recursive: true });
  writeFileSync(join(fallbackDir, "fallback_defect_test.json"), `${JSON.stringify({
    schema: "fallback_defect/v1",
    fallback_node: "normalize_features",
    pipeline: "goal_intake_decompose",
    run_id: "run-1",
    trigger_reason: "feature_count_zero_after_normalize",
    classification: "pipeline_transport_defect",
    severity: "high",
    emitted_at: "2026-03-10T00:00:00.000Z",
    contradiction: {
      approved: true,
      decompose_parse_status: "valid_json",
      pre_normalize_feature_count: 3,
      post_normalize_feature_count: 0,
      issues_created: 0,
    },
    evidence: {
      goal_issue: 123,
    },
  }, null, 2)}\n`, "utf8");
  writeFileSync(ghPath, `#!/usr/bin/env bash
set -euo pipefail
printf '%s' '[]'
`, "utf8");
  chmodSync(ghPath, 0o755);

  try {
    const run = spawnSync("node", [
      opsCliPath,
      "supervisor",
      "state-snapshot",
      "--repo", "recallnet/astrochicken",
      "--factory-id", "alpha",
      "--target-repo", "recallnet/astrochicken",
      "--control-plane-repo", "recallnet/astrochicken",
      "--skip-recovery-sweep",
    ], {
      cwd: tempRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${ghBinDir}:${process.env.PATH || ""}`,
      },
    });

    assert.equal(run.status, 0, run.stderr || run.stdout);
    const out = JSON.parse(String(run.stdout || "{}"));
    const fallbackItems = (out.action_items || []).filter((item) => String(item?.type || "") === "fallback_defect");
    assert.equal(fallbackItems.length, 1);
    assert.equal(out.action_items.length, 1);
    assert.equal(out.action_items[0]?.source_run, "run-1");
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("supervisor state-snapshot fails closed when gh issue reads time out", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "supervisor-state-snapshot-timeout-"));
  const ghBinDir = join(tempRoot, "bin");
  const ghPath = join(ghBinDir, "gh");
  mkdirSync(ghBinDir, { recursive: true });
  writeFileSync(ghPath, `#!/usr/bin/env bash
set -euo pipefail
sleep 10
printf '%s' '[]'
`, "utf8");
  chmodSync(ghPath, 0o755);

  try {
    const run = spawnSync("node", [
      opsCliPath,
      "supervisor",
      "state-snapshot",
      "--repo", "recallnet/astrochicken",
      "--factory-id", "alpha",
      "--target-repo", "recallnet/astrochicken",
      "--control-plane-repo", "recallnet/astrochicken",
      "--runs-dir", join(tempRoot, ".hatch", "alpha", "runs"),
    ], {
      cwd: tempRoot,
      encoding: "utf8",
      timeout: 15000,
      env: {
        ...process.env,
        PATH: `${ghBinDir}:${process.env.PATH || ""}`,
        HATCH_GH_TIMEOUT_MS: "200",
      },
    });

    assert.notEqual(run.error?.code, "ETIMEDOUT", `snapshot CLI hung instead of failing closed:\n${run.stderr || run.stdout}`);
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const out = JSON.parse(String(run.stdout || "{}"));
    assert.ok(
      Array.isArray(out.snapshot_errors)
      && out.snapshot_errors.some((entry) => String(entry || "").includes("timed out")),
      JSON.stringify(out, null, 2),
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
