import { existsSync, statSync as fsStatSync } from "node:fs";
import { dirname, isAbsolute, resolve, join } from "node:path";
import { Worker } from "node:worker_threads";

import {
  factoryActiveSummary as lightweightFactoryActiveSummary,
} from "./factory-active-summary.ts";
import { normalizeFactoryContext, resolveFactoryContext } from "./factory-context-resolver.ts";
import { summarizeFactoryAttention } from "./factory-fleet-attention.ts";
import { overlayRuntimeRegistry } from "./factory-fleet-registry-overlay.ts";
import {
  resolvePrimaryOpsRepo,
} from "./factory-repo-identity.ts";
import {
  factoryStatus as lightweightFactoryStatus,
} from "./factory-status-canonical.ts";
import { inferFactoryRootFromRegistryEntry } from "./factory-status-collector.ts";
import {
  duration,
  readAllRunStates,
  resolveGraph,
  resolveIssue,
} from "./factory-status-support.ts";
import { readHostFactoryIntent } from "./host-factory-intent.ts";
import { readJsonFile } from "./io.ts";
import { resolveRunsDir } from "./runs-dir-resolver.ts";
import { hostHealth, hostVersion, resolveHostPaths } from "../commands/factory-host-lifecycle.ts";
import { collectFactoryOutcomes } from "../commands/factory-outcomes.ts";
import { tickStatus as lightweightTickStatus } from "../commands/factory-tick-status.ts";

function trim(value = "") {
  return String(value ?? "").trim();
}

function prefersHostScopedRuns(context = {}) {
  const targetRepo = trim(context?.target_repo);
  const controlPlaneRepo = trim(context?.control_plane_repo);
  return Boolean(targetRepo && controlPlaneRepo && targetRepo !== controlPlaneRepo);
}


