/**
 * Contract test: supervisor tick graphs must be resilient to transient failures
 * in non-critical pipeline stages.
 *
 * Best-effort pipeline nodes (artifact ingestion, release reporting, managed
 * supervisor shells) must have fail_open="true" so transient failures (e.g.,
 * GitHub API rate limits) do not block the entire supervisor tick and trigger
 * the circuit breaker.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "..");

function readDotAttrs(dotContent, nodeId) {
  const pattern = new RegExp(`\\b${nodeId}\\b\\s*\\[([^\\]]+)\\]`, "s");
  const match = dotContent.match(pattern);
  if (!match) return {};
  const attrs = {};
  const raw = match[1];
  for (const m of raw.matchAll(/(\w+)\s*=\s*"([^"]*)"/g)) {
    attrs[m[1]] = m[2];
  }
  return attrs;
}

function assertFailOpen(dotPath, nodeId, reason) {
  const dot = readFileSync(dotPath, "utf8");
  const attrs = readDotAttrs(dot, nodeId);
  assert.ok(attrs.type, `${nodeId} node not found in ${dotPath}`);
  assert.equal(attrs.type, "pipeline", `${nodeId} must be type=pipeline`);
  assert.equal(attrs.fail_open, "true", `${nodeId} must be fail_open=true — ${reason}`);
}

// --- Mothership factory ---

const mothershipTickPath = join(repoRoot, "docs/contracts/workflow-ir/mothership/factory_supervisor_tick.dot");

test("mothership: artifact_ingest must be fail_open=true", () => {
  assertFailOpen(mothershipTickPath, "artifact_ingest",
    "best-effort artifact scan should not block the tick on transient GitHub API failures");
});

test("mothership: release report flow removed from supervisor tick (now daily scheduled job)", () => {
  const dot = readFileSync(mothershipTickPath, "utf8");
  assert.ok(!dot.includes("run_release_report_flow"),
    "run_release_report_flow must not be in supervisor tick — moved to daily_release_report scheduled graph");
});

// --- Managed factory supervisor shells ---

test("brainstorm: run_managed_supervisor_shell must be fail_open=true", () => {
  const path = join(repoRoot, "docs/contracts/workflow-ir/brainstorm/factory_supervisor_tick.dot");
  if (!existsSync(path)) {
    assert.fail(`brainstorm supervisor tick graph not found at ${path}`);
  }
  assertFailOpen(path, "run_managed_supervisor_shell",
    "managed supervisor shell is the outermost pipeline node — a transient failure " +
    "in any sub-stage should not trigger the circuit breaker and halt the factory");
});

test("example-trading binds the shared managed supervisor graph instead of a local tick wrapper", () => {
  const configPath = join(repoRoot, "factories/example-trading/factory.config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));

  assert.equal(existsSync(join(repoRoot, "factories/example-trading/graphs/factory_supervisor_tick.dot")), false);
  assert.equal(config.dispatch?.graph, "docs/contracts/workflow-ir/factory-runtime/managed_supervisor.dot");
  assert.equal(config.pipeline?.supervisor_tick, "docs/contracts/workflow-ir/factory-runtime/managed_supervisor.dot");
});

test("example-web binds the shared managed supervisor graph and removes local supervisor wrapper artifacts", () => {
  const configPath = join(repoRoot, "factories/example-web/factory.config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));

  assert.equal(config.dispatch?.graph, "docs/contracts/workflow-ir/factory-runtime/managed_supervisor.dot");
  assert.equal(config.pipeline?.supervisor_tick, "docs/contracts/workflow-ir/factory-runtime/managed_supervisor.dot");
  assert.equal(existsSync(join(repoRoot, "factories/example-web/graphs/factory_supervisor_tick.dot")), false);
  assert.equal(existsSync(join(repoRoot, "factories/example-web/graphs/factory_supervisor_tick.png")), false);
  assert.equal(existsSync(join(repoRoot, "factories/example-web/workflows/dispatch-control/factory_supervisor_tick.workflow-source.data.json")), false);
  assert.equal(existsSync(join(repoRoot, "factories/example-web/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs")), false);
});
