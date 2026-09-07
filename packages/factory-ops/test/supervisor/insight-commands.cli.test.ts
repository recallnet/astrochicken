import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import { buildCli } from "../../src/cli/index.ts";
import { INSIGHT_COMMAND_CONTRACT } from "../../src/cli/commands/insight.ts";

function isoHoursAgo(nowMs, hoursAgo) {
  return new Date(nowMs - (hoursAgo * 60 * 60 * 1000)).toISOString();
}

function writeRunState(runsDir, runId, state) {
  const runDir = join(runsDir, runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "state.json"), JSON.stringify({ runId, ...state }, null, 2));
}

function buildRecord({ nodeId, attempt, status, endedAt, durationMs, error = "" }) {
  return {
    nodeId,
    attempt,
    status,
    startedAt: endedAt,
    endedAt,
    outcome: {
      status,
      durationMs,
      ...(error ? { error } : {}),
    },
  };
}

function buildRunsFixture() {
  const root = mkdtempSync(join(tmpdir(), "factory-insight-commands-"));
  const runsDir = join(root, "runs");
  mkdirSync(runsDir, { recursive: true });

  const nowMs = Date.now();

  writeRunState(runsDir, "run-wave-recent", {
    pipelineFile: "factories/mothership/workflows/wave-execution/wave_issue_execute.workflow-source.mjs",
    pipeline: "factories/mothership/workflows/wave-execution/wave_issue_execute.workflow-source.mjs",
    status: "failed",
    currentNode: "build",
    startedAt: isoHoursAgo(nowMs, 1),
    updatedAt: isoHoursAgo(nowMs, 0.2),
    context: {
      issue_number: "1001",
      milestone_title: "goal-1001-wave-1",
    },
    records: [
      buildRecord({
        nodeId: "build",
        attempt: 2,
        status: "failed",
        endedAt: isoHoursAgo(nowMs, 0.5),
        durationMs: 1200,
        error: "Timeout while building issue 1001",
      }),
      buildRecord({
        nodeId: "build",
        attempt: 3,
        status: "failed",
        endedAt: isoHoursAgo(nowMs, 0.4),
        durationMs: 1800,
        error: "Timeout while building issue 1002",
      }),
      buildRecord({
        nodeId: "build",
        attempt: 2,
        status: "completed",
        endedAt: isoHoursAgo(nowMs, 0.3),
        durationMs: 2500,
      }),
      buildRecord({
        nodeId: "review",
        attempt: 2,
        status: "completed",
        endedAt: isoHoursAgo(nowMs, 0.2),
        durationMs: 900,
      }),
    ],
  });

  writeRunState(runsDir, "run-wave-baseline", {
    pipelineFile: "factories/mothership/workflows/wave-execution/wave_issue_execute.workflow-source.mjs",
    pipeline: "factories/mothership/workflows/wave-execution/wave_issue_execute.workflow-source.mjs",
    status: "completed",
    currentNode: "review",
    startedAt: isoHoursAgo(nowMs, 20),
    updatedAt: isoHoursAgo(nowMs, 17),
    context: {
      issue_number: "1002",
      milestone_title: "goal-1002-wave-1",
    },
    records: [
      buildRecord({
        nodeId: "build",
        attempt: 1,
        status: "completed",
        endedAt: isoHoursAgo(nowMs, 18),
        durationMs: 900,
      }),
      buildRecord({
        nodeId: "build",
        attempt: 1,
        status: "completed",
        endedAt: isoHoursAgo(nowMs, 17),
        durationMs: 1100,
      }),
      buildRecord({
        nodeId: "review",
        attempt: 1,
        status: "completed",
        endedAt: isoHoursAgo(nowMs, 18),
        durationMs: 700,
      }),
    ],
  });

  writeRunState(runsDir, "run-goal-fail", {
    pipelineFile: "factories/mothership/workflows/goal-execution/goal_issue_execute.workflow-source.mjs",
    pipeline: "factories/mothership/workflows/goal-execution/goal_issue_execute.workflow-source.mjs",
    status: "failed",
    currentNode: "lint",
    startedAt: isoHoursAgo(nowMs, 2),
    updatedAt: isoHoursAgo(nowMs, 0.6),
    context: {
      issue_number: "2001",
      milestone_title: "goal-2001",
    },
    records: [
      buildRecord({
        nodeId: "lint",
        attempt: 2,
        status: "failed",
        endedAt: isoHoursAgo(nowMs, 0.6),
        durationMs: 700,
        error: "Parse error in validator",
      }),
    ],
  });

  writeRunState(runsDir, "run-wave-old", {
    pipelineFile: "factories/mothership/workflows/wave-execution/wave_issue_execute.workflow-source.mjs",
    pipeline: "factories/mothership/workflows/wave-execution/wave_issue_execute.workflow-source.mjs",
    status: "failed",
    currentNode: "build",
    startedAt: isoHoursAgo(nowMs, 32),
    updatedAt: isoHoursAgo(nowMs, 30),
    context: {
      issue_number: "1003",
      milestone_title: "goal-1003-wave-1",
    },
    records: [
      buildRecord({
        nodeId: "build",
        attempt: 2,
        status: "failed",
        endedAt: isoHoursAgo(nowMs, 30),
        durationMs: 1400,
        error: "Timeout while building stale issue",
      }),
    ],
  });

  return { root, runsDir };
}

