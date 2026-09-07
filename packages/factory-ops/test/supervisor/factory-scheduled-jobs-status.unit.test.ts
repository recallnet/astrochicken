import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { afterEach } from "node:test";

import {
  factoryScheduledJobsStatus,
  formatFactoryScheduledJobsStatus,
} from "../../src/commands/factory-scheduled-jobs-status.ts";

const tempDirs = [];

function makeTmpDir(prefix = "factory-scheduled-jobs-status-") {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    rmSync(dir, { recursive: true, force: true });
  }
});

function loadConfigWithDailyLens() {
  return {
    config: {
      schedules: {
        jobs: [
          {
            id: "daily-lens",
            type: "graph",
            graph: "factories/mothership/graphs/daily_lens_publish.dot",
            cron: "30 8 * * *",
            time_zone: "America/Denver",
            catch_up: true,
            report_window_hours: 24,
            issue_labels: ["daily-lens"],
            notify_slack: true,
          },
        ],
      },
    },
  };
}

test("factoryScheduledJobsStatus merges config + persisted state and evaluates due slot", () => {
  const root = makeTmpDir();
  const statePath = path.join(root, "scheduled-jobs-state.json");
  writeFileSync(statePath, `${JSON.stringify({
    jobs: {
      "daily-lens": {
        last_scheduled_at: "2026-03-14T14:30:00.000Z",
        last_started_at: "2026-03-14T14:30:15.000Z",
        last_completed_at: "2026-03-14T14:32:00.000Z",
        last_status: "ok",
        last_issue_url: "https://github.com/recallnet/astrochicken/issues/2146",
        last_run_id: "daily-lens-run-2146",
      },
    },
  }, null, 2)}\n`);

  const out = factoryScheduledJobsStatus({
    context: {
      factory_id: "mothership",
      factory_root: "factories/mothership",
      factory_config_path: "factories/mothership/factory.config.json",
    },
    now: new Date("2026-03-15T14:34:00.000Z"),
    resolveDaemonPathsFn: () => ({ scheduledJobsStatePath: statePath }),
    loadFactoryConfigFn: () => loadConfigWithDailyLens(),
  });

  assert.equal(out.factory_id, "mothership");
  assert.equal(out.state_exists, true);
  assert.equal(out.state_status, "state_loaded");
  assert.equal(out.state_loaded_from, statePath);
  assert.equal(out.job_count, 1);

  const [job] = out.jobs;
  assert.equal(job.id, "daily-lens");
  assert.equal(job.last_status, "ok");
  assert.equal(job.last_started_at, "2026-03-14T14:30:15.000Z");
  assert.equal(job.last_completed_at, "2026-03-14T14:32:00.000Z");
  assert.equal(job.last_issue_url, "https://github.com/recallnet/astrochicken/issues/2146");
  assert.equal(job.last_run_id, "daily-lens-run-2146");
  assert.equal(job.type_label, "Daily Lens graph run");
  assert.equal(job.due.due, true);
  assert.equal(job.due.reason, "due");
  assert.equal(job.due.scheduled_at, "2026-03-15T14:30:00.000Z");
  assert.equal(job.due.scheduled_local_date, "2026-03-15");
});

test("formatFactoryScheduledJobsStatus renders daily lens graph run label and run id", () => {
  const status = {
    factory_id: "mothership",
    state_status: "state_loaded",
    state_loaded_from: "/tmp/scheduled-jobs-state.json",
    state_error: "",
    jobs: [
      {
        id: "daily-lens",
        type: "analysis.publish_lens",
        type_label: "Daily Lens graph run",
        time_zone: "America/Denver",
        last_status: "ok",
        last_started_at: "2026-03-15T14:30:05.000Z",
        last_completed_at: "2026-03-15T14:31:55.000Z",
        last_failed_at: "",
        last_run_id: "daily-lens-run-2147",
        due: {
          due: true,
          reason: "due",
          scheduled_at: "2026-03-16T14:30:00.000Z",
          scheduled_local_date: "2026-03-16",
        },
      },
    ],
  };

  const rendered = formatFactoryScheduledJobsStatus(status);
  assert.match(rendered, /Factory scheduled jobs status: mothership/);
  assert.match(rendered, /- daily-lens \(Daily Lens graph run\)/);
  assert.match(rendered, /next_local_slot: 2026-03-16T14:30:00\.000Z \(2026-03-16 America\/Denver\)/);
  assert.match(rendered, /due: yes \(due\)/);
  assert.match(rendered, /last_status: ok/);
  assert.match(rendered, /last_run_id: daily-lens-run-2147/);
  assert.doesNotMatch(rendered, /runAnalysisPublishLens|analysis\.publish_lens/);
});

test("factoryScheduledJobsStatus handles missing and malformed state files as empty state", () => {
  const root = makeTmpDir();
  const missingStatePath = path.join(root, "missing-scheduled-jobs-state.json");
  const malformedStatePath = path.join(root, "malformed-scheduled-jobs-state.json");
  writeFileSync(malformedStatePath, "{not-json\n", "utf8");

  const baseArgs = {
    context: {
      factory_id: "mothership",
      factory_root: "factories/mothership",
      factory_config_path: "factories/mothership/factory.config.json",
    },
    now: new Date("2026-03-15T14:34:00.000Z"),
    loadFactoryConfigFn: () => loadConfigWithDailyLens(),
  };

  const missing = factoryScheduledJobsStatus({
    ...baseArgs,
    resolveDaemonPathsFn: () => ({ scheduledJobsStatePath: missingStatePath }),
  });
  assert.equal(missing.state_exists, false);
  assert.equal(missing.state_status, "state_missing");
  assert.equal(missing.state_loaded_from, "");
  assert.equal(missing.jobs[0].last_status, "");
  assert.equal(missing.jobs[0].last_started_at, "");

  const malformed = factoryScheduledJobsStatus({
    ...baseArgs,
    resolveDaemonPathsFn: () => ({ scheduledJobsStatePath: malformedStatePath }),
  });
  assert.equal(malformed.state_exists, true);
  assert.equal(malformed.state_loaded_from, malformedStatePath);
  assert.equal(malformed.state_status, "state_malformed");
  assert.match(String(malformed.state_error || ""), /state_parse_error:/);
  assert.equal(malformed.jobs[0].last_status, "");
  assert.equal(malformed.jobs[0].last_started_at, "");
});
