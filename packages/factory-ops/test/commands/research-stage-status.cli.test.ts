import { spawnOpsCli } from "../helpers/ops-command-cli-fixture.ts";
import assert from "node:assert/strict";

import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

function writeRun(runsDir, runId, state) {
  const runPath = join(runsDir, runId);
  mkdirSync(runPath, { recursive: true });
  writeFileSync(join(runPath, "state.json"), JSON.stringify(state, null, 2));
}

function runCli(args = [], expectedStatus = 0, env = {}) {
  const out = spawnOpsCli([
      ...args
    ], {
      env: {
      ...process.env,
      ...env,
    }
    });
  assert.equal(out.status, expectedStatus, `stderr=${out.stderr}\nstdout=${out.stdout}`);
  const payload = JSON.parse(String(out.stdout || "{}").trim() || "{}");
  return payload;
}

test("research status CLI prints structured run-state hypothesis status and exits 0", () => {
  const root = mkdtempSync(join(tmpdir(), "research-status-cli-"));
  const runsDir = join(root, "runs");
  mkdirSync(runsDir, { recursive: true });

  try {
    writeRun(runsDir, "run-a", {
      runId: "run-a",
      status: "running",
      currentNode: "stage7_gate",
      startedAt: "2026-03-11T17:00:00.000Z",
      context: {
        hypothesis_id: "hyp-001",
        current_stage: "synthesis",
        stage_hypothesis_formulation_status: "pass",
        stage_synthesis_status: "pass",
        stage_synthesis_artifact_ref: "research/hyp-hyp-001/synthesis.md",
      },
    });

    const payload = runCli([
      "research",
      "status",
      "--hypothesis-id",
      "hyp-001",
      "--runs-dir",
      runsDir,
    ], 0);

    assert.equal(payload.ok, true);
    assert.equal(payload.hypothesis_id, "hyp-001");
    assert.equal(payload.latest_run_id, "run-a");
    assert.equal(payload.run_status, "running");
    assert.equal(payload.current_stage, "synthesis");
    assert.equal(payload.source, "run_state");
    assert.equal(typeof payload.approval_pending, "boolean");
    assert.ok(payload.stage_status && typeof payload.stage_status === "object");
    assert.ok(payload.artifact_refs && typeof payload.artifact_refs === "object");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("research status CLI exits 1 with no_runs_found for unknown hypothesis in run-state mode", () => {
  const root = mkdtempSync(join(tmpdir(), "research-status-cli-none-"));
  const runsDir = join(root, "runs");
  mkdirSync(runsDir, { recursive: true });

  try {
    writeRun(runsDir, "run-z", {
      runId: "run-z",
      status: "completed",
      currentNode: "done",
      startedAt: "2026-03-11T17:00:00.000Z",
      context: {
        hypothesis_id: "hyp-z",
      },
    });

    const payload = runCli([
      "research",
      "status",
      "--hypothesis-id",
      "unknown-hyp",
      "--runs-dir",
      runsDir,
    ], 1);

    assert.equal(payload.ok, false);
    assert.equal(payload.error, "no_runs_found");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("research status CLI in github mode reports github_label source", () => {
  const root = mkdtempSync(join(tmpdir(), "research-status-github-cli-"));
  const binDir = join(root, "bin");
  mkdirSync(binDir, { recursive: true });
  const ghPath = join(binDir, "gh");
  writeFileSync(ghPath, `#!/usr/bin/env node\nconst args = process.argv.slice(2);\nif (args[0] === \"issue\" && args[1] === \"view\") {\n  process.stdout.write(JSON.stringify({ labels: [{ name: \"research:stage/backtesting\" }] }));\n  process.exit(0);\n}\nprocess.exit(1);\n`);
  chmodSync(ghPath, 0o755);

  try {
    const payload = runCli([
      "research",
      "status",
      "--hypothesis-id",
      "hyp-001",
      "--repo",
      "example-org/example-research",
      "--hypothesis-issue",
      "1",
      "--use-github",
      "true",
    ], 0, {
      PATH: `${binDir}:${process.env.PATH || ""}`,
    });

    assert.equal(payload.ok, true);
    assert.equal(payload.stage, "backtesting");
    assert.equal(payload.source, "github_label");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("research status CLI in github mode reports unknown when label absent", () => {
  const root = mkdtempSync(join(tmpdir(), "research-status-github-cli-none-"));
  const binDir = join(root, "bin");
  mkdirSync(binDir, { recursive: true });
  const ghPath = join(binDir, "gh");
  writeFileSync(ghPath, `#!/usr/bin/env node\nconst args = process.argv.slice(2);\nif (args[0] === \"issue\" && args[1] === \"view\") {\n  process.stdout.write(JSON.stringify({ labels: [{ name: \"ready\" }] }));\n  process.exit(0);\n}\nprocess.exit(1);\n`);
  chmodSync(ghPath, 0o755);

  try {
    const payload = runCli([
      "research",
      "status",
      "--hypothesis-id",
      "hyp-001",
      "--repo",
      "example-org/example-research",
      "--hypothesis-issue",
      "1",
      "--use-github",
      "true",
    ], 0, {
      PATH: `${binDir}:${process.env.PATH || ""}`,
    });

    assert.equal(payload.ok, true);
    assert.equal(payload.stage, null);
    assert.equal(payload.source, "unknown");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
