import { spawnOpsCli } from "../helpers/ops-command-cli-fixture.ts";
import assert from "node:assert/strict";

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";


import { approveResearchStage } from "../../src/commands/research-approve-stage.ts";

function runCli(args = [], { expectedStatus } = {}) {
  const out = spawnOpsCli([
      ...args
    ]);
  if (expectedStatus !== undefined) {
    assert.equal(out.status, expectedStatus, `stderr=${out.stderr}\nstdout=${out.stdout}`);
  }
  const payload = JSON.parse(String(out.stdout || "{}").trim() || "{}");
  return { ...out, payload };
}

test("research approve-stage writes approval payload for approved=true", () => {
  const root = mkdtempSync(join(tmpdir(), "research-approve-stage-cli-"));
  try {
    const out = runCli([
      "research",
      "approve-stage",
      "--hypothesis-id",
      "hyp-001",
      "--stage",
      "hypothesis_formulation",
      "--approved",
      "true",
      "--approvals-dir",
      root,
    ], { expectedStatus: 0 });

    assert.equal(out.payload.ok, true);
    assert.equal(out.payload.hypothesis_id, "hyp-001");
    assert.equal(out.payload.stage, "hypothesis_formulation");
    assert.equal(out.payload.approved, true);
    assert.match(String(out.payload.timestamp), /^\d{4}-\d{2}-\d{2}T/);
    assert.match(String(out.payload.approval_path), /hyp-hyp-001-hypothesis_formulation\.json$/);

    const persisted = JSON.parse(readFileSync(out.payload.approval_path, "utf8"));
    assert.equal(persisted.approved, true);
    assert.equal(persisted.stage, "hypothesis_formulation");
    assert.equal(persisted.hypothesis_id, "hyp-001");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("research approve-stage persists approved=false", () => {
  const root = mkdtempSync(join(tmpdir(), "research-approve-stage-cli-false-"));
  try {
    const out = runCli([
      "research",
      "approve-stage",
      "--hypothesis-id",
      "hyp-001",
      "--stage",
      "backtesting",
      "--approved",
      "false",
      "--approvals-dir",
      root,
    ], { expectedStatus: 0 });

    assert.equal(out.payload.ok, true);
    assert.equal(out.payload.approved, false);

    const persisted = JSON.parse(readFileSync(out.payload.approval_path, "utf8"));
    assert.equal(persisted.approved, false);
    assert.equal(persisted.stage, "backtesting");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("research approve-stage rejects unsupported stage with valid_stages", () => {
  const out = runCli([
    "research",
    "approve-stage",
    "--hypothesis-id",
    "hyp-001",
    "--stage",
    "strategy_design",
    "--approved",
    "true",
  ], { expectedStatus: 1 });

  assert.equal(out.payload.ok, false);
  assert.equal(out.payload.error, "invalid_stage");
  assert.deepEqual(out.payload.valid_stages, [
    "hypothesis_formulation",
    "feature_engineering_eda",
    "backtesting",
    "verification_red_team",
  ]);
});

test("approveResearchStage export returns deterministic validation errors", () => {
  const missingHypothesis = approveResearchStage({
    hypothesisId: "",
    stage: "hypothesis_formulation",
    approved: "true",
  });
  assert.equal(missingHypothesis.ok, false);
  assert.equal(missingHypothesis.error, "missing_hypothesis_id");

  const invalidApproved = approveResearchStage({
    hypothesisId: "hyp-001",
    stage: "hypothesis_formulation",
    approved: "maybe",
  });
  assert.equal(invalidApproved.ok, false);
  assert.equal(invalidApproved.error, "invalid_approved");
});
