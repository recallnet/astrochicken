import { useCanonicalEventStoreFixture } from "./factory-status-postgres-fixture.ts";

const eventStoreFixture = useCanonicalEventStoreFixture();

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resetFactoryBudget } from "../../src/commands/factory-reset-budget.ts";
import { factoryStatus } from "../../src/commands/factory-status.ts";

function writeJson(path, value) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
}

test("resetFactoryBudget enforces owner checks and resets only guard state", () => {
  const root = mkdtempSync(join(tmpdir(), "factory-guard-reset-"));
  try {
    const runsDir = join(root, ".hatch", "runs");
    const runId = "abc123";
    const statePath = join(runsDir, runId, "state.json");
    writeJson(statePath, {
      schemaVersion: 2,
      runId,
      pipelineFile: "docs/contracts/workflow-ir/mothership/wave_execute.dot",
      pid: 1,
      status: "guarded",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      currentNode: "find_ready_wave",
      lastOutput: "",
      context: {},
      completedNodes: [],
      activeChildren: {},
      locksHeld: [],
      records: [],
      guard: {
        policyRevision: "guard.v1",
        factoryScope: "intents",
        workerPeriod: "worker-a",
        counters: { tool_calls: 10, llm_calls: 5, review_retry_calls: 2, pipeline_transition_calls: 1 },
        factoryCounters: { tool_calls: 10, llm_calls: 5, review_retry_calls: 2, pipeline_transition_calls: 1 },
        circuitState: "open",
        reasonCode: "run_tool_budget_exceeded",
        overflowCount: 1,
        openedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        terminalAt: "",
        lastDecisionAt: new Date().toISOString(),
        lastDecisionType: "open",
        resetCount: 0,
        owner: { ownerId: "run:abc123", leaseName: "", leaseGeneration: 0 },
      },
    });

    const denied = resetFactoryBudget({ runId, runsDir, actorId: "run:other" });
    assert.equal(denied.ok, false);
    assert.equal(denied.reason, "owner_mismatch");

    const applied = resetFactoryBudget({ runId, runsDir, actorId: "run:abc123" });
    assert.equal(applied.ok, true);
    assert.equal(applied.reason, "reset_applied");
    assert.equal(applied.run_guard.circuitState, "closed");
    assert.equal(applied.run_guard.counters.tool_calls, 0);
    assert.equal(applied.factory_guard.counters.tool_calls, 0);

    const state = JSON.parse(readFileSync(statePath, "utf8"));
    assert.equal(state.guard.circuitState, "closed");
    assert.equal(state.guard.reasonCode, "guard_reset");
    assert.equal(state.guard.counters.llm_calls, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("factoryStatus treats suspended/guarded terminal states as failed terminal outcomes", async () => {
  const root = mkdtempSync(join(tmpdir(), "factory-guard-status-"));
  const runsDir = join(root, ".hatch", "runs");
  mkdirSync(join(runsDir, "r1"), { recursive: true });
  mkdirSync(join(runsDir, "r2"), { recursive: true });
  mkdirSync(join(runsDir, "r3"), { recursive: true });
  writeFileSync(join(runsDir, "r1", "state.json"), JSON.stringify({ runId: "r1", status: "guarded", context: {} }));
  writeFileSync(join(runsDir, "r2", "state.json"), JSON.stringify({ runId: "r2", status: "guarded_terminal", context: {} }));
  writeFileSync(join(runsDir, "r3", "state.json"), JSON.stringify({ runId: "r3", status: "suspended", context: {} }));

  await eventStoreFixture.seedRuns({ runsDir });
  const out = factoryStatus({ runsDir });
  assert.equal(out.failed, 3);
  assert.equal(out.active.length, 0);

  rmSync(root, { recursive: true, force: true });
});

test("resetFactoryBudget derives per-factory scope for legacy default-scoped runs", () => {
  const root = mkdtempSync(join(tmpdir(), "factory-guard-reset-derived-"));
  const previousCwd = process.cwd();
  try {
    process.chdir(root);
    const runsDir = join(root, ".hatch", "example-trading", "runs");
    const runId = "derived123";
    const statePath = join(runsDir, runId, "state.json");
    writeJson(statePath, {
      schemaVersion: 2,
      runId,
      pipelineFile: "/tmp/work/docs/contracts/workflow-ir/factory-runtime/managed_supervisor.dot",
      pid: 1,
      status: "guarded_terminal",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      currentNode: "run_managed_supervisor_shell",
      lastOutput: "",
      context: { factory_id: "example-trading" },
      completedNodes: [],
      activeChildren: {},
      locksHeld: [],
      records: [],
      guard: {
        policyRevision: "guard.v1",
        factoryScope: "default",
        workerPeriod: "default",
        counters: { tool_calls: 100003, llm_calls: 5, review_retry_calls: 2, pipeline_transition_calls: 1 },
        factoryCounters: { tool_calls: 100003, llm_calls: 5, review_retry_calls: 2, pipeline_transition_calls: 1 },
        circuitState: "terminal",
        reasonCode: "factory_tool_budget_exceeded",
        overflowCount: 4,
        openedAt: new Date().toISOString(),
        expiresAt: "",
        terminalAt: new Date().toISOString(),
        lastDecisionAt: new Date().toISOString(),
        lastDecisionType: "terminal",
        resetCount: 3,
        owner: { ownerId: "run:derived123", leaseName: "", leaseGeneration: 0 },
      },
    });

    const applied = resetFactoryBudget({ runId, runsDir, actorId: "run:derived123" });
    assert.equal(applied.ok, true);
    assert.equal(applied.scope, "example-trading");
    assert.equal(applied.worker_period, "default");

    const state = JSON.parse(readFileSync(statePath, "utf8"));
    assert.equal(state.guard.factoryScope, "example-trading");
    assert.equal(state.guard.workerPeriod, "default");

    const repairedPath = join(root, ".hatch", "guard", "example-trading.default.json");
    const legacyPath = join(root, ".hatch", "guard", "default.default.json");
    assert.equal(existsSync(repairedPath), true);
    assert.equal(existsSync(legacyPath), false);
  } finally {
    process.chdir(previousCwd);
    rmSync(root, { recursive: true, force: true });
  }
});
