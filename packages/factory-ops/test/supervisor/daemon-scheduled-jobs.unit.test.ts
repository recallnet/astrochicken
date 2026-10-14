import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { afterEach } from "node:test";

import { resolveScheduledJobs } from "../../src/lib/daemon-schedules.ts";
import { runScheduledJobs } from "../../src/lib/daemon-scheduled-jobs.ts";

import { loadGraphSemanticsText } from "@hatch/factory-core/graph-source-loader";

const tempDirs = [];

function makeTmpDir(prefix = "daemon-scheduled-jobs-") {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function createDailyLensRuntimeConfig(overrides = {}) {
  return {
    factoryId: "mothership",
    controlPlaneRepo: "recallnet/astrochicken",
    runsDir: "/var/tmp/mothership-runs",
    contextRepoPath: "/path/to/astrochicken",
    config: {
      schedules: {
        jobs: [{
          id: "daily-lens",
          type: "graph",
          graph: "factories/mothership/workflows/daily-reporting/daily_lens_publish.workflow-source.mjs",
          cron: "30 8 * * *",
          time_zone: "America/Denver",
          catch_up: true,
          report_window_hours: 24,
          repo: "recallnet/astrochicken",
          output_dir: "reports/lens",
          notify_slack: true,
          issue_labels: ["daily-lens"],
        }],
      },
      slack_webhook_url: "${FACTORY_SLACK_WEBHOOK_URL}",
    },
    ...overrides,
  };
}

function createLegacyDailyLensRuntimeConfig(overrides = {}) {
  return createDailyLensRuntimeConfig({
    config: {
      schedules: {
        jobs: [{
          id: "daily-lens",
          type: "analysis.publish_lens",
          cron: "30 8 * * *",
          time_zone: "America/Denver",
          catch_up: true,
          report_window_hours: 24,
          repo: "recallnet/astrochicken",
          output_dir: "reports/lens",
          notify_slack: true,
          issue_labels: ["daily-lens"],
        }],
      },
      slack_webhook_url: "${FACTORY_SLACK_WEBHOOK_URL}",
    },
    ...overrides,
  });
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("daily-lens scheduled job metadata matches mothership contract", () => {
  const configPath = path.resolve(process.cwd(), "factories/mothership/factory.config.json");
  const config = readJson(configPath);
  const jobs = resolveScheduledJobs(config);
  const dailyLens = jobs.find((job) => job.id === "daily-lens");

  assert.ok(dailyLens, "expected daily-lens job in mothership schedule config");
  assert.equal(dailyLens.type, "graph");
  assert.equal(dailyLens.graph, "factories/mothership/workflows/daily-reporting/daily_lens_publish.workflow-source.mjs");
  assert.equal(dailyLens.cron, "30 9 * * *");
  assert.equal(dailyLens.time_zone, "America/Denver");
  assert.equal(dailyLens.catch_up, true);
  assert.equal(dailyLens.report_window_hours, 24);
  assert.equal(dailyLens.repo, "recallnet/astrochicken");
  assert.equal(dailyLens.output_dir, "reports/lens");
  assert.equal(dailyLens.notify_slack, true);
  assert.deepEqual(dailyLens.issue_labels, ["daily-lens"]);
});

test("daily-release-report scheduled job metadata matches mothership contract", () => {
  const configPath = path.resolve(process.cwd(), "factories/mothership/factory.config.json");
  const config = readJson(configPath);
  const jobs = resolveScheduledJobs(config);
  const dailyRelease = jobs.find((job) => job.id === "daily-release-report");

  assert.ok(dailyRelease, "expected daily-release-report job in mothership schedule config");
  assert.equal(dailyRelease.type, "graph");
  assert.equal(dailyRelease.graph, "factories/mothership/workflows/daily-reporting/daily_release_report.workflow-source.mjs");
  assert.equal(dailyRelease.cron, "30 14 * * *");
  assert.equal(dailyRelease.time_zone, "America/Denver");
  assert.equal(dailyRelease.catch_up, false);
  assert.equal(dailyRelease.repo, "recallnet/astrochicken");
  assert.equal(dailyRelease.notify_slack, true);
  assert.deepEqual(dailyRelease.issue_labels, ["daily-release-report"]);
});

test("daily-release-report scheduled graph wires release_report_flow as pipeline", () => {
  const graphSource = readFileSync(
    path.resolve(process.cwd(), "factories/mothership/graphs/daily_release_report.dot"),
    "utf8",
  );
  assert.match(graphSource, /pipeline="packages\/capability-release-reporting\/workflows\/release_report_flow\/release_report_flow\.workflow-source\.mjs"/);
  assert.match(graphSource, /inherit_context="true"/);
  assert.match(graphSource, /set_repo/);
  assert.match(graphSource, /set_factory_id/);
  assert.match(graphSource, /set_repo_path/);
  assert.match(graphSource, /set_release_reporting_repo/);
  assert.match(graphSource, /run_release_report_flow/);
  assert.match(graphSource, /trust_domain="mothership\.local"/);
});

test("daily-lens scheduler path stays wired to generic graph execution", () => {
  const schedulerSource = readFileSync(
    path.resolve(process.cwd(), "packages/factory-ops/src/lib/daemon-scheduled-jobs.ts"),
    "utf8",
  );
  assert.match(schedulerSource, /runScheduledGraph/);
  assert.doesNotMatch(schedulerSource, /\.\.\/commands\/analysis\/publish-lens\.mjs/);
});

test("daily-lens scheduled graph remains manifest-guided and agent-runtime driven", () => {
  const graphSource = loadGraphSemanticsText(
    path.resolve(process.cwd(), "factories/mothership/workflows/daily-reporting/daily_lens_publish.workflow-source.mjs"),
  );

  assert.match(graphSource, /prepare_daily_lens \[type="tool" governance="irreversible" action_runtime="in_process" action_id="daily_lens\.prepare"/);
  assert.match(graphSource, /bundle_manifest_path/);
  assert.match(graphSource, /analyze_daily_lens \[class="knowledge_worker"/);
  assert.match(graphSource, /finalize_daily_lens \[type="tool" governance="irreversible" action_runtime="in_process" action_id="daily_lens\.finalize"/);
  assert.match(graphSource, /action_agent_result_json="\$\{daily_lens_agent_result\}"/);
  assert.doesNotMatch(graphSource, /hatch-ops analysis lens --/);
});

test("runScheduledJobs invokes scheduled graph with slot-aligned trailing 24h window context", async () => {
  const root = makeTmpDir();
  const scheduledJobsStatePath = path.join(root, "scheduled-jobs-state.json");
  const daemonLogPath = path.join(root, "daemon.log");
  const calls = [];

  const result = await runScheduledJobs({
    runtime: createDailyLensRuntimeConfig(),
    paths: { scheduledJobsStatePath },
    now: new Date("2026-03-15T14:34:00.000Z"),
    daemonLogPath,
    appendLogLineFn: () => {},
    runScheduledGraphFn: async (options) => {
      calls.push(options);
      return {
        runId: "daily-lens-run-1",
        context: {
          scheduled_job_issue_url: "https://github.com/recallnet/astrochicken/issues/2148",
        },
      };
    },
  });

  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.equal(call.job.id, "daily-lens");
  assert.equal(call.job.type, "graph");
  assert.equal(call.job.graph, "factories/mothership/workflows/daily-reporting/daily_lens_publish.workflow-source.mjs");
  assert.equal(call.context.date, "2026-03-15");
  assert.equal(call.context.repo, "recallnet/astrochicken");
  assert.equal(call.context.output_dir, "reports/lens");
  assert.equal(call.context.runs_dir, "/var/tmp/mothership-runs");
  assert.equal(call.context.repo_path, "/path/to/astrochicken");
  assert.equal(call.context.scheduled_job_id, "daily-lens");
  assert.equal(call.context.scheduled_job_type, "graph");
  assert.equal(call.context.window_end, "2026-03-15T14:30:00.000Z");
  assert.equal(call.context.window_start, "2026-03-14T14:30:00.000Z");
  assert.equal(call.context.notify_slack, "true");
  assert.equal(call.context.issue_labels_json, "[\"daily-lens\"]");
  assert.equal(call.context.report_window_hours, "24");

  assert.equal(result.executed.length, 1);
  assert.equal(result.executed[0].status, "ok");
  assert.equal(result.executed[0].run_id, "daily-lens-run-1");
  assert.equal(result.due_count, 1);

  const state = readJson(scheduledJobsStatePath);
  const jobState = state.jobs["daily-lens"];
  assert.equal(jobState.last_status, "ok");
  assert.equal(jobState.last_issue_url, "https://github.com/recallnet/astrochicken/issues/2148");
  assert.equal(jobState.last_run_id, "daily-lens-run-1");
});

test("runScheduledJobs records graph runner non-zero exit failures in scheduled job state", async () => {
  const root = makeTmpDir();
  const scheduledJobsStatePath = path.join(root, "scheduled-jobs-state.json");
  const daemonLogPath = path.join(root, "daemon.log");
  const logs = [];

  const result = await runScheduledJobs({
    runtime: createDailyLensRuntimeConfig(),
    paths: { scheduledJobsStatePath },
    now: new Date("2026-03-15T14:34:00.000Z"),
    daemonLogPath,
    appendLogLineFn: (_filePath, line) => {
      logs.push(line);
    },
    runScheduledGraphFn: async () => ({
      runId: "daily-lens-run-2",
      exitCode: 1,
      context: {
        scheduled_job_issue_url: "https://github.com/recallnet/astrochicken/issues/2149",
      },
    }),
  });

  assert.equal(result.executed.length, 1);
  assert.equal(result.executed[0].status, "failed");
  assert.equal(result.executed[0].error_code, "scheduled_graph_exit_1");
  assert.equal(result.executed[0].error, "Graph run exited with code 1");
  assert.equal(result.executed[0].run_id, "daily-lens-run-2");
  assert.equal(result.due_count, 1);

  const state = readJson(scheduledJobsStatePath);
  const jobState = state.jobs["daily-lens"];
  assert.equal(jobState.last_status, "failed");
  assert.equal(jobState.last_error_code, "scheduled_graph_exit_1");
  assert.equal(jobState.last_error, "Graph run exited with code 1");
  assert.equal(typeof jobState.last_failed_at, "string");
  assert.equal(jobState.last_run_id, "daily-lens-run-2");

  assert.equal(
    logs.some(
      (line) =>
        line.includes("schedule_job_failed job=daily-lens")
        && line.includes("error_code=scheduled_graph_exit_1")
        && line.includes("exit_code=1"),
    ),
    true,
  );
});

test("runScheduledJobs records graph runner thrown failures in scheduled job state", async () => {
  const root = makeTmpDir();
  const scheduledJobsStatePath = path.join(root, "scheduled-jobs-state.json");
  const daemonLogPath = path.join(root, "daemon.log");
  const logs = [];

  const result = await runScheduledJobs({
    runtime: createDailyLensRuntimeConfig(),
    paths: { scheduledJobsStatePath },
    now: new Date("2026-03-15T14:34:00.000Z"),
    daemonLogPath,
    appendLogLineFn: (_filePath, line) => {
      logs.push(line);
    },
    runScheduledGraphFn: async () => {
      const error = new Error("graph run failed");
      error.code = "graph_run_failed";
      throw error;
    },
  });

  assert.equal(result.executed.length, 1);
  assert.equal(result.executed[0].status, "failed");
  assert.equal(result.executed[0].error_code, "graph_run_failed");
  assert.equal(result.due_count, 1);

  const state = readJson(scheduledJobsStatePath);
  const jobState = state.jobs["daily-lens"];
  assert.equal(jobState.last_status, "failed");
  assert.equal(jobState.last_error_code, "graph_run_failed");
  assert.equal(jobState.last_error, "graph run failed");
  assert.equal(typeof jobState.last_failed_at, "string");

  assert.equal(
    logs.some((line) => line.includes("schedule_job_failed job=daily-lens") && line.includes("error_code=graph_run_failed")),
    true,
  );
});