async function runCli(args) {
  const cli = buildCli();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let stdoutText = "";
  let stderrText = "";

  stdout.on("data", (chunk) => { stdoutText += chunk.toString(); });
  stderr.on("data", (chunk) => { stderrText += chunk.toString(); });

  const exitCode = await cli.run(args, {
    stdin: process.stdin,
    stdout,
    stderr,
  });

  return {
    exitCode,
    stdout: stdoutText,
    stderr: stderrText,
  };
}

test("insight command contract exports stable projection schema", () => {
  assert.equal(INSIGHT_COMMAND_CONTRACT.schema_version, "factory_insight_projection/v1");
  assert.equal(INSIGHT_COMMAND_CONTRACT.source_event_contract, "packages/factory-telemetry/src/events.ts#Event");
  assert.equal(INSIGHT_COMMAND_CONTRACT.projections.failure_signatures.event_name, "stage.error");
  assert.equal(INSIGHT_COMMAND_CONTRACT.projections.retry_hotspots.event_name, "stage.retry");
  assert.equal(INSIGHT_COMMAND_CONTRACT.projections.latency_drift.event_name, "stage.finish");
});

test("hatch-ops insight failures emits scoped JSON projection", async () => {
  const { runsDir } = buildRunsFixture();
  const result = await runCli([
    "insight",
    "failures",
    "--runs-dir",
    runsDir,
    "--lookback-hours",
    "2",
    "--top",
    "3",
    "--graph",
    "wave_issue_execute",
    "--node",
    "build",
    "--json",
  ]);

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout || "{}");

  assert.equal(payload.projection_type, "failure_signatures");
  assert.equal(payload.event_name, "stage.error");
  assert.equal(payload.filters.lookback_hours, 2);
  assert.equal(payload.total_signatures, 1, "old and non-wave failures should be excluded by filters");
  assert.equal(payload.total_failure_events, 2);
  assert.equal(payload.rows.length, 1);
  assert.equal(payload.rows[0].graph_id, "wave_issue_execute");
  assert.equal(payload.rows[0].node_name, "build");
  assert.equal(payload.rows[0].failure_count, 2);
  assert.equal(payload.rows[0].run_count, 1);
});

test("hatch-ops insight retries emits hotspot summary and top filter", async () => {
  const { runsDir } = buildRunsFixture();
  const result = await runCli([
    "insight",
    "retries",
    "--runs-dir",
    runsDir,
    "--lookback-hours",
    "24",
    "--top",
    "1",
    "--graph",
    "wave_issue_execute",
    "--json",
  ]);

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout || "{}");

  assert.equal(payload.projection_type, "retry_hotspots");
  assert.equal(payload.event_name, "stage.retry");
  assert.equal(payload.rows.length, 1, "--top should cap hotspot rows");
  assert.equal(payload.rows[0].graph_id, "wave_issue_execute");
  assert.equal(payload.rows[0].node_name, "build");
  assert.equal(payload.rows[0].retry_count, 3);
  assert.equal(payload.rows[0].max_attempt, 3);
  assert.equal(payload.rows[0].avg_attempt, 2.33);

  const human = await runCli([
    "insight",
    "retries",
    "--runs-dir",
    runsDir,
    "--lookback-hours",
    "24",
    "--top",
    "1",
    "--graph",
    "wave_issue_execute",
  ]);

  assert.equal(human.exitCode, 0, human.stderr);
  assert.match(human.stdout, /Retries\s+window=24h/);
  assert.match(human.stdout, /wave_issue_execute\/build\s+retries=3/);
});

test("hatch-ops insight latency measures p95 drift and human summary", async () => {
  const { runsDir } = buildRunsFixture();
  const result = await runCli([
    "insight",
    "latency",
    "--runs-dir",
    runsDir,
    "--lookback-hours",
    "24",
    "--graph",
    "wave_issue_execute",
    "--node",
    "build",
    "--json",
  ]);

  assert.equal(result.exitCode, 0, result.stderr);
  const payload = JSON.parse(result.stdout || "{}");

  assert.equal(payload.projection_type, "latency_drift");
  assert.equal(payload.event_name, "stage.finish");
  assert.equal(payload.rows.length, 1);
  assert.equal(payload.rows[0].baseline_sample_count, 2);
  assert.equal(payload.rows[0].recent_sample_count, 3);
  assert.equal(payload.rows[0].baseline_p95_ms, 1100);
  assert.equal(payload.rows[0].recent_p95_ms, 2500);
  assert.equal(payload.rows[0].p95_drift_ms, 1400);
  assert.equal(payload.rows[0].drift_direction, "increased");

  const human = await runCli([
    "insight",
    "latency",
    "--runs-dir",
    runsDir,
    "--lookback-hours",
    "24",
    "--graph",
    "wave_issue_execute",
    "--node",
    "build",
  ]);

  assert.equal(human.exitCode, 0, human.stderr);
  assert.match(human.stdout, /Latency\s+window=24h/);
  assert.match(human.stdout, /drift=\+1400ms \(increased\)/);
});
