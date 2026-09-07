import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const scriptPath = resolve("scripts/docs-check-benchmark-queries.mjs");

function runWithContract(content) {
  const root = mkdtempSync(join(tmpdir(), "docs-benchmark-queries-"));
  const contractDir = join(root, "docs", "contracts");
  mkdirSync(contractDir, { recursive: true });
  writeFileSync(join(contractDir, "langfuse-benchmark-queries.json"), `${JSON.stringify(content, null, 2)}\n`);

  return spawnSync("node", [scriptPath], {
    cwd: root,
    encoding: "utf8",
  });
}

const REQUIRED_QUERY_IDS = [
  "cost_per_skill",
  "cost_per_work_unit",
  "first_pass_rate",
  "retry_by_failure_class",
  "model_utilization",
  "cross_factory_benchmark",
  "prompt_version_comparison",
  "model_comparison",
  "latency_per_job",
];

function validEntries() {
  return REQUIRED_QUERY_IDS.map((queryId) => ({
    query_id: queryId,
    description: `desc ${queryId}`,
    filter: { metadata_key: "hatch.job_id" },
    group_by: ["hatch.job_id"],
    metrics: ["count"],
  }));
}

test("docs-check-benchmark-queries passes for full required query set", () => {
  const run = runWithContract(validEntries());
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /\[benchmark-queries\] ok: all required query entries present/);
});

test("docs-check-benchmark-queries fails when required query_id is missing", () => {
  const entries = validEntries().filter((entry) => entry.query_id !== "latency_per_job");
  const run = runWithContract(entries);

  assert.equal(run.status, 1);
  assert.match(run.stderr, /missing required query entries: latency_per_job/);
});