function asIssueNumber(value) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseIsoMs(value = "") {
  const parsed = Date.parse(String(value || "").trim());
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function parseSemver(value = "") {
  const match = trim(value).replace(/^v/i, "").match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function compareSemver(left = "", right = "") {
  const a = parseSemver(left);
  const b = parseSemver(right);
  if (!a || !b) return 0;
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function normalizeRegistryEntry(entry = {}, index = 0) {
  const value = entry && typeof entry === "object" ? entry : {};
  const normalized = {
    factory_id: trim(value.factory_id || value.id || value.instance_id),
    kind_id: trim(value.kind_id || value.kindId),
    control_plane_repo: trim(value.control_plane_repo),
    target_repo: trim(value.target_repo || value.repo),
    daemon_status: value.daemon_status && typeof value.daemon_status === "object"
      ? value.daemon_status
      : (value.daemonStatus && typeof value.daemonStatus === "object" ? value.daemonStatus : {}),
    graphs: Array.isArray(value.graphs) ? value.graphs : [],
    registry_entry_index: Number.isFinite(Number(index)) ? Number(index) : 0,
  };

  const validationErrors = [];
  if (!normalized.factory_id) validationErrors.push("missing_factory_id");

  return {
    ...normalized,
    registry_validation_errors: validationErrors,
  };
}


function registryRootCandidates(context = {}, cwd = process.cwd()) {
  const roots = [];
  const normalized = normalizeFactoryContext(context);
  const push = (candidate = "") => {
    const resolved = trim(candidate) ? resolve(candidate) : "";
    if (!resolved || roots.includes(resolved)) return;
    roots.push(resolved);
  };

  push(cwd);
  push(normalized.factory_root);
  push(dirname(normalized.factory_root || ""));
  push(dirname(dirname(normalized.factory_root || "")));
  return roots;
}

function resolveRegistryAbsolutePath({ context = {}, registryPath = "factory-registry.json", cwd = process.cwd() } = {}) {
  const candidate = trim(registryPath) || "factory-registry.json";
  if (isAbsolute(candidate)) return candidate;

  for (const root of registryRootCandidates(context, cwd)) {
    const path = resolve(root, candidate);
    if (existsSync(path)) return path;
  }
  return resolve(cwd, candidate);
}

function buildFallbackContext({ entry = {}, rootDir = process.cwd(), controlPlaneRepo = "" } = {}) {
  const factoryId = trim(entry.factory_id) || "unknown";
  const factoryRoot = inferFactoryRootFromRegistryEntry({
    id: factoryId,
    graphs: Array.isArray(entry.graphs) ? entry.graphs : [],
  });
  const fallbackRunsDir = resolveRunsDir({ factoryId });
  const identity = resolvePrimaryOpsRepo({
    context: {
      factory_id: factoryId,
      target_repo: trim(entry.target_repo),
    },
    factoryId,
    requireResolved: false,
  });
  return normalizeFactoryContext({
    factory_root: factoryRoot ? resolve(rootDir, factoryRoot) : "",
    factory_id: factoryId,
    target_repo: identity.target_repo,
    control_plane_repo: trim(controlPlaneRepo || entry.control_plane_repo || identity.target_repo),
    runs_dir: fallbackRunsDir,
  });
}

function deriveReleaseState(status = {}, version = "") {
  const controlPlane = status?.control_plane && typeof status.control_plane === "object"
    ? status.control_plane
    : {};
  const reason = trim(controlPlane.resume_reason);
  const requiredFloor = trim(controlPlane.required_release_floor);

  if (reason === "release_rollout_blocked" || reason === "control_plane_manifest_unavailable") return "blocked";
  if (reason === "release_not_promoted_to_general") return "upgrading";
  if (requiredFloor && version && compareSemver(version, requiredFloor) < 0) return "upgrading";
  if (reason === "ready_to_resume") return "ready";
  return reason || "unknown";
}

function deriveBlockedReason(status = {}, releaseState = "", managedState = {}) {
  const managedReason = trim(managedState?.reason);
  if (managedReason) return managedReason;

  const blockedItems = Array.isArray(status?.blocked_control_plane) ? status.blocked_control_plane : [];
  if (blockedItems.length > 0) {
    const first = blockedItems[0] || {};
    const milestone = trim(first.milestone) || "(no wave)";
    const issue = Number.isFinite(Number(first.issue_number)) ? ` issue #${Number(first.issue_number)}` : "";
    const linkedGoal = Number.isFinite(Number(first.linked_goal_number)) && Number(first.linked_goal_number) > 0
      ? ` goal #${Number(first.linked_goal_number)}`
      : "";
    const reason = trim(first.unblockCondition || first.status) || "awaiting_control_plane_unblock";
    return `${milestone}${issue}${linkedGoal}: ${reason}`;
  }

  if (releaseState === "blocked") {
    const controlPlane = status?.control_plane && typeof status.control_plane === "object"
      ? status.control_plane
      : {};
    return trim(controlPlane.resume_when || controlPlane.resume_reason || "release_gate_blocked");
  }

  return "";
}

function deriveActiveWaves(activeSummary = {}) {
  const waves = Array.isArray(activeSummary?.waves) ? activeSummary.waves : [];
  return [...new Set(waves.map((wave) => trim(wave.milestone_title)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function deriveActiveIssues(activeSummary = {}, status = {}) {
  const issues = new Set();

  for (const wave of (Array.isArray(activeSummary?.waves) ? activeSummary.waves : [])) {
    const issue = asIssueNumber(wave.current_issue_number);
    if (issue) issues.add(issue);
  }

  for (const run of (Array.isArray(activeSummary?.non_wave_active) ? activeSummary.non_wave_active : [])) {
    const issue = asIssueNumber(run.issue_number);
    if (issue) issues.add(issue);
    const currentIssue = asIssueNumber(run.current_issue_number);
    if (currentIssue) issues.add(currentIssue);
  }

  for (const run of (Array.isArray(status?.active) ? status.active : [])) {
    const issue = asIssueNumber(run.issue);
    if (issue) issues.add(issue);
  }

  return [...issues].sort((a, b) => a - b);
}

function normalizeDaemonHealth({ host = {}, registryEntry = {} } = {}) {
  const daemonStatus = registryEntry?.daemon_status && typeof registryEntry.daemon_status === "object"
    ? registryEntry.daemon_status
    : {};
  const status = trim(host.status || daemonStatus.status) || "unknown";
  const pid = Number(host.pid || daemonStatus.pid);

  return {
    status,
    running: host.running === true || status === "running",
    pid: Number.isFinite(pid) && pid > 0 ? Math.trunc(pid) : null,
    run_count: Number.isFinite(Number(host.runCount)) ? Number(host.runCount) : 0,
    run_id: trim(daemonStatus.run_id) || null,
    last_tick_at: trim(daemonStatus.last_tick_at) || null,
  };
}

function buildRecentOutcomes(outcomes = {}, lookbackHours = 24) {
  if (!outcomes || typeof outcomes !== "object") return [];
  return [{
    lookback_hours: Number(lookbackHours) || 24,
    closed_goals: Number(outcomes.closed_goals || 0),
    merged_prs: Number(outcomes.merged_prs || 0),
    closed_features: Number(outcomes.closed_features || 0),
    closed_bugs: Number(outcomes.closed_bugs || 0),
    merge_commits_main: Number(outcomes.merge_commits_main || 0),
    summary: `merged_prs=${Number(outcomes.merged_prs || 0)} closed_features=${Number(outcomes.closed_features || 0)} closed_bugs=${Number(outcomes.closed_bugs || 0)} merge_commits_main=${Number(outcomes.merge_commits_main || 0)}`,
  }];
}

const TERMINAL_RUN_STATUSES = new Set([
  "completed",
  "failed",
  "suspended",
  "guarded",
  "guarded_terminal",
  "blocked",
  "terminal",
]);

function compactGraphLabel(graph = "") {
  const raw = trim(graph);
  if (!raw) return "";
  const parts = raw.split("/");
  return parts[parts.length - 1] || raw;
}

function summarizeRecentHostActivityItem(item = {}, nowMs = Date.now()) {
  const status = trim(item.status || "run");
  const issue = asIssueNumber(item.issue);
  const graph = trim(item.graph);
  const ageMs = Math.max(0, nowMs - Number(item.updated_ms || nowMs));
  const label = issue
    ? `#${issue}`
    : (graph || "run");
  return `${status} ${label} ${duration(ageMs)} ago`;
}

function buildRecentHostActivity({
  runsDir = "",
  now = Date.now(),
  lookbackHours = 24,
  readAllRunStatesFn = readAllRunStates,
} = {}) {
  const resolvedRunsDir = trim(runsDir);
  if (!resolvedRunsDir || !existsSync(resolvedRunsDir)) {
    return {
      count: 0,
      latest_summary: "",
      latest_status: "",
      latest_graph: "",
      latest_issue: null,
      latest_updated_at: "",
      latest_updated_ms: 0,
    };
  }

  const minUpdatedMs = Number(now) - ((Number(lookbackHours) || 24) * 60 * 60 * 1000);
  const items = [];
  for (const [runId, state] of readAllRunStatesFn({ runsDir: resolvedRunsDir })) {
    const status = trim(state?.status).toLowerCase();
    if (!TERMINAL_RUN_STATUSES.has(status)) continue;
    const updatedAt = trim(
      state?.updatedAt
      || state?.updated_at
      || state?.completedAt
      || state?.finishedAt
      || state?.endedAt
      || state?.createdAt,
    );
    const updatedMs = parseIsoMs(updatedAt);
    if (!Number.isFinite(updatedMs) || updatedMs < minUpdatedMs) continue;
    items.push({
      run_id: runId,
      status,
      graph: compactGraphLabel(resolveGraph(state)),
      issue: resolveIssue(state),
      updated_at: updatedAt,
      updated_ms: updatedMs,
    });
  }

  items.sort((a, b) => {
    if (a.updated_ms !== b.updated_ms) return b.updated_ms - a.updated_ms;
    return String(a.run_id).localeCompare(String(b.run_id));
  });

  const latest = items[0] || {};
  return {
    count: items.length,
    latest_summary: latest.run_id ? summarizeRecentHostActivityItem(latest, Number(now)) : "",
    latest_status: trim(latest.status),
    latest_graph: trim(latest.graph),
    latest_issue: asIssueNumber(latest.issue),
    latest_updated_at: trim(latest.updated_at),
    latest_updated_ms: Number(latest.updated_ms) || 0,
  };
}

/**
 * Create a cached wrapper around buildRecentHostActivity that only rescans
 * the runs directory when its mtime changes.
 *
 * @param {{ statSyncFn?: (path: string) => { mtimeMs: number } }} deps
 */
/**
 * Create a cached wrapper around buildRecentHostActivity that only rescans
 * the runs directory when its mtime changes.
 *
 * @param {{ statSyncFn?: (path: string) => { mtimeMs: number }, existsSyncFn?: (path: string) => boolean, buildFn?: Function }} deps
 */
export function createCachedBuildRecentHostActivity({
  statSyncFn = fsStatSync,
  existsSyncFn = existsSync,
  buildFn = buildRecentHostActivity,
} = {}) {
  const cache = new Map(); // runsDir → { mtimeMs, result }

  return function cachedBuildRecentHostActivity(opts = {}) {
    const runsDir = trim(opts.runsDir);
    if (!runsDir || !existsSyncFn(runsDir)) {
      return buildFn(opts);
    }

    let mtimeMs;
    try {
      mtimeMs = statSyncFn(runsDir).mtimeMs;
    } catch {
      return buildFn(opts);
    }

    const entry = cache.get(runsDir);
    if (entry && entry.mtimeMs === mtimeMs) {
      return entry.result;
    }

    const result = buildFn(opts);
    cache.set(runsDir, { mtimeMs, result });
    return result;
  };
}

function buildActiveWorkSummary({ activeWaves = [], activeIssues = [], tick = {} } = {}) {
  const stage = trim(tick?.ticks?.[0]?.stageLabel || tick?.ticks?.[0]?.stage || "");
  const wavesLabel = activeWaves.length > 0 ? activeWaves.join(",") : "none";
  const issuesLabel = activeIssues.length > 0 ? activeIssues.join(",") : "none";
  if (stage) return `waves=${wavesLabel} issues=${issuesLabel} stage=${stage}`;
  return `waves=${wavesLabel} issues=${issuesLabel}`;
}

function normalizeRolloutValue(value = "", fallback = "unknown") {
  const normalized = trim(value);
  return normalized || fallback;
}

function deriveDriftState({ rolloutStatus = "", gateAllowed = false } = {}) {
  const status = trim(rolloutStatus);
  if (["ready", "blocked", "lagging", "unknown"].includes(status)) return status;
  if (gateAllowed === true) return "ready";
  return "unknown";
}

function resolveKindVersion({ kindFilePath = "", registryKindId = "" } = {}) {
  const path = trim(kindFilePath);
  if (path && existsSync(path)) {
    const kindJson = readJsonFile(path, null);
    if (kindJson && typeof kindJson === "object" && !Array.isArray(kindJson)) {
      const explicitVersion = trim(kindJson.kind_version || kindJson.version);
      if (explicitVersion) return explicitVersion;
    }
  }
  return trim(registryKindId) || "unknown_kind_version";
}

function buildKindJsonCandidatePaths({ context = {}, rootDir = process.cwd(), registryKindId = "", factoryId = "" } = {}) {
  const candidates = [];
  const push = (value = "") => {
    const raw = trim(value);
    if (!raw) return;
    const resolved = resolve(raw);
    if (candidates.includes(resolved)) return;
    candidates.push(resolved);
  };

  const contextFactoryRoot = trim(context?.factory_root);
  if (contextFactoryRoot) {
    push(join(contextFactoryRoot, "kind.json"));
  }

  const kindId = trim(registryKindId);
  if (kindId) {
    push(resolve(rootDir, "factories", kindId, "kind.json"));
  }

  const id = trim(factoryId);
  if (id) {
    push(resolve(rootDir, "factories", id, "kind.json"));
  }

  return candidates;
}

function createReleaseTargetingLookup({ report = {} } = {}) {
  const rows = Array.isArray(report?.factories) ? report.factories : [];
  const byFactoryId = new Map();
  for (const row of rows) {
    const factoryId = trim(row?.factory_id);
    if (!factoryId) continue;
    byFactoryId.set(factoryId, row);
  }
  return byFactoryId;
}

export function createDefaultFleetRowDeps() {
  return {
    resolveFactoryContextFn: resolveFactoryContext,
    factoryStatusFn: lightweightFactoryStatus,
    factoryActiveSummaryFn: lightweightFactoryActiveSummary,
    tickStatusFn: lightweightTickStatus,
    hostHealthFn: hostHealth,
    hostVersionFn: hostVersion,
    collectFactoryOutcomesFn: collectFactoryOutcomes,
  };
}

export function classifyFleetFactoryHealth(row = {}) {
  const errors = Array.isArray(row?.errors) ? row.errors.filter(Boolean) : [];
  if (errors.length > 0) return "unhealthy";

  if (row?.host_intent_enabled === false) return "disabled";
  // @context:decision !critical Fleet posture is the canonical operator view, so host/daemon
  // liveness cannot override lifecycle truth here. Host state still surfaces separately as an
  // explicit side channel, but the primary health classification must remain PG-owned.

  const managedClassification = trim(row?.managed_state?.health_classification);
  const waveCount = Array.isArray(row?.active_waves) ? row.active_waves.length : 0;
  const issueCount = Array.isArray(row?.active_issues) ? row.active_issues.length : 0;
  const hasActiveWork = waveCount + issueCount > 0;

  if (["operator_paused", "operator_quarantined"].includes(managedClassification)) {
    return "blocked";
  }
  if (managedClassification === "control_plane_blocked" && !hasActiveWork) return "blocked";
  if (managedClassification === "locally_unhealthy") return "unhealthy";

  if ((trim(row?.blocked_reason) || trim(row?.release_state) === "blocked") && !hasActiveWork) return "blocked";
  if (trim(row?.release_state) === "upgrading") return "upgrading";

  if (waveCount + issueCount === 0) return "idle";
  return "healthy";
}

export function readFactoryRegistry({ context = {}, registryPath = "factory-registry.json", cwd = process.cwd() } = {}) {
  const absoluteRegistryPath = resolveRegistryAbsolutePath({ context, registryPath, cwd });
  if (!existsSync(absoluteRegistryPath)) {
    return {
      ok: false,
      reason: "registry_missing",
      registry_path: absoluteRegistryPath,
      factories: [],
      error: `registry file not found: ${absoluteRegistryPath}`,
    };
  }

  return overlayRuntimeRegistry({
    absoluteRegistryPath,
    context,
    cwd,
    readJsonFile,
    normalizeRegistryEntry,
    resolveRegistryAbsolutePath,
  });
}


function computeFleetTotals(rows = []) {
  const totals = {
    total_factories: rows.length,
    healthy: 0,
    disabled: 0,
    blocked: 0,
    upgrading: 0,
    idle: 0,
    unhealthy: 0,
    active_waves: 0,
    active_issues: 0,
    drift_ready: 0,
    drift_blocked: 0,
    drift_lagging: 0,
    drift_unknown: 0,
  };

  for (const row of rows) {
    const health = trim(row.health) || "unhealthy";
    if (Object.hasOwn(totals, health)) totals[health] += 1;
    totals.active_waves += Array.isArray(row.active_waves) ? row.active_waves.length : 0;
    totals.active_issues += Array.isArray(row.active_issues) ? row.active_issues.length : 0;

    const driftState = deriveDriftState({
      rolloutStatus: row?.drift_state || row?.rollout_status,
      gateAllowed: row?.gate_allowed,
    });
    totals[`drift_${driftState}`] += 1;
  }

  return totals;
}

function computeFleetKpis(rows = [], lookbackHours = 24) {
  const kpis = {
    window_hours: Number(lookbackHours) || 24,
    factories_reporting: rows.length,
    daemons_running: 0,
    last_tick_known: 0,
    closed_goals: 0,
    closed_features: 0,
    closed_bugs: 0,
    merge_commits_main: 0,
    attention_factories: 0,
  };

  for (const row of rows) {
    if (row?.daemon_health?.running === true) kpis.daemons_running += 1;
    if (trim(row?.daemon_health?.last_tick_at)) kpis.last_tick_known += 1;
    if (summarizeFactoryAttention(row)) kpis.attention_factories += 1;
    const outcomes = Array.isArray(row?.recent_outcomes) ? row.recent_outcomes[0] || {} : {};
    kpis.closed_goals += Number(outcomes.closed_goals || 0);
    kpis.closed_features += Number(outcomes.closed_features || 0);
    kpis.closed_bugs += Number(outcomes.closed_bugs || 0);
    kpis.merge_commits_main += Number(outcomes.merge_commits_main || 0);
  }

  return kpis;
}

export function collectFactoryRow({
  registryEntry = {},
  baseContext = {},
  lookbackHours = 24,
  now = Date.now(),
  rootDir = process.cwd(),
  releaseTargetingLookup = new Map(),
  resolveFactoryContextFn = resolveFactoryContext,
  factoryStatusFn,
  factoryActiveSummaryFn,
  tickStatusFn,
  hostHealthFn = hostHealth,
  hostVersionFn = hostVersion,
  collectFactoryOutcomesFn = collectFactoryOutcomes,
  readHostFactoryIntentFn = readHostFactoryIntent,
} = {}) {
  const rowWarnings = [];
  const rowErrors = [];

  const entryIndex = Number.isFinite(Number(registryEntry.registry_entry_index))
    ? Number(registryEntry.registry_entry_index)
    : 0;
  const fallbackFactoryId = `malformed-registry-entry-${entryIndex + 1}`;
  const normalizedEntry = {
    ...registryEntry,
    factory_id: trim(registryEntry.factory_id) || fallbackFactoryId,
    kind_id: trim(registryEntry.kind_id || registryEntry.kindId),
  };

  const registryValidationErrors = Array.isArray(registryEntry.registry_validation_errors)
    ? registryEntry.registry_validation_errors.filter(Boolean)
    : [];
  if (!trim(registryEntry.factory_id) && !registryValidationErrors.includes("missing_factory_id")) {
    registryValidationErrors.push("missing_factory_id");
  }
  for (const reason of registryValidationErrors) {
    const message = `malformed_registry_entry:${trim(reason)}`;
    rowWarnings.push(message);
    rowErrors.push(message);
  }

  let context;
  try {
    const inferredFactoryRoot = inferFactoryRootFromRegistryEntry({
      id: normalizedEntry.factory_id,
      graphs: normalizedEntry.graphs,
    });
    context = resolveFactoryContextFn({
      cwd: rootDir,
      factoryRoot: inferredFactoryRoot,
      factoryId: normalizedEntry.factory_id,
      targetRepo: normalizedEntry.target_repo,
      controlPlaneRepo: trim(baseContext.control_plane_repo || normalizedEntry.control_plane_repo),
    });
  } catch (error) {
    const message = `context_resolution_failed:${String(error?.message || error)}`;
    rowWarnings.push(message);
    rowErrors.push(message);
    context = buildFallbackContext({
      entry: normalizedEntry,
      rootDir,
      controlPlaneRepo: trim(baseContext.control_plane_repo),
    });
  }

  const resolvedRunsDir = context.runs_dir || resolveRunsDir({ factoryId: context.factory_id });
  const hostPaths = resolveHostPaths({
    factoryId: context.factory_id,
    instanceId: context.instance_id || context.factory_id,
    baseDir: process.env.HATCH_HOST_BASE_DIR,
  });

  const intentFilePath = resolve(hostPaths.baseDir, context.factory_id, "intent.json");
  const hostIntent = readHostFactoryIntentFn({ intentFilePath });

  let effectiveRunsDir = prefersHostScopedRuns(context) && existsSync(hostPaths.runsDir || "")
    ? hostPaths.runsDir
    : resolvedRunsDir;

  // For cross-repo factories, the resolved runs_dir may point to the control-plane
  // repo instead of the target repo.  Fall back to the factory config's work_dir
  // to find the actual runs directory.
  if (!existsSync(effectiveRunsDir || "") && prefersHostScopedRuns(context)) {
    const configPath = trim(context.factory_root)
      ? resolve(trim(context.factory_root), "factory.config.json")
      : "";
    const factoryConfig = configPath ? readJsonFile(configPath, null) : null;
    const workDir = trim(factoryConfig?.work_dir);
    const configRunsDir = trim(factoryConfig?.runs_dir);
    if (workDir && configRunsDir) {
      const workDirResolved = isAbsolute(workDir) ? workDir : resolve(rootDir, workDir);
      const candidate = isAbsolute(configRunsDir) ? configRunsDir : resolve(workDirResolved, configRunsDir);
      if (existsSync(candidate)) effectiveRunsDir = candidate;
    }
  }

  if (!existsSync(effectiveRunsDir || "")) {
    rowWarnings.push(`runs_dir_missing:${effectiveRunsDir || "(unresolved)"}`);
  }

  let status = {};
  try {
    status = factoryStatusFn({ runsDir: effectiveRunsDir, context: { ...context, runs_dir: effectiveRunsDir }, now });
  } catch (error) {
    const message = `factory_status_failed:${String(error?.message || error)}`;
    rowWarnings.push(message);
    rowErrors.push(message);
    status = {};
  }

  let activeSummary = {};
  try {
    activeSummary = factoryActiveSummaryFn({ runsDir: effectiveRunsDir, context: { ...context, runs_dir: effectiveRunsDir }, now });
  } catch (error) {
    const message = `active_summary_failed:${String(error?.message || error)}`;
    rowWarnings.push(message);
    rowErrors.push(message);
    activeSummary = {};
  }

  const activeZeroDeltaBurn = (Array.isArray(activeSummary?.non_wave_active) ? activeSummary.non_wave_active : [])
    .find((run) => run?.no_git_delta_since_start === true && (Number(run?.current_issue_number || 0) > 0 || Number(run?.issue_number || 0) > 0));
  if (activeZeroDeltaBurn) {
    const issueNumber = Number(activeZeroDeltaBurn.current_issue_number || activeZeroDeltaBurn.issue_number || 0);
    rowWarnings.push(`active_issue_zero_delta_burn:#${issueNumber}:${trim(activeZeroDeltaBurn.age || "")}`);
  }

  let tick = {};
  try {
    tick = tickStatusFn({ runsDir: effectiveRunsDir, context: { ...context, runs_dir: effectiveRunsDir } });
  } catch (error) {
    rowWarnings.push(`tick_status_failed:${String(error?.message || error)}`);
    tick = {};
  }

  const daemonHealth = normalizeDaemonHealth({
    host: hostHealthFn({
      factoryId: context.factory_id,
      pidFile: hostPaths.pidFile,
      runsDir: hostPaths.runsDir,
      logsDir: hostPaths.logsDir,
      paths: hostPaths,
      env: {
        ...process.env,
        HATCH_HOST_BASE_DIR: hostPaths.baseDir,
      },
    }),
    registryEntry: normalizedEntry,
  });
  const recentHostActivity = buildRecentHostActivity({
    runsDir: effectiveRunsDir,
    now,
    lookbackHours,
  });

  const versionInfo = hostVersionFn({
    factoryRoot: context.factory_root || rootDir,
    factoryId: context.factory_id,
  }) || {};
  const version = trim(versionInfo?.version);
  const runtimeVersionSource = trim(versionInfo?.source || "unknown");

  let repoIdentity;
  try {
    repoIdentity = resolvePrimaryOpsRepo({
      context,
      factoryId: context.factory_id || normalizedEntry.factory_id,
      requireResolved: false,
    });
  } catch (error) {
    rowWarnings.push(`repo_identity_resolution_failed:${String(error?.message || error)}`);
    repoIdentity = {
      target_repo: trim(context.target_repo || normalizedEntry.target_repo),
    };
  }

  const targetRepo = trim(repoIdentity.target_repo || context.target_repo || normalizedEntry.target_repo);
  let outcomes = { error: "missing_repo", outcomes_degraded: true };
  if (targetRepo) {
    try {
      outcomes = collectFactoryOutcomesFn({ repo: targetRepo, repoPath: rootDir, lookbackHours });
      if (outcomes?.error || outcomes?.outcomes_degraded === true) {
        const reason = trim(outcomes?.error) || "gh_outcomes_degraded";
        rowWarnings.push(`outcomes_degraded:${reason}`);
      }
    } catch (error) {
      outcomes = { error: String(error?.message || error), outcomes_degraded: true };
      rowWarnings.push(`outcomes_degraded:${outcomes.error}`);
    }
  } else {
    rowWarnings.push("outcomes_degraded:missing_target_repo");
  }

  const releaseState = deriveReleaseState(status, version);
  const managedState = status?.managed_state && typeof status.managed_state === "object"
    ? status.managed_state
    : {
      state_action: "none",
      reason: "",
      retry_target: "",
      health_classification: "healthy",
    };
  const blockedReason = deriveBlockedReason(status, releaseState, managedState);
  const activeWaves = deriveActiveWaves(activeSummary);
  const activeIssues = deriveActiveIssues(activeSummary, status);

  const factoryId = context.factory_id || normalizedEntry.factory_id || "unknown";
  const releaseRow = releaseTargetingLookup.get(factoryId) || {};
  const rolloutChannel = normalizeRolloutValue(releaseRow.rollout_channel, "unknown");
  const rolloutStatus = normalizeRolloutValue(releaseRow.rollout_status, "unknown");
  const gateReason = normalizeRolloutValue(releaseRow.gate_reason, "unknown");
  const upgradeVerificationOutcome = normalizeRolloutValue(releaseRow.upgrade_verification_outcome, "unknown");
  const requiredFactoryRelease = trim(releaseRow.required_factory_release);

  const kindCandidates = buildKindJsonCandidatePaths({
    context,
    rootDir,
    registryKindId: normalizedEntry.kind_id,
    factoryId,
  });
  const resolvedKindJsonPath = kindCandidates.find((candidate) => existsSync(candidate)) || "";
  const kindVersion = resolveKindVersion({
    kindFilePath: resolvedKindJsonPath,
    registryKindId: normalizedEntry.kind_id,
  });

  const driftState = deriveDriftState({
    rolloutStatus,
    gateAllowed: releaseRow.gate_allowed,
  });

  const row = {
    factory_id: factoryId,
    target_repo: targetRepo || null,
    control_plane_repo: trim(context.control_plane_repo || baseContext.control_plane_repo || normalizedEntry.control_plane_repo) || null,
    factory_root: trim(context.factory_root) || null,
    runs_dir: trim(effectiveRunsDir) || null,
    version: version || null,
    runtime_version: version || "unknown",
    runtime_version_source: runtimeVersionSource || "unknown",
    kind_version: kindVersion,
    release_state: releaseState,
    blocked_reason: blockedReason || null,
    managed_state: managedState,
    active_waves: activeWaves,
    active_issues: activeIssues,
    active_work_summary: buildActiveWorkSummary({ activeWaves, activeIssues, tick }),
    blocked_control_plane: Array.isArray(status?.blocked_control_plane) ? status.blocked_control_plane : [],
    control_plane_blocker: blockedReason || null,
    daemon_health: daemonHealth,
    recent_host_activity: recentHostActivity,
    recent_outcomes: buildRecentOutcomes(outcomes, lookbackHours),
    outcomes_degraded: Boolean(outcomes?.error || outcomes?.outcomes_degraded),
    host_intent_enabled: hostIntent.enabled,
    host_intent_disabled_at: hostIntent.disabled_at || null,
    host_intent_disabled_reason: hostIntent.disabled_reason || null,
    rollout_channel: rolloutChannel,
    rollout_status: rolloutStatus,
    gate_reason: gateReason,
    gate_allowed: releaseRow.gate_allowed === true,
    selected_for_canary: releaseRow.selected_for_canary === true,
    resume_blocked: releaseRow.resume_blocked === true,
    release_identity: releaseRow.release_identity && typeof releaseRow.release_identity === "object"
      ? releaseRow.release_identity
      : { release_id: "", release_tag: "", release_sha: "" },
    required_factory_release: requiredFactoryRelease,
    upgrade_verification_outcome: upgradeVerificationOutcome,
    drift_state: driftState,
    warnings: rowWarnings,
    errors: rowErrors,
  };

  return {
    ...row,
    health: classifyFleetFactoryHealth(row),
  };
}

function buildFallbackRow(entry, baseContext, message) {
  const factoryId = trim(entry.factory_id) || "unknown";
  return {
    factory_id: factoryId,
    target_repo: trim(entry.target_repo) || null,
    control_plane_repo: trim(baseContext.control_plane_repo || entry.control_plane_repo || entry.target_repo) || null,
    factory_root: null,
    runs_dir: null,
    version: null,
    runtime_version: "unknown",
    runtime_version_source: "unknown",
    kind_version: "unknown_kind_version",
    release_state: "unknown",
    blocked_reason: null,
    managed_state: {
      state_action: "none",
      reason: "",
      retry_target: "",
      health_classification: "locally_unhealthy",
    },
    active_waves: [],
    active_issues: [],
    active_work_summary: "waves=none issues=none",
    blocked_control_plane: [],
    control_plane_blocker: null,
    daemon_health: { status: "unknown", running: false, pid: null, run_count: 0, run_id: null, last_tick_at: null },
    recent_host_activity: {
      count: 0,
      latest_summary: "",
      latest_status: "",
      latest_graph: "",
      latest_issue: null,
      latest_updated_at: "",
      latest_updated_ms: 0,
    },
    recent_outcomes: [],
    outcomes_degraded: true,
    host_intent_enabled: true,
    host_intent_disabled_at: null,
    host_intent_disabled_reason: null,
    rollout_channel: "unknown",
    rollout_status: "unknown",
    gate_reason: "unknown",
    gate_allowed: false,
    selected_for_canary: false,
    resume_blocked: false,
    release_identity: { release_id: "", release_tag: "", release_sha: "" },
    required_factory_release: "",
    upgrade_verification_outcome: "unknown",
    drift_state: "unknown",
    warnings: [],
    errors: [message],
    health: "unhealthy",
  };
}

export function collectFactoryRowsSequential({
  entries = [],
  baseContext = {},
  lookbackHours = 24,
  now = Date.now(),
  rootDir = process.cwd(),
  releaseTargetingLookup = new Map(),
  resolveFactoryContextFn = resolveFactoryContext,
  factoryStatusFn,
  factoryActiveSummaryFn,
  tickStatusFn,
  hostHealthFn = hostHealth,
  hostVersionFn = hostVersion,
  collectFactoryOutcomesFn = collectFactoryOutcomes,
  readHostFactoryIntentFn = readHostFactoryIntent,
} = {}) {
  const results = [];
  for (const entry of entries) {
    try {
      const row = collectFactoryRow({
        registryEntry: entry,
        baseContext,
        lookbackHours,
        now,
        rootDir,
        releaseTargetingLookup,
        resolveFactoryContextFn,
        factoryStatusFn,
        factoryActiveSummaryFn,
        tickStatusFn,
        hostHealthFn,
        hostVersionFn,
        collectFactoryOutcomesFn,
        readHostFactoryIntentFn,
      });
      const rowWarnings = (row.warnings || []).map((w) => `${row.factory_id}:${w}`);
      results.push({ row, warnings: rowWarnings });
    } catch (error) {
      const factoryId = trim(entry.factory_id) || "unknown";
      const message = String(error?.message || error);
      const fallbackRow = buildFallbackRow(entry, baseContext, message);
      results.push({
        row: fallbackRow,
        warnings: [`${factoryId}:row_collection_failed:${message}`],
      });
    }
  }
  return results;
}

/**
 * Collect factory rows in parallel using one worker thread per factory.
 *
 * Each worker imports the real dependency implementations and runs
 * `collectFactoryRow` on its own thread, so blocking sync I/O (file
 * reads, spawnSync) doesn't block other factories.
 *
 * @returns {Promise<Array<{ row: object, warnings: string[] }>>}
 */
export function collectFactoryRowsParallel({
  entries = [],
  baseContext = {},
  lookbackHours = 24,
  now = Date.now(),
  rootDir = process.cwd(),
  releaseTargetingLookup = new Map(),
} = {}) {
  if (entries.length === 0) return Promise.resolve([]);

  const workerUrl = new URL("./factory-row-collector-worker.ts", import.meta.url);
  const releaseTargetingLookupEntries = [...releaseTargetingLookup.entries()];

  const tasks = entries.map((entry) => new Promise((resolve) => {
    const worker = new Worker(workerUrl, {
      workerData: {
        registryEntry: entry,
        baseContext,
        lookbackHours,
        now,
        rootDir,
        releaseTargetingLookupEntries,
      },
    });
    worker.on("message", (msg) => {
      worker.terminate();
      if (msg.ok) {
        resolve({ row: msg.row, warnings: msg.warnings || [] });
      } else {
        const factoryId = trim(msg.factoryId) || "unknown";
        const message = String(msg.message || "worker_failed");
        const fallbackRow = buildFallbackRow(msg.entry || entry, msg.baseContext || baseContext, message);
        resolve({
          row: fallbackRow,
          warnings: [`${factoryId}:row_collection_failed:${message}`],
        });
      }
    });
    worker.on("error", (err) => {
      const factoryId = trim(entry.factory_id) || "unknown";
      const message = String(err?.message || err);
      const fallbackRow = buildFallbackRow(entry, baseContext, message);
      resolve({
        row: fallbackRow,
        warnings: [`${factoryId}:row_collection_failed:${message}`],
      });
    });
  }));

  return Promise.all(tasks);
}

// @context:decision !critical Commit 10 moves operator surfaces onto the
// canonical Postgres aggregate while keeping row-building logic here as the
// single owner for projection assembly and proof harnesses.
export async function buildFactoryFleetProjection({
  context = {},
  lookbackHours = 24,
  json = false,
  registryPath = "factory-registry.json",
  now = Date.now(),
  readFactoryRegistryFn = readFactoryRegistry,
  factoryReleaseTargetingStatusFn,
  resolveFactoryContextFn = resolveFactoryContext,
  factoryStatusFn,
  factoryActiveSummaryFn,
  tickStatusFn,
  hostHealthFn = hostHealth,
  hostVersionFn = hostVersion,
  collectFactoryOutcomesFn = collectFactoryOutcomes,
  collectFactoryRowsFn,
} = {}) {
  const _json = Boolean(json);
  void _json;

  const baseContext = normalizeFactoryContext(context);
  const generated_at = new Date(Number.isFinite(Number(now)) ? Number(now) : Date.now()).toISOString();
  const rootDir = process.cwd();
  const warnings = [];
  const effectiveFactoryStatusFn = typeof factoryStatusFn === "function"
    ? factoryStatusFn
    : () => ({ active: [], blocked_control_plane: [], control_plane: { resume_reason: "ready_to_resume" } });
  const effectiveFactoryActiveSummaryFn = typeof factoryActiveSummaryFn === "function"
    ? factoryActiveSummaryFn
    : () => ({ waves: [], non_wave_active: [] });
  const effectiveTickStatusFn = typeof tickStatusFn === "function"
    ? tickStatusFn
    : () => ({ ticks: [] });

  const effectiveFactoryReleaseTargetingStatusFn = typeof factoryReleaseTargetingStatusFn === "function"
    ? factoryReleaseTargetingStatusFn
    : () => ({ factories: [], warnings: ["release_targeting_unavailable"] });

  const releaseTargetingReport = await Promise.resolve(effectiveFactoryReleaseTargetingStatusFn({
    registryPath,
    readFactoryRegistryFn,
  })) || { factories: [], warnings: ["release_targeting_unavailable"] };
  const releaseTargetingWarnings = Array.isArray(releaseTargetingReport?.warnings)
    ? releaseTargetingReport.warnings.filter(Boolean)
    : [];
  const releaseTargetingLookup = createReleaseTargetingLookup({ report: releaseTargetingReport });

  const registry = readFactoryRegistryFn({ context: baseContext, registryPath, cwd: rootDir });
  if (!registry.ok) {
    return {
      generated_at,
      registry_path: registry.registry_path,
      kpis: computeFleetKpis([], lookbackHours),
      fleet_totals: computeFleetTotals([]),
      warnings: [registry.reason, registry.error].filter(Boolean),
      factories: [],
    };
  }

  const rowCollectionDeps = {
    baseContext,
    lookbackHours,
    now,
    rootDir,
    releaseTargetingLookup,
    resolveFactoryContextFn,
    factoryStatusFn: effectiveFactoryStatusFn,
    factoryActiveSummaryFn: effectiveFactoryActiveSummaryFn,
    tickStatusFn: effectiveTickStatusFn,
    hostHealthFn,
    hostVersionFn,
    collectFactoryOutcomesFn,
  };

  let collected;
  if (typeof collectFactoryRowsFn === "function") {
    collected = await Promise.resolve(collectFactoryRowsFn({
      entries: registry.factories,
      ...rowCollectionDeps,
    }));
  } else {
    collected = collectFactoryRowsSequential({
      entries: registry.factories,
      ...rowCollectionDeps,
    });
  }

  const rows = [];
  for (const item of collected) {
    rows.push(item.row);
    for (const warning of item.warnings || []) warnings.push(warning);
  }

  rows.sort((a, b) => String(a.factory_id).localeCompare(String(b.factory_id)));
  for (const warning of releaseTargetingWarnings) {
    warnings.push(`release_targeting:${warning}`);
  }
  if (rows.length === 0) warnings.push("no_factories_processed");

  return {
    generated_at,
    registry_path: registry.registry_path,
    kpis: computeFleetKpis(rows, lookbackHours),
    fleet_totals: computeFleetTotals(rows),
    warnings,
    factories: rows,
  };
}

export function formatFleetStatusHuman(result = {}) {
  const rows = Array.isArray(result?.factories) ? [...result.factories] : [];
  rows.sort((a, b) => String(a.factory_id).localeCompare(String(b.factory_id)));

  const totals = result?.fleet_totals && typeof result.fleet_totals === "object"
    ? result.fleet_totals
    : computeFleetTotals(rows);
  const kpis = result?.kpis && typeof result.kpis === "object"
    ? result.kpis
    : computeFleetKpis(rows, 24);

  const lines = [];
  lines.push(`Fleet status generated_at=${trim(result.generated_at) || "(unknown)"}`);
  lines.push(`Fleet KPIs window=${Number(kpis.window_hours || 0)}h reporting=${Number(kpis.factories_reporting || 0)} daemons_running=${Number(kpis.daemons_running || 0)} last_tick_known=${Number(kpis.last_tick_known || 0)} goals=${Number(kpis.closed_goals || 0)} issues=${Number(kpis.closed_features || 0)} bugs=${Number(kpis.closed_bugs || 0)} merge_commits=${Number(kpis.merge_commits_main || 0)} attention=${Number(kpis.attention_factories || 0)}`);
  lines.push(`Fleet totals total=${totals.total_factories || 0} healthy=${totals.healthy || 0} disabled=${totals.disabled || 0} blocked=${totals.blocked || 0} upgrading=${totals.upgrading || 0} idle=${totals.idle || 0} unhealthy=${totals.unhealthy || 0} active_waves=${totals.active_waves || 0} active_issues=${totals.active_issues || 0} drift_ready=${totals.drift_ready || 0} drift_blocked=${totals.drift_blocked || 0} drift_lagging=${totals.drift_lagging || 0} drift_unknown=${totals.drift_unknown || 0}`);

  for (const row of rows) {
    const outcomes = Array.isArray(row.recent_outcomes) ? row.recent_outcomes : [];
    const outcomeSummary = outcomes[0]?.summary || "none";
    const reason = trim(row?.managed_state?.reason)
      || trim(row.blocked_reason)
      || (Array.isArray(row.errors) && row.errors.length > 0 ? row.errors[0] : "")
      || (row.health === "disabled" ? `intent_disabled reason=${trim(row.host_intent_disabled_reason) || "none"}` : "")
      || (row.health === "unhealthy" ? `daemon=${trim(row.daemon_health?.status) || "unknown"}` : "");

    const baseLine = `${row.factory_id || "unknown"} repo=${row.target_repo || "(unknown)"} health=${row.health || "unknown"} release=${row.release_state || "unknown"} drift=${trim(row.drift_state) || "unknown"} channel=${trim(row.rollout_channel) || "general"} runtime=${trim(row.runtime_version) || "unknown"} kind=${trim(row.kind_version) || "unknown_kind_version"} active=${Array.isArray(row.active_waves) ? row.active_waves.length : 0}w/${Array.isArray(row.active_issues) ? row.active_issues.length : 0}i outcomes=${outcomeSummary}`;
    if (reason) {
      lines.push(`${baseLine} why=${reason}`);
    } else if (["healthy"].includes(String(row.health || ""))) {
      lines.push(baseLine);
    } else {
      lines.push(`${baseLine} why=state_degraded`);
    }
  }

  const warnings = Array.isArray(result?.warnings) ? result.warnings.filter(Boolean) : [];
  if (warnings.length > 0) {
    lines.push(`Data degraded: ${warnings.length} warning(s); first=${warnings[0]}`);
  }

  return lines.join("\n");
}
