import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { EventEmitter } from "node:events";

import { runTick } from "../../src/lib/daemon-tick-runner.ts";

function makeTmpDir(prefix) {
  return path.join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

function writeRunState(runsDir, runId, context = {}) {
  const runDir = path.join(runsDir, runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(path.join(runDir, "state.json"), JSON.stringify({ context }, null, 2));
}

function createSpawnStub(callLog, outcomesByGraph) {
  return (_command, args) => {
    const graphPath = args[1];
    callLog.push({ graphPath, args });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killed = false;
    const outcome = outcomesByGraph[graphPath];
    queueMicrotask(() => {
      if (outcome?.stdout) child.stdout.emit("data", Buffer.from(outcome.stdout));
      if (outcome?.stderr) child.stderr.emit("data", Buffer.from(outcome.stderr));
      child.emit("exit", outcome?.exitCode ?? 0);
    });
    return child;
  };
}

test("runTick executes dispatch before maintenance when both graphs are configured", async () => {
  const repoRoot = makeTmpDir("daemon-tick-runner-order");
  const logsDir = path.join(repoRoot, "logs");
  const runsDir = path.join(repoRoot, ".hatch", "runs");
  mkdirSync(logsDir, { recursive: true });
  mkdirSync(runsDir, { recursive: true });

  writeRunState(runsDir, "dispatch-run", { tick_idle: false });
  writeRunState(runsDir, "maintenance-run", { tick_idle: true });

  const dispatchGraph = "factories/mothership/graphs/factory_dispatch_reactor.dot";
  const supervisorGraph = "docs/contracts/workflow-ir/mothership/factory_supervisor_tick.dot";
  const spawnCalls = [];

  const result = await runTick({
    runtime: {
      factoryId: "mothership",
      dispatchGraph,
      supervisorGraph,
      runsDir,
      contextRepoPath: repoRoot,
      targetRepo: "recallnet/astrochicken",
      targetRepo: "recallnet/astrochicken",
    },
    paths: { logsDir },
    repoRoot,
    hostBaseDir: repoRoot,
    activeChildRef: { current: null },
    daemonLogPath: path.join(logsDir, "daemon.log"),
    appendLogLineFn: () => {},
    spawnImpl: createSpawnStub(spawnCalls, {
      [dispatchGraph]: { stdout: "Run: dispatch-run\n", exitCode: 0 },
      [supervisorGraph]: { stdout: "Run: maintenance-run\n", exitCode: 0 },
    }),
  });

  assert.deepEqual(spawnCalls.map((entry) => entry.graphPath), [dispatchGraph, supervisorGraph]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.runId, "dispatch-run");
  assert.equal(result.tickIdle, false);
});

test("runTick skips maintenance when dispatch fails", async () => {
  const repoRoot = makeTmpDir("daemon-tick-runner-fail");
  const logsDir = path.join(repoRoot, "logs");
  const runsDir = path.join(repoRoot, ".hatch", "runs");
  mkdirSync(logsDir, { recursive: true });
  mkdirSync(runsDir, { recursive: true });

  const dispatchGraph = "factories/mothership/graphs/factory_dispatch_reactor.dot";
  const supervisorGraph = "docs/contracts/workflow-ir/mothership/factory_supervisor_tick.dot";
  const spawnCalls = [];

  const result = await runTick({
    runtime: {
      factoryId: "mothership",
      dispatchGraph,
      supervisorGraph,
      runsDir,
      contextRepoPath: repoRoot,
      targetRepo: "recallnet/astrochicken",
      targetRepo: "recallnet/astrochicken",
    },
    paths: { logsDir },
    repoRoot,
    hostBaseDir: repoRoot,
    activeChildRef: { current: null },
    daemonLogPath: path.join(logsDir, "daemon.log"),
    appendLogLineFn: () => {},
    spawnImpl: createSpawnStub(spawnCalls, {
      [dispatchGraph]: { stdout: "Run: dispatch-run\n", stderr: "dispatch failed\n", exitCode: 1 },
      [supervisorGraph]: { stdout: "Run: maintenance-run\n", exitCode: 0 },
    }),
  });

  assert.deepEqual(spawnCalls.map((entry) => entry.graphPath), [dispatchGraph]);
  assert.equal(result.exitCode, 1);
  assert.equal(result.runId, "dispatch-run");
});

test("runTick demotes maintenance when the maintenance interval is not due", async () => {
  const repoRoot = makeTmpDir("daemon-tick-runner-demoted-maintenance");
  const logsDir = path.join(repoRoot, "logs");
  const runsDir = path.join(repoRoot, ".hatch", "runs");
  mkdirSync(logsDir, { recursive: true });
  mkdirSync(runsDir, { recursive: true });
  mkdirSync(path.join(repoRoot, ".hatch", "factories", "mothership"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, ".hatch", "factories", "mothership", "maintenance-tick-state.json"),
    `${JSON.stringify({
      schema: "dispatch-latency-slo/v1",
      last_completed_at: "2026-03-21T18:00:00.000Z",
      last_run_id: "maintenance-run-1",
      last_tick_id: "tick-old",
    }, null, 2)}\n`,
  );

  writeRunState(runsDir, "dispatch-run", { tick_idle: false });

  const dispatchGraph = "factories/mothership/graphs/factory_dispatch_reactor.dot";
  const supervisorGraph = "docs/contracts/workflow-ir/mothership/factory_supervisor_tick.dot";
  const spawnCalls = [];
  const daemonLogs = [];

  const result = await runTick({
    runtime: {
      factoryId: "mothership",
      dispatchGraph,
      supervisorGraph,
      dispatchLatencySloSeconds: 15,
      maintenanceIntervalSeconds: 300,
      runsDir,
      contextRepoPath: repoRoot,
      targetRepo: "recallnet/astrochicken",
      targetRepo: "recallnet/astrochicken",
    },
    paths: { logsDir },
    repoRoot,
    hostBaseDir: repoRoot,
    activeChildRef: { current: null },
    daemonLogPath: path.join(logsDir, "daemon.log"),
    appendLogLineFn: (_path, line) => daemonLogs.push(line),
    nowMsFn: (() => {
      const values = [
        Date.parse("2026-03-21T18:03:00.000Z"),
        Date.parse("2026-03-21T18:03:00.000Z"),
        Date.parse("2026-03-21T18:03:02.000Z"),
        Date.parse("2026-03-21T18:03:02.000Z"),
        Date.parse("2026-03-21T18:03:02.000Z"),
      ];
      return () => values.shift() ?? Date.parse("2026-03-21T18:03:02.000Z");
    })(),
    spawnImpl: createSpawnStub(spawnCalls, {
      [dispatchGraph]: { stdout: "Run: dispatch-run\n", exitCode: 0 },
      [supervisorGraph]: { stdout: "Run: maintenance-run\n", exitCode: 0 },
    }),
  });

  assert.deepEqual(spawnCalls.map((entry) => entry.graphPath), [dispatchGraph]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.maintenanceDecision.reason, "maintenance_interval_not_elapsed");
  assert.equal(result.dispatchSlo.ok, true);
  assert.match(daemonLogs.join("\n"), /maintenance_tick_skipped reason=maintenance_interval_not_elapsed/);
});

test("runTick persists maintenance state when demoted maintenance does run", async () => {
  const repoRoot = makeTmpDir("daemon-tick-runner-maintenance-state");
  const logsDir = path.join(repoRoot, "logs");
  const runsDir = path.join(repoRoot, ".hatch", "runs");
  mkdirSync(logsDir, { recursive: true });
  mkdirSync(runsDir, { recursive: true });

  writeRunState(runsDir, "dispatch-run", { tick_idle: false });
  writeRunState(runsDir, "maintenance-run", { tick_idle: true });

  const dispatchGraph = "factories/mothership/graphs/factory_dispatch_reactor.dot";
  const supervisorGraph = "docs/contracts/workflow-ir/mothership/factory_supervisor_tick.dot";
  const spawnCalls = [];

  const result = await runTick({
    runtime: {
      factoryId: "mothership",
      dispatchGraph,
      supervisorGraph,
      dispatchLatencySloSeconds: 15,
      maintenanceIntervalSeconds: 300,
      runsDir,
      contextRepoPath: repoRoot,
      targetRepo: "recallnet/astrochicken",
      targetRepo: "recallnet/astrochicken",
    },
    paths: { logsDir },
    repoRoot,
    hostBaseDir: repoRoot,
    activeChildRef: { current: null },
    daemonLogPath: path.join(logsDir, "daemon.log"),
    appendLogLineFn: () => {},
    nowMsFn: (() => {
      const values = [
        Date.parse("2026-03-21T18:10:00.000Z"),
        Date.parse("2026-03-21T18:10:00.000Z"),
        Date.parse("2026-03-21T18:10:02.000Z"),
        Date.parse("2026-03-21T18:10:02.000Z"),
        Date.parse("2026-03-21T18:10:02.000Z"),
        Date.parse("2026-03-21T18:10:02.000Z"),
        Date.parse("2026-03-21T18:10:05.000Z"),
        Date.parse("2026-03-21T18:10:05.000Z"),
      ];
      return () => values.shift() ?? Date.parse("2026-03-21T18:10:05.000Z");
    })(),
    spawnImpl: createSpawnStub(spawnCalls, {
      [dispatchGraph]: { stdout: "Run: dispatch-run\n", exitCode: 0 },
      [supervisorGraph]: { stdout: "Run: maintenance-run\n", exitCode: 0 },
    }),
  });

  assert.deepEqual(spawnCalls.map((entry) => entry.graphPath), [dispatchGraph, supervisorGraph]);
  assert.equal(result.maintenanceDecision.due, true);
  const persisted = JSON.parse(
    readFileSync(path.join(repoRoot, ".hatch", "factories", "mothership", "maintenance-tick-state.json"), "utf8"),
  );
  assert.equal(persisted.schema, "dispatch-latency-slo/v1");
  assert.equal(persisted.last_run_id, "maintenance-run");
});

test("runTick passes factory root for shared managed graphs", async () => {
  const repoRoot = makeTmpDir("daemon-tick-runner-factory-root");
  const logsDir = path.join(repoRoot, "logs");
  const runsDir = path.join(repoRoot, ".hatch", "runs");
  mkdirSync(logsDir, { recursive: true });
  mkdirSync(runsDir, { recursive: true });

  writeRunState(runsDir, "dispatch-run", { tick_idle: false });

  const dispatchGraph = path.join(repoRoot, "docs/contracts/workflow-ir/factory-runtime/managed_supervisor.dot");
  const factoryRoot = path.join(repoRoot, "factories/example-trading");
  const spawnCalls = [];

  const result = await runTick({
    runtime: {
      factoryId: "example-trading",
      factoryRoot,
      dispatchGraph,
      supervisorGraph: dispatchGraph,
      runsDir,
      contextRepoPath: repoRoot,
      targetRepo: "example-org/example-trading",
      controlPlaneRepo: "recallnet/astrochicken",
    },
    paths: { logsDir },
    repoRoot,
    hostBaseDir: repoRoot,
    activeChildRef: { current: null },
    daemonLogPath: path.join(logsDir, "daemon.log"),
    appendLogLineFn: () => {},
    spawnImpl: createSpawnStub(spawnCalls, {
      [dispatchGraph]: { stdout: "Run: dispatch-run\n", exitCode: 0 },
    }),
  });

  assert.equal(result.exitCode, 0);
  assert.equal(spawnCalls.length, 1);
  assert.ok(spawnCalls[0].args.includes("--factory-root"));
  assert.equal(spawnCalls[0].args[spawnCalls[0].args.indexOf("--factory-root") + 1], factoryRoot);
});
