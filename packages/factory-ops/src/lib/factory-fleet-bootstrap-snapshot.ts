import { dirname } from "node:path";

import { normalizeFactoryContext } from "./factory-context-resolver.ts";
import {
  classifyFleetFactoryHealth,
  readFactoryRegistry,
} from "./factory-fleet-projection-support.ts";
import { resolvePrimaryOpsRepo } from "./factory-repo-identity.ts";
import { inferFactoryRootFromRegistryEntry } from "./factory-status-collector.ts";
import { resolveRunsDir } from "./runs-dir-resolver.ts";

function trim(value = "") {
  return String(value ?? "").trim();
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
    drift_unknown: rows.length,
  };

  for (const row of rows) {
    const health = classifyFleetFactoryHealth(row);
    if (Object.hasOwn(totals, health)) totals[health] += 1;
  }

  return totals;
}

function computeFleetKpis(rows = [], lookbackHours = 24) {
  return {
    window_hours: Number(lookbackHours) || 24,
    factories_reporting: rows.length,
    daemons_running: rows.filter((row) => row?.daemon_health?.running === true).length,
    last_tick_known: 0,
    closed_goals: 0,
    closed_features: 0,
    closed_bugs: 0,
    merge_commits_main: 0,
    attention_factories: 0,
  };
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
    factory_root: factoryRoot ? `${rootDir}/${factoryRoot}` : "",
    factory_id: factoryId,
    target_repo: identity.target_repo,
    control_plane_repo: trim(controlPlaneRepo || entry.control_plane_repo || identity.target_repo),
    runs_dir: fallbackRunsDir,
  });
}

function bootstrapDaemonHealth(entry = {}) {
  const daemonStatus = entry?.daemon_status && typeof entry.daemon_status === "object"
    ? entry.daemon_status
    : {};
  const rawStatus = trim(daemonStatus.status);
  const status = rawStatus || "unknown";
  return {
    ...daemonStatus,
    status,
    running: status === "running",
    last_tick_at: trim(daemonStatus.last_tick_at),
  };
}

function createBootstrapFleetRow(entry = {}, { rootDir = process.cwd(), controlPlaneRepo = "" } = {}) {
  const context = buildFallbackContext({ entry, rootDir, controlPlaneRepo });
  return {
    factory_id: trim(entry.factory_id),
    kind_id: trim(entry.kind_id),
    target_repo: trim(context.target_repo || entry.target_repo),
    control_plane_repo: trim(context.control_plane_repo || entry.control_plane_repo || controlPlaneRepo),
    factory_root: trim(context.factory_root),
    runs_dir: trim(context.runs_dir),
    health: "idle",
    active_waves: [],
    active_issues: [],
    active_work_summary: "Loading live factory state…",
    blocked_reason: "",
    recent_host_activity: {
      count: 0,
      latest_summary: "Hydrating fleet state…",
      latest_graph: "",
    },
    recent_outcomes: [],
    daemon_health: bootstrapDaemonHealth(entry),
    managed_state: {
      state_action: "hydrating",
      reason: "Loading live factory state…",
      health_classification: "healthy",
    },
    release_state: "unknown",
    drift_state: "unknown",
    rollout_channel: "stable",
    runtime_version: "",
    kind_version: trim(entry.kind_id) || "unknown_kind_version",
    rollout_status: "unknown",
    upgrade_verification_outcome: "",
    gate_reason: "",
    warnings: [],
    bootstrap_loading: true,
  };
}

export function factoryFleetBootstrapSnapshot({
  context = {},
  registryPath = "factory-registry.json",
  cwd = process.cwd(),
  now = Date.now(),
  readFactoryRegistryFn = readFactoryRegistry,
} = {}) {
  const baseContext = normalizeFactoryContext(context);
  const generated_at = new Date(Number.isFinite(Number(now)) ? Number(now) : Date.now()).toISOString();
  const registry = readFactoryRegistryFn({ context: baseContext, registryPath, cwd });
  if (!registry.ok) {
    return {
      generated_at,
      registry_path: registry.registry_path,
      kpis: computeFleetKpis([], 24),
      fleet_totals: computeFleetTotals([]),
      warnings: [registry.reason, registry.error].filter(Boolean),
      factories: [],
    };
  }

  const rootDir = dirname(registry.registry_path || registryPath);
  const rows = registry.factories.map((entry) => createBootstrapFleetRow(entry, {
    rootDir,
    controlPlaneRepo: baseContext.control_plane_repo,
  }));

  return {
    generated_at,
    registry_path: registry.registry_path,
    kpis: computeFleetKpis(rows, 24),
    fleet_totals: computeFleetTotals(rows),
    warnings: rows.length > 0 ? ["fleet_bootstrap_snapshot"] : [],
    factories: rows,
  };
}
