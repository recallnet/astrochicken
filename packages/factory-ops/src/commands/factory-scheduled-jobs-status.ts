import { existsSync, readFileSync } from "node:fs";

import { loadFactoryConfig } from "./factory-config-loader.ts";
import {
  evaluateScheduledJob,
  formatScheduledJobLocalDate,
  readScheduledJobsState,
  resolveScheduledJobs,
} from "../lib/daemon-schedules.ts";
import { resolveDaemonPaths } from "../lib/daemon.ts";

function trim(value = "") {
  return String(value ?? "").trim();
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => trim(entry)).filter(Boolean);
}

function resolveStateMetadata({
  statePath = "",
  readScheduledJobsStateFn = readScheduledJobsState,
  existsSyncFn = existsSync,
  readFileSyncFn = readFileSync,
} = {}) {
  const normalizedPath = trim(statePath);
  const stateExists = Boolean(normalizedPath) && existsSyncFn(normalizedPath);
  if (!stateExists) {
    return {
      state: { jobs: {} },
      state_exists: false,
      state_loaded_from: "",
      state_status: "state_missing",
      state_error: "",
    };
  }

  const state = readScheduledJobsStateFn(normalizedPath);

  try {
    const parsed = JSON.parse(readFileSyncFn(normalizedPath, "utf8"));
    const valid = isPlainObject(parsed) && isPlainObject(parsed.jobs);
    if (!valid) {
      return {
        state: { jobs: {} },
        state_exists: true,
        state_loaded_from: normalizedPath,
        state_status: "state_malformed",
        state_error: "state_malformed_payload",
      };
    }
  } catch (error) {
    return {
      state: { jobs: {} },
      state_exists: true,
      state_loaded_from: normalizedPath,
      state_status: "state_malformed",
      state_error: `state_parse_error:${trim(error?.message || error)}`,
    };
  }

  return {
    state,
    state_exists: true,
    state_loaded_from: normalizedPath,
    state_status: "state_loaded",
    state_error: "",
  };
}

function resolveScheduledJobLabel(job = {}) {
  const jobId = trim(job?.id);
  const jobType = trim(job?.type);
  if (jobId === "daily-lens" && (jobType === "graph" || jobType === "analysis.publish_lens")) {
    return "Daily Lens graph run";
  }
  return jobType || "unknown";
}

function buildScheduledJobRow({
  job = {},
  stateEntry = {},
  now = new Date(),
  evaluateScheduledJobFn = evaluateScheduledJob,
  formatScheduledJobLocalDateFn = formatScheduledJobLocalDate,
} = {}) {
  const evaluation = evaluateScheduledJobFn({ job, state: stateEntry, now });
  const timeZone = trim(job?.time_zone || job?.timeZone || "");
  const scheduledAt = trim(evaluation?.scheduled_at || "");

  return {
    id: trim(job?.id),
    type: trim(job?.type),
    type_label: resolveScheduledJobLabel(job),
    cron: trim(job?.cron),
    time_zone: timeZone,
    catch_up: job?.catch_up === true,
    enabled: job?.enabled !== false,
    notify_slack: job?.notify_slack === true,
    report_window_hours: Number.isFinite(Number(job?.report_window_hours))
      ? Number(job.report_window_hours)
      : null,
    output_dir: trim(job?.output_dir),
    repo: trim(job?.repo),
    issue_labels: normalizeStringArray(job?.issue_labels),
    last_scheduled_at: trim(stateEntry?.last_scheduled_at),
    last_started_at: trim(stateEntry?.last_started_at),
    last_completed_at: trim(stateEntry?.last_completed_at),
    last_failed_at: trim(stateEntry?.last_failed_at),
    last_status: trim(stateEntry?.last_status),
    last_message: trim(stateEntry?.last_message || stateEntry?.last_error),
    last_issue_url: trim(stateEntry?.last_issue_url),
    last_run_id: trim(stateEntry?.last_run_id),
    last_error: trim(stateEntry?.last_error),
    last_error_code: trim(stateEntry?.last_error_code),
    due: {
      due: Boolean(evaluation?.due),
      scheduled_at: scheduledAt,
      reason: trim(evaluation?.reason),
      scheduled_local_date: timeZone && scheduledAt
        ? formatScheduledJobLocalDateFn({ scheduledAt, timeZone })
        : "",
    },
    config: { ...job },
  };
}

