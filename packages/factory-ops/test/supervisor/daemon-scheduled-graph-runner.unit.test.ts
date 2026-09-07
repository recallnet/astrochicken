import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { afterEach } from "node:test";

import { runScheduledGraph } from "../../src/lib/daemon-scheduled-graph-runner.ts";

const tempDirs = [];

function makeTmpDir(prefix = "daemon-scheduled-graph-runner-") {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function createSpawnStub({
  stdoutChunks = [],
  stderrChunks = [],
  exitCode = 0,
  emitError = false,
} = {}) {
  const calls = [];

  const spawnImpl = (command, args, options) => {
    calls.push({ command, args, options });

    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();

    process.nextTick(() => {
      for (const chunk of stdoutChunks) {
        child.stdout.emit("data", Buffer.from(String(chunk), "utf8"));
      }
      for (const chunk of stderrChunks) {
        child.stderr.emit("data", Buffer.from(String(chunk), "utf8"));
      }
      if (emitError) {
        child.emit("error", new Error("spawn_failed"));
        return;
      }
      child.emit("exit", exitCode);
    });

    return child;
  };

  return { spawnImpl, calls };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runScheduledGraph invokes hatch graph runtime with live context and returns parsed run metadata", async () => {
  const root = makeTmpDir();
  const repoRoot = path.join(root, "repo");
  const logsDir = path.join(root, "logs");
  const runsDir = path.join(root, "runs");
  const hatchBin = path.join(repoRoot, "node_modules", ".bin", "hatch");

  mkdirSync(path.dirname(hatchBin), { recursive: true });
  mkdirSync(logsDir, { recursive: true });
  mkdirSync(path.join(runsDir, "daily-lens-run-4242"), { recursive: true });
  writeFileSync(hatchBin, "#!/usr/bin/env bash\n", "utf8");
  writeFileSync(path.join(runsDir, "daily-lens-run-4242", "state.json"), `${JSON.stringify({
    context: {
      scheduled_job_issue_url: "https://github.com/recallnet/astrochicken/issues/4242",
      repo: "recallnet/astrochicken",
    },
  }, null, 2)}\n`, "utf8");

  const context = {
    factory_id: "mothership",
    scheduled_job_id: "daily-lens",
    scheduled_job_type: "graph",
    date: "2026-03-15",
    repo: "recallnet/astrochicken",
  };

  const { spawnImpl, calls } = createSpawnStub({
    stdoutChunks: ["Run: daily-lens-run-4242\n", "tick complete\n"],
    exitCode: 0,
  });

  const logs = [];
  const out = await runScheduledGraph({
    runtime: {
      factoryId: "mothership",
      runsDir,
      factoryRoot: "factories/mothership",
      factoryConfigPath: "factories/mothership/factory.config.json",
      contextRepoPath: repoRoot,
      targetRepo: "recallnet/astrochicken",
      targetRepo: "recallnet/astrochicken",
    },
    job: {
      id: "daily-lens",
      graph: "factories/mothership/graphs/daily_lens_publish.dot",
    },
    context,
    paths: {
      logsDir,
      hostRoot: root,
      pidDir: path.join(root, "pid"),
      pidFile: path.join(root, "pid", "daemon.pid"),
      lockDir: path.join(root, "lock"),
      tmpDir: path.join(root, "tmp"),
      socketDir: path.join(root, "sockets"),
    },
    repoRoot,
    hostBaseDir: root,
    daemonLogPath: path.join(logsDir, "daemon.log"),
    appendLogLineFn: (_path, line) => logs.push(line),
    spawnImpl,
  });

  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.equal(call.command, hatchBin);
  assert.deepEqual(call.args, [
    "run",
    "factories/mothership/graphs/daily_lens_publish.dot",
    "--context",
    JSON.stringify(context),
    "--live",
  ]);
  assert.equal(call.options.cwd, repoRoot);

  assert.equal(out.exitCode, 0);
  assert.equal(out.runId, "daily-lens-run-4242");
  assert.equal(out.context.scheduled_job_issue_url, "https://github.com/recallnet/astrochicken/issues/4242");
  assert.equal(typeof out.startedAt, "string");
  assert.equal(typeof out.endedAt, "string");
  assert.equal(Number.isFinite(out.durationMs), true);

  const runLog = readFileSync(out.runLogPath, "utf8");
  assert.match(runLog, /Run:\s+daily-lens-run-4242/);
  assert.equal(
    logs.some((line) => line.includes("scheduled_graph_complete") && line.includes("run_id=daily-lens-run-4242") && line.includes("exit=0")),
    true,
  );
});

test("runScheduledGraph preserves non-zero exits for scheduler failure handling", async () => {
  const root = makeTmpDir();
  const logsDir = path.join(root, "logs");
  mkdirSync(logsDir, { recursive: true });

  const { spawnImpl } = createSpawnStub({
    stdoutChunks: ["Run: daily-lens-run-failed\n"],
    exitCode: 23,
  });

  const out = await runScheduledGraph({
    runtime: {
      factoryId: "mothership",
      runsDir: path.join(root, "runs"),
    },
    job: {
      id: "daily-lens",
      graph: "factories/mothership/graphs/daily_lens_publish.dot",
    },
    context: {},
    paths: {
      logsDir,
    },
    repoRoot: root,
    spawnImpl,
  });

  assert.equal(out.exitCode, 23);
  assert.equal(out.runId, "daily-lens-run-failed");
});

test("runScheduledGraph logs unknown run id when hatch output does not include Run line", async () => {
  const root = makeTmpDir();
  const logsDir = path.join(root, "logs");
  mkdirSync(logsDir, { recursive: true });

  const { spawnImpl } = createSpawnStub({
    stdoutChunks: ["no run id emitted\n"],
    stderrChunks: ["warning: parser fallback\n"],
    exitCode: 0,
  });

  const logs = [];
  const out = await runScheduledGraph({
    runtime: {
      factoryId: "mothership",
      runsDir: path.join(root, "runs"),
    },
    job: {
      id: "daily-lens",
      graph: "factories/mothership/graphs/daily_lens_publish.dot",
    },
    context: {},
    paths: {
      logsDir,
    },
    repoRoot: root,
    daemonLogPath: path.join(logsDir, "daemon.log"),
    appendLogLineFn: (_path, line) => logs.push(line),
    spawnImpl,
  });

  assert.equal(out.exitCode, 0);
  assert.equal(out.runId, "");
  assert.deepEqual(out.context, {});
  assert.equal(
    logs.some((line) => line.includes("scheduled_graph_complete") && line.includes("run_id=unknown") && line.includes("exit=0")),
    true,
  );
});
