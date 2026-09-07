import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";

import { trim } from "./cli-helpers.ts";
import { normalizeFactoryContext } from "./factory-context-resolver.ts";
import { resolveTargetRepoFromConfig, resolvePrimaryOpsRepo } from "./factory-repo-identity.ts";
import { resolveRunsDir } from "./runs-dir-resolver.ts";
import { loadFactoryConfig, resolveControlPlaneRepo } from "../commands/factory-config-loader.ts";
import { hostVersion } from "../commands/factory-host-lifecycle.ts";
import {
  factoryStatus,
  factoryActiveSummary,
} from "../commands/factory-status.ts";

const TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "suspended",
  "guarded",
  "guarded_terminal",
  "blocked",
  "terminal",
]);

const RUN_MANIFEST_FILE = "run-manifest.json";
const RUN_LIVE_FILE = "run-live.json";
const RUN_CHECKPOINT_FILE = "run-checkpoint.json";

function parseJson(raw, fallback = null) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function parseIssueNumber(value) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseIsoMs(value = "") {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function graphLabel(graph = "") {
  const raw = String(graph || "");
  if (!raw) return "";
  const parts = raw.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || raw;
}

function toRelativeFactoryRootFromGraphPath(graphPath = "") {
  const normalized = String(graphPath || "").replace(/\\/g, "/");
  const graphMarker = "/graphs/";
  const idx = normalized.lastIndexOf(graphMarker);
  if (idx > 0) return normalized.slice(0, idx);
  return dirname(normalized).replace(/\\/g, "/");
}

export function inferFactoryRootFromRegistryEntry(entry = {}) {
  const factoryId = trim(entry?.factory_id || entry?.id || entry?.instance_id);
  if (factoryId) {
    const canonicalFactoryRoot = join("factories", factoryId);
    if (existsSync(resolve(canonicalFactoryRoot, "factory.config.json"))) {
      return canonicalFactoryRoot;
    }
  }
  const graphs = Array.isArray(entry?.graphs) ? entry.graphs : [];
  for (const graph of graphs) {
    const root = toRelativeFactoryRootFromGraphPath(graph?.path || "");
    if (root) return root;
  }
  return "";
}

function resolveBlockedState(status = {}) {
  const managedState = status?.managed_state && typeof status.managed_state === "object"
    ? status.managed_state
    : {};
  const managedClass = trim(managedState.health_classification);
  const managedReason = trim(managedState.reason);

  if (["operator_paused", "operator_quarantined"].includes(managedClass)) {
    return {
      blocked: true,
      blocked_reason: managedReason || managedClass,
    };
  }

  const controlPlane = status?.control_plane && typeof status.control_plane === "object"
    ? status.control_plane
    : {};
  const blockedItems = Array.isArray(status?.blocked_control_plane)
    ? status.blocked_control_plane
    : [];

  if (controlPlane.can_resume === false) {
    const reason = trim(controlPlane.resume_when) || trim(controlPlane.resume_reason) || "control_plane_gate_blocked";
    return { blocked: true, blocked_reason: reason };
  }

  if (blockedItems.length > 0) {
    const first = blockedItems[0] || {};
    const wave = trim(first.milestone) || "(no wave)";
    const issue = Number.isFinite(Number(first.issue_number)) ? ` issue #${Number(first.issue_number)}` : "";
    const unblock = trim(first.unblockCondition) || trim(first.status) || "awaiting_control_plane_update";
    return {
      blocked: true,
      blocked_reason: `${wave}${issue}: ${unblock}`,
    };
  }

  return { blocked: false, blocked_reason: "" };
}

function normalizeReleaseState(status = {}) {
  const controlPlane = status?.control_plane && typeof status.control_plane === "object"
    ? status.control_plane
    : {};
  const reason = trim(controlPlane.resume_reason);
  if (reason === "ready_to_resume") return "ready";
  if (reason === "release_not_promoted_to_general") return "upgrading";
  if (reason === "release_rollout_blocked") return "blocked";
  if (reason === "control_plane_manifest_unavailable") return "unknown";
  return reason || "unknown";
}

function summarizeWaveActivity(wave = {}) {
  const waveId = trim(wave.milestone_title) || "(no wave)";
  const issueNumber = parseIssueNumber(wave.current_issue_number);
  const issueNode = trim(wave.current_issue_node) || "unknown";
  const completed = Number.isFinite(Number(wave.completed_issues)) ? Number(wave.completed_issues) : 0;
  const total = Number.isFinite(Number(wave.total_issues)) ? Number(wave.total_issues) : 0;
  return {
    wave_id: waveId,
    issue_title: issueNumber
      ? `Issue #${issueNumber} @ ${issueNode} (${completed}/${total})`
      : `No claimed issue @ ${issueNode} (${completed}/${total})`,
  };
}

function summarizeNonWaveActivity(run = {}) {
  const graph = trim(run.graph_label || run.graph) || "(unknown graph)";
  const issueNumber = parseIssueNumber(run.issue_number);
  const node = trim(run.node) || "unknown";
  return {
    wave_id: "non-wave",
    issue_title: issueNumber
      ? `${graph}: issue #${issueNumber} @ ${node}`
      : `${graph}: @ ${node}`,
  };
}

function buildActiveWork(summary = {}) {
  const waves = Array.isArray(summary?.waves) ? summary.waves : [];
  const nonWave = Array.isArray(summary?.non_wave_active) ? summary.non_wave_active : [];

  const activity = waves.map(summarizeWaveActivity);
  if (activity.length === 0) {
    for (const run of nonWave.slice(0, 3)) {
      activity.push(summarizeNonWaveActivity(run));
    }
  }
  return activity;
}

function ensureDirEntries(dir = "") {
  try {
    return readdirSync(dir)
      .map((name) => ({ name, path: join(dir, name) }))
      .filter((entry) => {
        try {
          return statSync(entry.path).isDirectory();
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}

function isRunManifest(raw = {}) {
  return raw
    && typeof raw === "object"
    && typeof raw.runId === "string"
    && typeof raw.schemaVersion === "string"
    && Array.isArray(raw.artifacts);
}

function readRunManifest(runDir = "") {
  if (!runDir) return null;
  const manifestPath = join(runDir, RUN_MANIFEST_FILE);
  if (!existsSync(manifestPath)) return null;
  const parsed = parseJson(readFileSync(manifestPath, "utf8"), null);
  return isRunManifest(parsed) ? parsed : null;
}

function readRunLiveFromManifest(runDir = "", manifest = null) {
  if (!runDir || !manifest) return null;
  const liveArtifact = (manifest.artifacts || []).find((entry) => String(entry?.key || "") === "run_live");
  const liveFile = trim(liveArtifact?.file || RUN_LIVE_FILE);
  if (!liveFile) return null;
  const livePath = join(runDir, liveFile);
  if (!existsSync(livePath)) return null;
  const parsed = parseJson(readFileSync(livePath, "utf8"), null);
  return parsed && typeof parsed === "object" ? parsed : null;
}

function resolveRunIssueNumberFromLive(live = {}) {
  return parseIssueNumber(
    live?.issueNumber
    || live?.issue_number
    || live?.currentIssueNumber
    || live?.current_issue_number,
  );
}

function resolveRunUpdatedAtFromLive(live = {}, manifest = {}) {
  const updatedAt = trim(live?.updatedAt || live?.updated_at || manifest?.generatedAt);
  return updatedAt || "";
}

function buildOutcomeSummaryFromManifest({ manifest = {}, live = {}, runId = "" } = {}) {
  const status = trim(live?.status || "unknown") || "unknown";
  const graph = graphLabel(trim(manifest?.pipelineFile));
  const issue = resolveRunIssueNumberFromLive(live, manifest);
  const node = trim(live?.currentNode || live?.current_node);

  const parts = [status];
  if (graph) parts.push(graph);
  if (issue) parts.push(`#${issue}`);
  if (node) parts.push(`node=${node}`);
  if (!graph && !node) parts.push(`run=${runId}`);
  return parts.join(" ");
}

function collectLastOutcomes({ runsDir = ".hatch/runs", limit = 3 } = {}) {
  const terminal = [];
  for (const entry of ensureDirEntries(runsDir)) {
    const manifest = readRunManifest(entry.path);
    if (!manifest) continue;
    const live = readRunLiveFromManifest(entry.path, manifest);
    if (!live) continue;
    const status = trim(live?.status || "").toLowerCase();
    if (!TERMINAL_STATUSES.has(status)) continue;
    const runId = trim(manifest?.runId || entry.name);
    const updatedAt = resolveRunUpdatedAtFromLive(live, manifest);
    terminal.push({
      run_id: runId,
      status,
      updated_at: updatedAt,
      summary: buildOutcomeSummaryFromManifest({ manifest, live, runId }),
      _updated_ms: parseIsoMs(updatedAt),
    });
  }

  terminal.sort((a, b) => {
    if (a._updated_ms !== b._updated_ms) return b._updated_ms - a._updated_ms;
    return String(a.run_id).localeCompare(String(b.run_id));
  });

  return terminal.slice(0, Math.max(1, Number(limit) || 3)).map((item) => ({
    run_id: item.run_id,
    status: item.status,
    updated_at: item.updated_at,
    summary: item.summary,
  }));
}

function collectRunArtifactPaths({ runsDir = ".hatch/runs", limit = 3 } = {}) {
  const rows = [];
  for (const entry of ensureDirEntries(runsDir)) {
    const manifest = readRunManifest(entry.path);
    if (!manifest) continue;
    const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
    const resolveFile = (key, fallback) => {
      const match = artifacts.find((artifact) => String(artifact?.key || "") === key);
      return trim(match?.file || fallback) || fallback;
    };

    const runId = trim(manifest.runId || entry.name);
    const liveFile = resolveFile("run_live", RUN_LIVE_FILE);
    const livePath = join(entry.path, liveFile);
    const live = existsSync(livePath)
      ? parseJson(readFileSync(livePath, "utf8"), null)
      : null;
    const updatedAt = resolveRunUpdatedAtFromLive(live || {}, manifest);

    rows.push({
      run_id: runId,
      updated_at: updatedAt,
      _updated_ms: parseIsoMs(updatedAt),
      paths: {
        run_dir: entry.path,
        manifest: join(entry.path, resolveFile("run_manifest", RUN_MANIFEST_FILE)),
        live: join(entry.path, liveFile),
        checkpoint: join(entry.path, resolveFile("run_checkpoint", RUN_CHECKPOINT_FILE)),
        conclusion: join(entry.path, resolveFile("run_conclusion", "run-conclusion.json")),
        state: join(entry.path, resolveFile("run_state", "state.json")),
        metadata: join(entry.path, resolveFile("run_metadata", "metadata.json")),
        alignment_summary: join(entry.path, resolveFile("run_alignment_summary", "alignment-summary.json")),
      },
    });
  }

  rows.sort((a, b) => {
    if (a._updated_ms !== b._updated_ms) return b._updated_ms - a._updated_ms;
    return String(a.run_id).localeCompare(String(b.run_id));
  });

  return rows.slice(0, Math.max(1, Number(limit) || 3)).map((row) => ({
    run_id: row.run_id,
    updated_at: row.updated_at,
    paths: row.paths,
    summary: `manifest=${row.paths.manifest} live=${row.paths.live} checkpoint=${row.paths.checkpoint}`,
  }));
}

function normalizeDaemonState(daemonStatus = {}) {
  const raw = daemonStatus && typeof daemonStatus === "object" ? daemonStatus : {};
  const pid = Number(raw.pid);
  return {
    status: trim(raw.status) || "unknown",
    pid: Number.isFinite(pid) && pid > 0 ? Math.trunc(pid) : null,
    last_tick_at: trim(raw.last_tick_at) || null,
    run_id: trim(raw.run_id) || null,
  };
}

function deriveHealthStatus({ blocked = false, activeCount = 0, failedCount = 0, daemonState = {}, managedState = {} } = {}) {
  const managedClass = trim(managedState?.health_classification);
  if (["operator_paused", "operator_quarantined", "control_plane_blocked"].includes(managedClass)) return "blocked";
  if (managedClass === "locally_unhealthy") return "unhealthy";
  if (blocked) return "blocked";
  if (failedCount > 0) return "unhealthy";
  if (daemonState?.status === "stopped" && activeCount > 0) return "unhealthy";
  if (activeCount > 0) return "healthy";
  return "idle";
}

function resolveFactoryConfig({ factoryRoot = "", rootDir = process.cwd(), warnings = [] } = {}) {
  const relativeRoot = trim(factoryRoot);
  if (!relativeRoot) return { root: "", config: {} };

  const resolvedRoot = resolve(rootDir, relativeRoot);
  const configPath = join(resolvedRoot, "factory.config.json");
  if (!existsSync(configPath)) {
    warnings.push(`factory config missing at ${configPath}`);
    return { root: resolvedRoot, config: {} };
  }

  try {
    const loaded = loadFactoryConfig({
      factoryRoot: resolvedRoot,
      requiredKeys: ["factory_id", "control_plane_repo"],
    });
    return {
      root: resolvedRoot,
      config: loaded?.config && typeof loaded.config === "object" ? loaded.config : {},
    };
  } catch (error) {
    warnings.push(`factory config unreadable: ${String(error?.message || error)}`);
    return { root: resolvedRoot, config: {} };
  }
}

export function collectFactoryStatus({
  factoryId = "",
  targetRepo = "",
  controlPlaneRepo = "",
  runsDir = "",
  factoryRoot = "",
  daemonStatus = {},
  rootDir = process.cwd(),
} = {}) {
  const warnings = [];
  const daemon_state = normalizeDaemonState(daemonStatus);
  const configured = resolveFactoryConfig({ factoryRoot, rootDir, warnings });
  const config = configured.config || {};

  const normalizedFactoryId = trim(factoryId || config.factory_id);
  const configuredTargetRepo = (() => {
    try {
      return resolveTargetRepoFromConfig(config, {
        factoryId: normalizedFactoryId,
        requireResolved: false,
      });
    } catch {
      return "";
    }
  })();
  const normalizedInputTargetRepo = trim(targetRepo || configuredTargetRepo);

  const targetRepoInput = trim(targetRepo || config.target_repo || "");
  let repoIdentity;
  try {
    repoIdentity = resolvePrimaryOpsRepo({
      context: {
        factory_id: normalizedFactoryId,
        target_repo: normalizedInputTargetRepo || targetRepoInput,
      },
      factoryId: normalizedFactoryId,
      requireResolved: false,
    });
  } catch (error) {
    warnings.push(`repo_identity_resolution_failed:${String(error?.message || error)}`);
    repoIdentity = {
      primary_repo: normalizedInputTargetRepo,
      target_repo: targetRepoInput,
    };
  }

  const normalizedPrimaryRepo = trim(repoIdentity.primary_repo || normalizedInputTargetRepo || "");
  const normalizedTargetRepo = trim(repoIdentity.target_repo || normalizedPrimaryRepo || targetRepoInput);

  let resolvedControlPlaneFromConfig = "";
  try {
    resolvedControlPlaneFromConfig = resolveControlPlaneRepo(config);
  } catch {
    resolvedControlPlaneFromConfig = "";
  }

  const normalizedControlPlaneRepo = trim(controlPlaneRepo || resolvedControlPlaneFromConfig || normalizedPrimaryRepo || normalizedTargetRepo);

  const configuredRunsDir = trim(runsDir || config.runs_dir || "");
  const scopedRunsDir = configuredRunsDir
    ? resolve(rootDir, configuredRunsDir)
    : resolveRunsDir({ factoryId: normalizedFactoryId });

  const context = normalizeFactoryContext({
    factory_root: configured.root || trim(factoryRoot),
    factory_id: normalizedFactoryId,
    target_repo: normalizedPrimaryRepo,
    control_plane_repo: normalizedControlPlaneRepo,
    runs_dir: scopedRunsDir,
  });

  let status;
  let activeSummary;
  try {
    status = factoryStatus({ runsDir: context.runs_dir, context });
    activeSummary = factoryActiveSummary({ runsDir: context.runs_dir, context });
  } catch (error) {
    return {
      factory_id: normalizedFactoryId || trim(factoryId) || "unknown",
      target_repo: normalizedPrimaryRepo || null,
      control_plane_repo: normalizedControlPlaneRepo || null,
      version: null,
      release_state: "error",
      blocked: false,
      blocked_reason: null,
      managed_state: null,
      active_work: [],
      last_outcomes: [],
      run_artifacts: [],
      health_status: "unhealthy",
      daemon_state,
      warnings,
      error_message: String(error?.message || error),
    };
  }

  const blocked = resolveBlockedState(status);
  const release_state = normalizeReleaseState(status);
  const managedState = status?.managed_state && typeof status.managed_state === "object"
    ? status.managed_state
    : null;

  const versionResult = hostVersion({
    factoryRoot: context.factory_root || rootDir,
    factoryId: context.factory_id,
  });
  const version = trim(versionResult?.version);
  if (!version || version === "unknown") {
    warnings.push("factory version unavailable");
  }

  const active_work = buildActiveWork(activeSummary);
  const last_outcomes = collectLastOutcomes({ runsDir: context.runs_dir, limit: 3 });
  const run_artifacts = collectRunArtifactPaths({ runsDir: context.runs_dir, limit: 3 });
  const activeCount = Number(activeSummary?.active_run_count || 0);
  const failedCount = Number(status?.failed || 0);

  return {
    factory_id: context.factory_id || "unknown",
    target_repo: context.target_repo || null,
    control_plane_repo: context.control_plane_repo || null,
    version: version && version !== "unknown" ? version : null,
    release_state,
    blocked: blocked.blocked,
    blocked_reason: blocked.blocked_reason || null,
    managed_state: managedState,
    active_work,
    last_outcomes,
    run_artifacts,
    health_status: deriveHealthStatus({
      blocked: blocked.blocked,
      activeCount,
      failedCount,
      daemonState: daemon_state,
      managedState,
    }),
    daemon_state,
    warnings,
  };
}
