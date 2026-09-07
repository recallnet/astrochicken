import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { researchStatus } from "../../src/commands/research-status.ts";

function writeRun(runsDir, runId, state) {
  const dir = join(runsDir, runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "state.json"), JSON.stringify(state, null, 2));
}

test("researchStatus returns structured status for latest hypothesis run", () => {
  const root = mkdtempSync(join(tmpdir(), "research-status-"));
  const runsDir = join(root, "runs");
  mkdirSync(runsDir, { recursive: true });

  try {
    writeRun(runsDir, "run-old", {
      runId: "run-old",
      status: "running",
      currentNode: "stage3_gate",
      startedAt: "2026-03-11T16:00:00.000Z",
      context: {
        hypothesis_id: "hyp-001",
        stage_feature_engineering_eda_status: "pass",
      },
    });

    writeRun(runsDir, "run-new", {
      runId: "run-new",
      status: "running",
      currentNode: "approval_pending_terminal",
      startedAt: "2026-03-11T16:05:00.000Z",
      context: {
        hypothesis_id: "hyp-001",
        current_stage: "backtesting",
        pending_stage_id: "backtesting",
        approval_state: "pending",
        stage_hypothesis_formulation_status: "pass",
        stage_data_infrastructure_status: "pass",
        stage_feature_engineering_eda_status: "pass",
        stage_strategy_design_status: "pass",
        stage_backtesting_status: "pending",
        stage_hypothesis_formulation_artifact_ref: "research/hyp-hyp-001/hypothesis_formulation.md",
        stage_data_infrastructure_artifact_ref: "research/hyp-hyp-001/data_infrastructure.md",
        stage_feature_engineering_eda_artifact_ref: "research/hyp-hyp-001/feature_engineering_eda.md",
        stage_strategy_design_artifact_ref: "research/hyp-hyp-001/strategy_design.md",
        stage_backtesting_artifact_ref: "research/hyp-hyp-001/backtesting.md",
      },
    });

    writeRun(runsDir, "run-other", {
      runId: "run-other",
      status: "completed",
      currentNode: "done",
      startedAt: "2026-03-11T16:10:00.000Z",
      context: {
        hypothesis_id: "hyp-other",
      },
    });

    const out = researchStatus({ hypothesisId: "hyp-001", runsDir });
    assert.equal(out.ok, true);
    assert.equal(out.hypothesis_id, "hyp-001");
    assert.equal(out.latest_run_id, "run-new");
    assert.equal(out.run_status, "running");
    assert.equal(out.current_stage, "backtesting");
    assert.equal(out.source, "run_state");
    assert.equal(out.approval_pending, true);
    assert.equal(out.approval_pending_stage, "backtesting");
    assert.equal(out.stage_status.hypothesis_formulation, "pass");
    assert.equal(out.stage_status.data_infrastructure, "pass");
    assert.equal(out.stage_status.backtesting, "pending");
    assert.equal(out.artifact_refs.backtesting, "research/hyp-hyp-001/backtesting.md");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("researchStatus returns no_runs_found for unknown hypothesis", () => {
  const root = mkdtempSync(join(tmpdir(), "research-status-empty-"));
  const runsDir = join(root, "runs");
  mkdirSync(runsDir, { recursive: true });

  try {
    writeRun(runsDir, "run-1", {
      runId: "run-1",
      status: "completed",
      currentNode: "done",
      startedAt: "2026-03-11T16:00:00.000Z",
      context: {
        hypothesis_id: "hyp-abc",
      },
    });

    const out = researchStatus({ hypothesisId: "unknown-hyp", runsDir });
    assert.equal(out.ok, false);
    assert.equal(out.error, "no_runs_found");
    assert.equal(out.hypothesis_id, "unknown-hyp");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("researchStatus github mode returns github_label stage when present", () => {
  const root = mkdtempSync(join(tmpdir(), "research-status-github-"));
  const binDir = join(root, "bin");
  const ghPath = join(binDir, "gh");
  mkdirSync(binDir, { recursive: true });
  writeFileSync(ghPath, `#!/usr/bin/env node\nconst args = process.argv.slice(2);\nif (args[0] === \"issue\" && args[1] === \"view\") {\n  process.stdout.write(JSON.stringify({ labels: [{ name: \"research:stage/verification_red_team\" }] }));\n  process.exit(0);\n}\nprocess.exit(1);\n`);
  chmodSync(ghPath, 0o755);

  const previousPath = process.env.PATH || "";
  process.env.PATH = `${binDir}:${previousPath}`;
  try {
    const out = researchStatus({
      hypothesisId: "hyp-001",
      repo: "example-org/example-research",
      hypothesisIssue: "1",
      useGithub: true,
    });
    assert.equal(out.ok, true);
    assert.equal(out.stage, "verification_red_team");
    assert.equal(out.source, "github_label");
  } finally {
    process.env.PATH = previousPath;
    rmSync(root, { recursive: true, force: true });
  }
});

test("researchStatus github mode returns unknown source when no stage label and no runs", () => {
  const root = mkdtempSync(join(tmpdir(), "research-status-github-none-"));
  const binDir = join(root, "bin");
  const ghPath = join(binDir, "gh");
  mkdirSync(binDir, { recursive: true });
  writeFileSync(ghPath, `#!/usr/bin/env node\nconst args = process.argv.slice(2);\nif (args[0] === \"issue\" && args[1] === \"view\") {\n  process.stdout.write(JSON.stringify({ labels: [{ name: \"ready\" }] }));\n  process.exit(0);\n}\nprocess.exit(1);\n`);
  chmodSync(ghPath, 0o755);

  const previousPath = process.env.PATH || "";
  process.env.PATH = `${binDir}:${previousPath}`;
  try {
    const out = researchStatus({
      hypothesisId: "hyp-001",
      repo: "example-org/example-research",
      hypothesisIssue: "1",
      useGithub: true,
      runsDir: join(root, "runs-does-not-exist"),
    });
    assert.equal(out.ok, true);
    assert.equal(out.stage, null);
    assert.equal(out.source, "unknown");
  } finally {
    process.env.PATH = previousPath;
    rmSync(root, { recursive: true, force: true });
  }
});
