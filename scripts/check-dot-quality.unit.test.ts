import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { shouldCheckDotPath } from "./check-dot-quality.ts";

test("shouldCheckDotPath excludes archived design-workspace artifacts", () => {
  assert.equal(
    shouldCheckDotPath("docs/skills/factory-design-workspace/iteration-1/coding-factory/with_skill/outputs/graphs/work_item_execute.dot"),
    false,
  );
});

test("shouldCheckDotPath excludes docs-owned generated workflow IR graphs", () => {
  assert.equal(
    shouldCheckDotPath("docs/contracts/workflow-ir/mothership/factory_supervisor_tick.dot"),
    false,
  );
});

test("shouldCheckDotPath keeps active code and factory graphs in scope", () => {
  assert.equal(shouldCheckDotPath("apps/hatch/examples/hello.dot"), true);
  assert.equal(shouldCheckDotPath("factories/mothership/graphs/write_scenarios.dot"), true);
});

test("shouldCheckDotPath excludes negative test fixtures", () => {
  assert.equal(shouldCheckDotPath("scripts/test/fixtures/dot-lint/legacy-compat.dot"), false);
});

test("shouldCheckDotPath excludes engine pipeline test fixtures", () => {
  assert.equal(shouldCheckDotPath("apps/hatch/src/pipeline/fixtures/transition-convergence/child-terminal-normalization.dot"), false);
  assert.equal(shouldCheckDotPath("apps/hatch/src/pipeline/fixtures/transition-convergence/edge-selection-order.dot"), false);
});

function runDotLint(source) {
  const tempDir = mkdtempSync(join(tmpdir(), "dot-quality-unit-"));
  const dotPath = join(tempDir, "fixture.dot");
  writeFileSync(dotPath, source, "utf8");

  return spawnSync("node", [resolve("scripts/dot-lint.mjs"), dotPath, "--compat-file", resolve("scripts/test/fixtures/dot-lint/compat-empty.json")], {
    encoding: "utf8",
  });
}

test("dot-lint fails telemetry.benchmark_identity_required for LLM class node missing benchmark_job_id", () => {
  const run = runDotLint(`digraph g {
  start [shape=Mdiamond]
  done [shape=Msquare]
  build [class="coder" label="Build" prompt_version="1.0" role_version="1.0" skill_id="issue_lifecycle"]
  start -> build -> done
}`);

  assert.equal(run.status, 1, run.stderr || run.stdout);
  const diagnostics = JSON.parse(String(run.stdout || "[]"));
  assert.equal(
    diagnostics.some((entry) => entry.rule_id === "telemetry.benchmark_identity_required"),
    true,
  );
});

test("dot-lint passes telemetry.benchmark_identity_required when LLM class node has benchmark_job_id", () => {
  const run = runDotLint(`digraph g {
  start [shape=Mdiamond]
  done [shape=Msquare]
  build [class="coder" label="Build" benchmark_job_id="goal.execute.issue.build" prompt_version="1.0" role_version="1.0" skill_id="issue_lifecycle"]
  start -> build -> done
}`);

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const diagnostics = JSON.parse(String(run.stdout || "[]"));
  assert.equal(
    diagnostics.some((entry) => entry.rule_id === "telemetry.benchmark_identity_required"),
    false,
  );
});

test("dot-lint does not apply telemetry.benchmark_identity_required to tool nodes with llm_model metadata", () => {
  const run = runDotLint(`digraph g {
  start [shape=Mdiamond]
  done [shape=Msquare]
  helper [type="tool" label="Helper" llm_model="gpt-5" output_key="helper_out" governance="reversible" prompt="printf 'ok'"]
  start -> helper -> done
}`);

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const diagnostics = JSON.parse(String(run.stdout || "[]"));
  assert.equal(
    diagnostics.some((entry) => entry.rule_id === "telemetry.benchmark_identity_required"),
    false,
  );
});