export function factoryScheduledJobsStatus({
  context = {},
  now = new Date(),
  hostBaseDir = "",
  resolveDaemonPathsFn = resolveDaemonPaths,
  resolveScheduledJobsFn = resolveScheduledJobs,
  readScheduledJobsStateFn = readScheduledJobsState,
  evaluateScheduledJobFn = evaluateScheduledJob,
  formatScheduledJobLocalDateFn = formatScheduledJobLocalDate,
  loadFactoryConfigFn = loadFactoryConfig,
  existsSyncFn = existsSync,
  readFileSyncFn = readFileSync,
} = {}) {
  const factoryId = trim(context?.factory_id);
  if (!factoryId) throw new Error("factory_id_required");

  const nowDate = now instanceof Date ? new Date(now.getTime()) : new Date(String(now));
  const loaded = loadFactoryConfigFn({
    factoryRoot: trim(context?.factory_root),
    configPath: trim(context?.factory_config_path),
    requiredKeys: [],
  });

  const daemonPaths = resolveDaemonPathsFn({
    factoryId,
    hostBaseDir: trim(hostBaseDir),
  });

  const stateInfo = resolveStateMetadata({
    statePath: daemonPaths?.scheduledJobsStatePath,
    readScheduledJobsStateFn,
    existsSyncFn,
    readFileSyncFn,
  });

  const configuredJobs = resolveScheduledJobsFn(loaded?.config || {});
  const stateJobs = isPlainObject(stateInfo?.state?.jobs) ? stateInfo.state.jobs : {};
  const jobs = configuredJobs.map((job) => {
    const jobId = trim(job?.id);
    const stateEntry = isPlainObject(stateJobs[jobId]) ? stateJobs[jobId] : {};
    return buildScheduledJobRow({
      job,
      stateEntry,
      now: nowDate,
      evaluateScheduledJobFn,
      formatScheduledJobLocalDateFn,
    });
  });

  return {
    factory_id: factoryId,
    evaluated_at: nowDate.toISOString(),
    state_path: trim(daemonPaths?.scheduledJobsStatePath),
    state_exists: stateInfo.state_exists,
    state_loaded_from: stateInfo.state_loaded_from,
    state_status: stateInfo.state_status,
    state_error: stateInfo.state_error,
    job_count: jobs.length,
    jobs,
  };
}

function presentTimestamp(value = "") {
  const normalized = trim(value);
  return normalized || "never";
}

function presentSlot(job = {}) {
  const due = isPlainObject(job?.due) ? job.due : {};
  const scheduledAt = trim(due?.scheduled_at);
  if (!scheduledAt) return "none";

  const localDate = trim(due?.scheduled_local_date);
  const timeZone = trim(job?.time_zone);
  if (!localDate) return scheduledAt;
  if (!timeZone) return `${scheduledAt} (${localDate})`;
  return `${scheduledAt} (${localDate} ${timeZone})`;
}

export function formatFactoryScheduledJobsStatus(status = {}) {
  const jobs = Array.isArray(status?.jobs) ? status.jobs : [];
  const lines = [
    `Factory scheduled jobs status: ${trim(status?.factory_id) || "unknown"}`,
    `State: ${trim(status?.state_status) || "state_unknown"}`
      + (trim(status?.state_loaded_from) ? ` (${trim(status.state_loaded_from)})` : ""),
  ];

  if (trim(status?.state_error)) {
    lines.push(`State error: ${trim(status.state_error)}`);
  }

  if (jobs.length === 0) {
    lines.push("No configured scheduled jobs.");
    return lines.join("\n");
  }

  for (const job of jobs) {
    const due = isPlainObject(job?.due) ? job.due : {};
    const dueLabel = due?.due ? "yes" : "no";
    lines.push(`- ${trim(job?.id) || "(unknown-job)"} (${trim(job?.type_label || job?.type) || "unknown"})`);
    lines.push(`  next_local_slot: ${presentSlot(job)}`);
    lines.push(`  due: ${dueLabel}${trim(due?.reason) ? ` (${trim(due.reason)})` : ""}`);
    lines.push(`  last_status: ${trim(job?.last_status) || "never"}`);
    lines.push(`  last_started_at: ${presentTimestamp(job?.last_started_at)}`);
    lines.push(`  last_completed_at: ${presentTimestamp(job?.last_completed_at)}`);
    lines.push(`  last_failed_at: ${presentTimestamp(job?.last_failed_at)}`);
    if (trim(job?.last_issue_url)) lines.push(`  last_issue_url: ${trim(job.last_issue_url)}`);
    if (trim(job?.last_run_id)) lines.push(`  last_run_id: ${trim(job.last_run_id)}`);
    if (trim(job?.last_error)) lines.push(`  last_error: ${trim(job.last_error)}`);
  }

  return lines.join("\n");
}
