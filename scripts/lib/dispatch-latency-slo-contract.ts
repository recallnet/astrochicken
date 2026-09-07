import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

export const DISPATCH_LATENCY_SLO_REPORT_JSON_PATH = path.join(REPO_ROOT, "docs/contracts/dispatch-latency-slo-contract.json");
export const DISPATCH_LATENCY_SLO_REPORT_MARKDOWN_PATH = path.join(REPO_ROOT, "docs/contracts/dispatch-latency-slo-contract.md");

const GOVERNED_FACTORY_CONFIG = "factories/mothership/factory.config.json";
const DAEMON_TICK_RUNNER_PATH = "packages/factory-ops/src/lib/daemon-tick-runner.ts";
const POLICY_OWNER_PATH = "packages/factory-ops/src/lib/dispatch-slo-policy.ts";
const MAX_ALLOWED_DISPATCH_SLO_SECONDS = 30;

function trim(value = "") {
  return String(value || "").trim();
}

function readJson(relativePath = "") {
  return JSON.parse(readFileSync(path.join(REPO_ROOT, relativePath), "utf8"));
}

function readText(relativePath = "") {
  return readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

export function listTrackedFilesFromGit() {
  return execFileSync("git", ["ls-files"], { cwd: REPO_ROOT, encoding: "utf8" })
    .split(/\r?\n/g)
    .map((entry) => trim(entry))
    .filter(Boolean);
}

function renderReport({ diagnostics, dispatchLatencySloSeconds = 0, maintenanceIntervalSeconds = 0 }) {
  const ok = diagnostics.length === 0;
  const report = {
    schema_version: "dispatch_latency_slo_contract/v1",
    generated_at: new Date().toISOString(),
    ok,
    governed_factory: "mothership",
    dispatch_latency_slo_seconds: dispatchLatencySloSeconds,
    maintenance_interval_seconds: maintenanceIntervalSeconds,
    diagnostics,
  };
  const markdown = [
    "---",
    'doc_type: "reference"',
    'owner: "platform-architecture"',
    'review_policy: "periodic-7"',
    'reviewed: "2026-03-21"',
    'status: "active"',
    'summary: "Governed audit for Phase 7.3 bounded dispatch latency SLO policy and maintenance demotion."',
    'tags: [contracts, daemon, dispatch, generated, maintenance, slo]',
    'written: "2026-03-21"',
    "---",
    "",
    "# Dispatch Latency SLO Contract",
    "",
    `- governed factory: \`mothership\``,
    `- dispatch latency SLO seconds: \`${dispatchLatencySloSeconds || "missing"}\``,
    `- maintenance interval seconds: \`${maintenanceIntervalSeconds || "missing"}\``,
    `- result: \`${ok ? "ok" : "fail"}\``,
    "",
    "## Diagnostics",
    "",
    ...(diagnostics.length > 0 ? diagnostics.map((entry) => `- ${entry}`) : ["- none"]),
    "",
  ].join("\n");

  return {
    ok,
    report,
    rendered_json: `${JSON.stringify(report, null, 2)}\n`,
    rendered_markdown: markdown,
  };
}

export function analyzeDispatchLatencySloContract({ files = [] } = {}) {
  const tracked = new Set(files);
  const diagnostics = [];
  const shouldCheck = tracked.size === 0
    || tracked.has(GOVERNED_FACTORY_CONFIG)
    || tracked.has(DAEMON_TICK_RUNNER_PATH)
    || tracked.has(POLICY_OWNER_PATH);
  if (!shouldCheck) {
    return {
      ...renderReport({ diagnostics: [], dispatchLatencySloSeconds: 0, maintenanceIntervalSeconds: 0 }),
      skipped: true,
    };
  }

  const config = readJson(GOVERNED_FACTORY_CONFIG);
  const dispatchLatencySloSeconds = Number(config?.dispatch?.latency_slo_seconds || 0);
  const maintenanceIntervalSeconds = Number(config?.pipeline?.maintenance_interval_seconds || 0);

  if (!Number.isInteger(dispatchLatencySloSeconds) || dispatchLatencySloSeconds <= 0) {
    diagnostics.push(`dispatch_latency_slo_missing_or_invalid path=${GOVERNED_FACTORY_CONFIG} field=dispatch.latency_slo_seconds`);
  } else if (dispatchLatencySloSeconds > MAX_ALLOWED_DISPATCH_SLO_SECONDS) {
    diagnostics.push(`dispatch_latency_slo_exceeds_budget path=${GOVERNED_FACTORY_CONFIG} field=dispatch.latency_slo_seconds max=${MAX_ALLOWED_DISPATCH_SLO_SECONDS} actual=${dispatchLatencySloSeconds}`);
  }

  if (!Number.isInteger(maintenanceIntervalSeconds) || maintenanceIntervalSeconds <= 0) {
    diagnostics.push(`maintenance_interval_missing_or_invalid path=${GOVERNED_FACTORY_CONFIG} field=pipeline.maintenance_interval_seconds`);
  } else if (dispatchLatencySloSeconds > 0 && maintenanceIntervalSeconds <= dispatchLatencySloSeconds) {
    diagnostics.push(`maintenance_interval_must_exceed_dispatch_slo path=${GOVERNED_FACTORY_CONFIG} interval_seconds=${maintenanceIntervalSeconds} slo_seconds=${dispatchLatencySloSeconds}`);
  }

  if (!existsSync(path.join(REPO_ROOT, POLICY_OWNER_PATH))) {
    diagnostics.push(`dispatch_slo_policy_owner_missing path=${POLICY_OWNER_PATH}`);
  }

  const daemonTickRunner = readText(DAEMON_TICK_RUNNER_PATH);
  if (!/evaluateDispatchLatencySlo/.test(daemonTickRunner)) {
    diagnostics.push(`daemon_tick_runner_missing_slo_policy path=${DAEMON_TICK_RUNNER_PATH} symbol=evaluateDispatchLatencySlo`);
  }
  if (!/evaluateMaintenanceTickDue/.test(daemonTickRunner)) {
    diagnostics.push(`daemon_tick_runner_missing_maintenance_demotion path=${DAEMON_TICK_RUNNER_PATH} symbol=evaluateMaintenanceTickDue`);
  }
  if (!/writeMaintenanceTickState/.test(daemonTickRunner)) {
    diagnostics.push(`daemon_tick_runner_missing_maintenance_cursor_write path=${DAEMON_TICK_RUNNER_PATH} symbol=writeMaintenanceTickState`);
  }
  if (!/dispatch_latency_slo status=/.test(daemonTickRunner)) {
    diagnostics.push(`daemon_tick_runner_missing_slo_log path=${DAEMON_TICK_RUNNER_PATH}`);
  }
  if (!/maintenance_tick_skipped reason=/.test(daemonTickRunner)) {
    diagnostics.push(`daemon_tick_runner_missing_maintenance_skip_log path=${DAEMON_TICK_RUNNER_PATH}`);
  }

  return renderReport({ diagnostics, dispatchLatencySloSeconds, maintenanceIntervalSeconds });
}
