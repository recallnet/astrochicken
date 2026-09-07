import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const configPath = join(repoRoot, "factories/example-trading/factory.config.json");
const managedDomainWorkflowDataPath = join(
  repoRoot,
  "packages/factory-runtime/workflows/managed_software_delivery_domain/managed_software_delivery_domain.workflow-source.data.json",
);
const managedDomainDotPath = join(
  repoRoot,
  "docs/contracts/workflow-ir/factory-runtime/managed_software_delivery_domain.dot",
);

test("example-trading decomposition budget matches wave capacity", () => {
  const config = JSON.parse(readFileSync(configPath, "utf8"));

  assert.equal(config.max_concurrent_waves, 4);
  assert.equal(
    config.max_goal_runs_per_tick,
    config.max_concurrent_waves,
    "example-trading should decompose up to its available wave capacity each tick",
  );
  assert.equal(config.max_goal_runs_per_tick, 4);
});

test("example-trading managed delivery domain fans out goals at the configured wave capacity", () => {
  const workflowData = JSON.parse(readFileSync(managedDomainWorkflowDataPath, "utf8"));
  const fanOutNode = workflowData.nodes.find((node) => node?.id === "fan_out_goal_run");

  assert.ok(fanOutNode, "managed delivery domain must define fan_out_goal_run");
  assert.equal(
    fanOutNode?.dotAttributes?.max_concurrency,
    "0",
    "goal-run fan-out must stay uncapped so the configured kept-goal limit owns per-factory throughput",
  );

  const dot = readFileSync(managedDomainDotPath, "utf8");
  assert.match(
    dot,
    /fan_out_goal_run\s*\[[\s\S]*max_concurrency="0"/,
    "published runtime DOT must leave goal fan-out uncapped and rely on the upstream kept-goal limit",
  );
});
