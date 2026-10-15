import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  describeUnblockCondition,
  extractBlockerRefIssueNumber,
  parseControlPlaneBlocker,
} from "./control-plane-blocker.ts";
import { buildControlPlaneStatus, resolveControlPlaneHatchRoot } from "./control-plane-status.ts";
import {
  getExternalFactoryControlActiveAction,
  readExternalFactoryControlState,
} from "./external-factory-control-state.ts";
import {
  normalizeFactoryContext,
} from "./factory-context-resolver.ts";
import { resolveSessionTrace } from "./factory-session-log.ts";
import {
  presentFactoryStatus,
  presentFactoryActiveSummary,
  renderFactoryPresentation,
} from "./factory-status-presenter.ts";
import { resolveGoalExecutionPathMetadata } from "./goal-execution-path-visibility.ts";
import { listPersistedPackets } from "./packet-core.ts";

function parseJson(raw, fallback) {
  try { return JSON.parse(raw); } catch { return fallback; }
}

function readMetadata(runDir) {
  try {
    return parseJson(readFileSync(join(runDir, "metadata.json"), "utf8"), null);
  } catch {
    return null;
  }
}

function isProcessAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function parseIsoMs(value) {
  if (!value) return 0;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : 0;
}

export function deriveRunAgeSignals(run = {}, {
  now = Date.now(),
  fallbackUpdatedMs = 0,
} = {}) {
  const nowMs = Number(now);
  const safeNow = Number.isFinite(nowMs) ? nowMs : Date.now();
  const startedAt = String(run.started_at || run.startedAt || run.createdAt || "").trim();
  const updatedAt = String(run.updated_at || run.updatedAt || "").trim();
  const startedMs = parseIsoMs(startedAt);
  const updatedMs = parseIsoMs(updatedAt) || Number(fallbackUpdatedMs) || 0;
  const ageMs = startedMs > 0
    ? Math.max(0, safeNow - startedMs)
    : (updatedMs > 0 ? Math.max(0, safeNow - updatedMs) : 0);
  const lastProgressAgeMs = updatedMs > 0 ? Math.max(0, safeNow - updatedMs) : 0;

  return {
    age_ms: ageMs,
    age: duration(ageMs),
    last_progress_age_ms: lastProgressAgeMs,
    last_progress_age: duration(lastProgressAgeMs),
  };
}

export function resolveControlStateRootDir({ runsDir = ".hatch/runs", context = {} } = {}) {
  const controlPlaneHatchRoot = resolveControlPlaneHatchRoot({ runsDir, context });
  const normalizedControlPlaneHatchRoot = String(controlPlaneHatchRoot || "").replace(/\\/g, "/");
  if (normalizedControlPlaneHatchRoot.endsWith("/.hatch") || normalizedControlPlaneHatchRoot === ".hatch") {
    return dirname(controlPlaneHatchRoot);
  }

  const rawRunsDir = String(runsDir || "").trim() || ".hatch/runs";
  const forward = rawRunsDir.replace(/\\/g, "/").replace(/\/+$/, "");
  const scoped = forward.match(/^(.*\/\.hatch)(?:\/[^/]+)?\/runs$/);
  const hatchRoot = scoped?.[1]
    ? scoped[1]
    : (forward.endsWith("/runs") ? dirname(rawRunsDir) : (dirname(rawRunsDir) || ".hatch"));
  const normalizedHatchRoot = String(hatchRoot || "").replace(/\\/g, "/");
  if (normalizedHatchRoot.endsWith("/.hatch") || normalizedHatchRoot === ".hatch") {
    return dirname(hatchRoot);
  }
  if (normalizedHatchRoot && normalizedHatchRoot !== ".") {
    return hatchRoot;
  }
  return process.cwd();
}

function deriveControlPlaneBlockedReason(controlPlane = {}, blockedControlPlane = []) {
  if (Array.isArray(blockedControlPlane) && blockedControlPlane.length > 0) {
    const first = blockedControlPlane[0] || {};
    return String(first.unblockCondition || first.status || controlPlane.resume_when || controlPlane.resume_reason || "")
      .trim();
  }
  return String(controlPlane.resume_when || controlPlane.resume_reason || "").trim();
}

function isCircuitBreakerPauseReason(reason = "") {
  const normalized = String(reason || "").trim().toLowerCase();
  return normalized.startsWith("circuit_breaker_after_") || normalized.startsWith("circuit_breaker_blocking_after_");
}

export function deriveManagedState({
  controlState = {},
  controlPlane = {},
  blockedControlPlane = [],
  failed = 0,
  latestFailedMs = 0,
  latestCompletedMs = 0,
} = {}) {
  const stateAction = getExternalFactoryControlActiveAction(controlState);
  const reason = String(controlState?.reason || "").trim();
  const retryTarget = String(controlState?.retry_target || "").trim();

  if (stateAction === "pause") {
    return {
      state_action: "pause",
      reason,
      retry_target: retryTarget,
      health_classification: isCircuitBreakerPauseReason(reason) ? "locally_unhealthy" : "operator_paused",
    };
  }

  if (stateAction === "quarantine") {
    return {
      state_action: "quarantine",
      reason,
      retry_target: retryTarget,
      health_classification: "operator_quarantined",
    };
  }

  const controlPlaneBlocked = controlPlane?.can_resume === false
    || (Array.isArray(blockedControlPlane) && blockedControlPlane.length > 0);
  if (controlPlaneBlocked) {
    return {
      state_action: stateAction,
      reason: deriveControlPlaneBlockedReason(controlPlane, blockedControlPlane) || reason,
      retry_target: retryTarget,
      health_classification: "control_plane_blocked",
    };
  }

  if (stateAction === "resume") {
    return {
      state_action: stateAction,
      reason: "",
      retry_target: retryTarget,
      health_classification: "healthy",
    };
  }

  const hasUnrecoveredFailures = Number(failed) > 0
    && !(Number(latestCompletedMs) > 0 && Number(latestCompletedMs) > Number(latestFailedMs));

  if (stateAction === "retry" || stateAction === "unblock" || hasUnrecoveredFailures) {
    return {
      state_action: stateAction,
      reason,
      retry_target: retryTarget,
      health_classification: "locally_unhealthy",
    };
  }

  return {
    state_action: stateAction,
    reason,
    retry_target: retryTarget,
    health_classification: "healthy",
  };
}

const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "suspended"]);

function readRunStateStatus(runsDir = "", runId = "") {
  if (!runsDir || !runId) return "";
  try {
    const raw = readFileSync(join(runsDir, runId, "state.json"), "utf8");
    const parsed = parseJson(raw, null);
    return String(parsed?.status || "").toLowerCase().trim();
  } catch {
    return "";
  }
}

export function summarizeOpenPackets({ runsDir = "", nowMs = Date.now() } = {}) {
  return listPersistedPackets({
    runsDir,
    durableOnly: true,
    packetState: "open",
    nowMs,
    windowMs: 7 * 24 * 60 * 60 * 1000,
  })
    .filter((entry) => {
      const packet = entry.packet || {};
      const runId = String(packet.run_id || entry.run_id || "").trim();
      // Exclude packets whose source run has already reached a terminal state.
      // A merge_conflict_packet (or any durable packet) that is still "open"
      // on disk but belongs to a completed/failed run is stale residue — the
      // run finished without closing the packet (e.g. push completed, run
      // ended, packet never got superseded).  Surfacing it as "open" in
      // factory status misleads operators during unrelated incidents.
      if (runId && runsDir) {
        const runStatus = readRunStateStatus(runsDir, runId);
        if (runStatus && TERMINAL_RUN_STATUSES.has(runStatus)) return false;
      }
      return true;
    })
    .slice(0, 10)
    .map((entry) => {
      const packet = entry.packet || {};
      const refs = packet.resource_refs && typeof packet.resource_refs === "object" ? packet.resource_refs : {};
      return {
        packet_id: String(packet.packet_id || "").trim(),
        packet_type: String(packet.packet_type || "").trim(),
        packet_state: String(packet.packet_state || "").trim(),
        packet_path: String(entry.packet_path || "").trim(),
        run_id: String(packet.run_id || entry.run_id || "").trim(),
        pipeline: String(packet.pipeline || "").trim(),
        node_id: String(packet.node_id || "").trim(),
        title: String(refs.milestone_title || packet.intent || packet.packet_type || "").trim(),
      };
    });
}

/**
 * Deterministic threshold used by active-summary operator signals.
 * Rows with no progress beyond this window are marked stalled.
 */
export const ACTIVE_SUMMARY_STALLED_THRESHOLD_MS = 15 * 60 * 1000;

export function expectedNextOutcomeForNode(nodeName = "") {
  const node = String(nodeName || "").trim().toLowerCase();
  if (!node) return "run state update";
  if (node === "claim_wave" || node.includes("claim_wave")) return "wave assigned";
  if (node === "dispatch_issue" || node.includes("dispatch_issue")) return "issue claimed";
  if (node === "review" || node.includes("review")) return "review decision";
  if (node === "execute_issue" || node.includes("execute_issue") || node === "build") return "issue run completes";
  return "run state update";
}

/**
 * Compute operator-facing telemetry for active-summary rows from supplied run metadata.
 * Pure helper: no fs/process access, deterministic from inputs only.
 */
export function describeOperatorSignals(run = {}, { now = Date.now(), node = "" } = {}) {
  const nowMs = Number(now);
  const safeNow = Number.isFinite(nowMs) ? nowMs : Date.now();
  const fallbackNode = String(node || run.current_issue_node || run.current_node || run.node || "");
  const lastProgressAt = String(run.last_progress_at || run.updated_at || run.updatedAt || run.started_at || run.startedAt || "").trim();
  const lastProgressMs = parseIsoMs(lastProgressAt);
  const lastProgressAgeMs = lastProgressMs > 0 ? Math.max(0, safeNow - lastProgressMs) : 0;

  return {
    last_progress_at: lastProgressAt,
    last_progress_age_ms: lastProgressAgeMs,
    stalled: lastProgressMs > 0 ? lastProgressAgeMs >= ACTIVE_SUMMARY_STALLED_THRESHOLD_MS : false,
    stalled_threshold_ms: ACTIVE_SUMMARY_STALLED_THRESHOLD_MS,
    expected_next_outcome: expectedNextOutcomeForNode(fallbackNode),
  };
}

function isStaleOrphanedActiveRun({ state, runDir, now, staleMs }) {
  const status = String(state?.status || "");
  if (status !== "running") return false;

  const metadata = readMetadata(runDir) || {};
  const heartbeatMs = parseIsoMs(metadata.heartbeatAt);
  const stateUpdatedMs = parseIsoMs(state.updatedAt);
  const freshestMs = Math.max(heartbeatMs, stateUpdatedMs);
  if (!freshestMs) return false;

  const stale = now - freshestMs >= staleMs;
  if (!stale) return false;

  const pid = Number(metadata.pid ?? state.pid);
  return !isProcessAlive(pid);
}

export function readState(runDir) {
  try {
    return JSON.parse(readFileSync(join(runDir, "state.json"), "utf8"));
  } catch { return null; }
}

export function mtime(filePath) {
  try { return statSync(filePath).mtimeMs; } catch { return 0; }
}

export function duration(ms) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m${rem}s`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60}m`;
}

function createChildId(parentNodeId = "", runId = "") {
  const node = String(parentNodeId || "").trim();
  const childRunId = String(runId || "").trim();
  if (node && childRunId) return `${node}__${childRunId}`;
  return node || childRunId;
}

function normalizeChildRole(value = "") {
  const role = String(value || "").trim().toLowerCase();
  if (["coder", "reviewer", "manager", "judge"].includes(role)) return role;
  return "";
}

function normalizeChildStatus(value = "") {
  const status = String(value || "").trim().toLowerCase();
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  return "running";
}

function normalizeWorkerIndex(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
}

function roleFromNodeId(nodeId = "") {
  const node = String(nodeId || "").trim().toLowerCase();
  if (!node) return "";
  if (node === "build" || node.includes("build")) return "coder";
  if (node === "review" || node.includes("review")) return "reviewer";
  if (node === "judge" || node.includes("judge")) return "judge";
  if (node.startsWith("supervisor_") || node.includes("manager") || node === "resolve_conflict") return "manager";
  return "";
}

function rolePriority(role = "") {
  if (role === "reviewer") return 4;
  if (role === "coder") return 3;
  if (role === "manager") return 2;
  if (role === "judge") return 1;
  return 0;
}

export function parseActiveChildrenInState(state = {}) {
  const ctx = state.context || {};
  const activeChildrenRaw = state.activeChildren && typeof state.activeChildren === "object"
    ? state.activeChildren
    : {};

  const childrenById = new Map();

  for (const [entryKey, value] of Object.entries(activeChildrenRaw)) {
    if (!value || typeof value !== "object") continue;
    const child = value;
    const childRunDir = String(child.childRunDir || child.child_run_dir || "").trim();
    const childRunId = String(child.childRunId || child.child_run_id || (childRunDir ? childRunDir.split("/").pop() : "") || "").trim();
    const parentNodeIdRaw = String(child.parentNodeId || child.parent_node_id || "").trim();
    const inferredParentNodeId = parentNodeIdRaw
      || (childRunId && String(entryKey).endsWith(`__${childRunId}`)
        ? String(entryKey).slice(0, Math.max(0, String(entryKey).length - (`__${childRunId}`).length))
        : String(entryKey));
    const childId = String(child.childId || child.child_id || createChildId(inferredParentNodeId, childRunId) || entryKey).trim();
    const role = normalizeChildRole(child.role) || roleFromNodeId(child.currentNode || inferredParentNodeId);
    const traceKind = String(child.traceKind || child.trace_kind || role || "run").trim() || "run";
    childrenById.set(childId, {
      child_id: childId,
      parent_node_id: inferredParentNodeId,
      run_id: childRunId,
      role,
      trace_kind: traceKind,
      worker_index: normalizeWorkerIndex(child.workerIndex ?? child.worker_index),
      status: normalizeChildStatus(child.status),
      current_node: String(child.currentNode || "").trim(),
      session_id: String(child.sessionId || child.session_id || "").trim(),
      _source: "state.activeChildren",
    });
  }

  for (const [key, value] of Object.entries(ctx)) {
    if (!key.startsWith("__child_run_id_")) continue;
    const parentNodeId = key.replace("__child_run_id_", "").trim();
    const runId = String(value || "").trim();
    if (!parentNodeId || !runId) continue;
    const childId = String(ctx[`__child_id_${parentNodeId}`] || createChildId(parentNodeId, runId)).trim();
    const existing = childrenById.get(childId);
    if (existing) {
      if (!existing.run_id) existing.run_id = runId;
      if (!existing.parent_node_id) existing.parent_node_id = parentNodeId;
      if (!existing.role) existing.role = roleFromNodeId(existing.current_node || parentNodeId);
      if (!existing.trace_kind) existing.trace_kind = existing.role || "run";
      continue;
    }
    const inferredRole = roleFromNodeId(parentNodeId);
    childrenById.set(childId, {
      child_id: childId,
      parent_node_id: parentNodeId,
      run_id: runId,
      role: inferredRole,
      trace_kind: inferredRole || "run",
      worker_index: null,
      status: "running",
      current_node: "",
      session_id: "",
      _source: "context.__child_run_id",
    });
  }

  return [...childrenById.values()].sort((a, b) => {
    if (a.parent_node_id !== b.parent_node_id) return String(a.parent_node_id).localeCompare(String(b.parent_node_id));
    return String(a.child_id).localeCompare(String(b.child_id));
  });
}

function selectTraceChild(run, byId) {
  const candidates = Array.isArray(run?.active_children) ? run.active_children : [];
  const enriched = candidates
    .map((child) => {
      const childRun = byId.get(child.run_id);
      if (!childRun) return null;
      return {
        child,
        childRun,
        runStatus: String(childRun.status || "").toLowerCase(),
        childStatus: String(child.status || "").toLowerCase(),
        role: normalizeChildRole(child.role),
        updatedMs: parseIsoMs(childRun.updated_at || childRun.updatedAt),
      };
    })
    .filter(Boolean);

  if (enriched.length === 0) return null;

  enriched.sort((left, right) => {
    const leftRunning = left.runStatus === "running" && left.childStatus === "running" ? 1 : 0;
    const rightRunning = right.runStatus === "running" && right.childStatus === "running" ? 1 : 0;
    if (leftRunning !== rightRunning) return rightRunning - leftRunning;
    const leftRole = rolePriority(left.role);
    const rightRole = rolePriority(right.role);
    if (leftRole !== rightRole) return rightRole - leftRole;
    if (left.updatedMs !== right.updatedMs) return right.updatedMs - left.updatedMs;
    return String(left.child.child_id || "").localeCompare(String(right.child.child_id || ""));
  });

  return enriched[0];
}

export function resolveGraph(state) {
  const pipeline = state.pipeline || state.graph?.label || "";
  // Try to extract from child pipeline keys
  if (!pipeline) {
    const ctx = state.context || {};
    for (const k of Object.keys(ctx)) {
      if (k.startsWith("__child_pipeline_")) return k.replace("__child_pipeline_", "");
    }
  }
  return pipeline;
}

export function resolveIssue(state) {
  const ctx = state.context || {};
  return ctx.current_issue_number || ctx.issue_number || ctx.target_issue_number || ctx.goal_issue_number || "";
}

export function resolveMilestone(state) {
  return (state.context || {}).milestone_title || "";
}

function normalizePathForPrefix(value = "") {
  return String(value || "").replace(/\\/g, "/").replace(/\/+$/, "");
}

function isRunWithinFactoryRoot(state = {}, factoryRoot = "") {
  const normalizedFactoryRoot = normalizePathForPrefix(factoryRoot);
  if (!normalizedFactoryRoot) return true;

  const pipeline = normalizePathForPrefix(resolveGraph(state));
  if (!pipeline) return true;
  if (!pipeline.startsWith("/")) return true;
  return pipeline === normalizedFactoryRoot || pipeline.startsWith(`${normalizedFactoryRoot}/`);
}

function normalizeRepoIdentity(value = "") {
  return String(value || "").trim().toLowerCase();
}

function isRunOwnedByFactory(state = {}, context = {}) {
  if (isRunWithinFactoryRoot(state, context.factory_root)) return true;

  const runContext = state?.context && typeof state.context === "object" ? state.context : {};
  const factoryIds = new Set([
    String(context.factory_id || "").trim(),
    String(context.instance_id || "").trim(),
    String(context.kind_id || "").trim(),
  ].filter(Boolean));
  for (const candidate of [
    runContext.factory_id,
    runContext.instance_id,
    runContext.kind_id,
  ]) {
    if (factoryIds.has(String(candidate || "").trim())) return true;
  }

  const targetRepos = new Set([
    normalizeRepoIdentity(context.target_repo),
    normalizeRepoIdentity(context.target_repo),
  ].filter(Boolean));
  for (const candidate of [
    runContext.target_repo,
    runContext.target_repo,
    runContext.repo,
  ]) {
    if (targetRepos.has(normalizeRepoIdentity(candidate))) return true;
  }

  return false;
}

function normalizeControlPlaneBlockedEntry(entry = {}, fallbackMilestone = "") {
  const parsed = parseControlPlaneBlocker(entry);
  if (!parsed.kind && !parsed.status && !parsed.blockerRef && !parsed.unblockCondition) return null;
  const linkedGoal = extractBlockerRefIssueNumber(parsed);
  return {
    milestone: String(entry?.milestone || fallbackMilestone || "").trim(),
    issue_number: Number.isFinite(Number(entry?.issue_number)) ? Number(entry.issue_number) : null,
    blockerKind: parsed.kind || "",
    blockerRef: parsed.blockerRef || "",
    unblockCondition: describeUnblockCondition(parsed) || "",
    status: parsed.status || "",
    linked_goal_number: linkedGoal ? Number(linkedGoal) : 0,
  };
}

export function parseControlPlaneBlockedFromContext(context = {}) {
  const ctx = context && typeof context === "object" ? context : {};
  const blockerActiveRaw = String(ctx.blocker_active || "").trim().toLowerCase();
  if (blockerActiveRaw === "false") return [];
  const blockedItemsRaw = Array.isArray(ctx.control_plane_blocked_items)
    ? ctx.control_plane_blocked_items
    : parseJson(String(ctx.control_plane_blocked_items || "[]"), []);
  const blockedWavesRaw = Array.isArray(ctx.control_plane_blocked_waves)
    ? ctx.control_plane_blocked_waves
    : parseJson(String(ctx.control_plane_blocked_waves || "[]"), []);
  const fallbackMilestone = String(ctx.milestone_title || "").trim();
  const blocked = [];

  for (const item of Array.isArray(blockedItemsRaw) ? blockedItemsRaw : []) {
    const normalized = normalizeControlPlaneBlockedEntry(item, fallbackMilestone);
    if (normalized) blocked.push(normalized);
  }

  for (const wave of Array.isArray(blockedWavesRaw) ? blockedWavesRaw : []) {
    const waveMilestone = String(wave?.milestone || fallbackMilestone || "").trim();
    for (const issue of Array.isArray(wave?.issues) ? wave.issues : []) {
      const normalized = normalizeControlPlaneBlockedEntry(issue, waveMilestone);
      if (normalized) blocked.push(normalized);
    }
  }

  const deduped = new Map();
  for (const item of blocked) {
    const key = `${item.milestone}:${item.issue_number ?? ""}:${item.blockerKind}:${item.blockerRef}:${item.unblockCondition}:${item.status}`;
    deduped.set(key, item);
  }

  return [...deduped.values()].sort((a, b) => {
    if (a.milestone !== b.milestone) return String(a.milestone).localeCompare(String(b.milestone));
    return Number(a.issue_number || 0) - Number(b.issue_number || 0);
  });
}

export function readAllRunStates({ runsDir = ".hatch/runs" } = {}) {
  const states = new Map();
  let entries;
  try { entries = readdirSync(runsDir); } catch { return states; }
  for (const id of entries) {
    const dir = join(runsDir, id);
    const state = readState(dir);
    if (state) {
      states.set(id, {
        ...state,
        _dir: dir,
        _stateFile: join(dir, "state.json"),
        _mtime: mtime(join(dir, "state.json")),
      });
    }
  }
  return states;
}

function buildLegacyFixtureFactoryStatus({ runsDir = ".hatch/runs", staleMinutes = 20, context = {}, now = Date.now() } = {}) {
  const resolvedContext = normalizeFactoryContext(context, { runsDirFallback: runsDir });
  const safeNow = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const staleMs = Math.max(1, Number(staleMinutes) || 20) * 60 * 1000;
  const controlPlaneStatus = buildControlPlaneStatus({ runsDir, context: resolvedContext });
  let controlState = null;
  if (resolvedContext.factory_id) {
    try {
      controlState = readExternalFactoryControlState({
        factoryId: resolvedContext.factory_id,
        rootDir: resolveControlStateRootDir({ runsDir, context: resolvedContext }),
      });
    } catch {
      controlState = null;
    }
  }

  let entries;
  try {
    entries = readdirSync(runsDir);
  } catch {
    const managedState = deriveManagedState({
      controlState: controlState || {},
      controlPlane: controlPlaneStatus,
      blockedControlPlane: [],
      failed: 0,
    });
    return {
      context: resolvedContext,
      active: [],
      runs: [],
      completed: 0,
      failed: 0,
      blocked_control_plane: [],
      managed_state: {
        ...managedState,
        state_path: String(controlState?.state_path || ""),
      },
      control_plane: controlPlaneStatus,
    };
  }

  const active = [];
  let completed = 0;
  let failed = 0;
  let latestCompletedMs = 0;
  let latestFailedMs = 0;
  let latestBlockedControlPlane = [];
  let latestBlockedControlPlaneMtime = 0;

  for (const id of entries) {
    const dir = join(runsDir, id);
    const state = readState(dir);
    if (!state) continue;
    if (!isRunOwnedByFactory(state, resolvedContext)) continue;

    const stateFile = join(dir, "state.json");

    const status = state.status || "unknown";
    const stateUpdatedMs = parseIsoMs(state.updatedAt) || mtime(stateFile);
    if (status === "completed") {
      completed++;
      latestCompletedMs = Math.max(latestCompletedMs, stateUpdatedMs);
      continue;
    }
    if (["failed", "suspended", "guarded", "guarded_terminal", "blocked", "terminal"].includes(status)) {
      failed++;
      latestFailedMs = Math.max(latestFailedMs, stateUpdatedMs);
      continue;
    }
    if (isStaleOrphanedActiveRun({ state, runDir: dir, now: safeNow, staleMs })) {
      failed++;
      latestFailedMs = Math.max(latestFailedMs, stateUpdatedMs);
      continue;
    }

    // Only track control-plane blockers from active runs — completed/failed
    // runs carry stale blocker state that would block the factory forever.
    const blockedControlPlane = parseControlPlaneBlockedFromContext(state.context || {});
    const blockerUpdatedMs = mtime(stateFile);
    if (blockedControlPlane.length > 0 && blockerUpdatedMs >= latestBlockedControlPlaneMtime) {
      latestBlockedControlPlane = blockedControlPlane;
      latestBlockedControlPlaneMtime = blockerUpdatedMs;
    }

    const lastUpdate = mtime(stateFile);
    const activityUpdatedMs = stateUpdatedMs || lastUpdate;
    const node = state.currentNode || "?";
    const graph = resolveGraph(state);
    const issue = resolveIssue(state);
    const milestone = resolveMilestone(state);
    const startedAt = String(state.startedAt || state.createdAt || "").trim();
    const updatedAt = String(state.updatedAt || "").trim()
      || (activityUpdatedMs > 0 ? new Date(activityUpdatedMs).toISOString() : startedAt);

    const activeChildren = parseActiveChildrenInState(state);
    const children = activeChildren.map((child) => ({
      name: child.parent_node_id,
      runId: child.run_id,
      child_id: child.child_id,
      parent_node_id: child.parent_node_id,
      role: child.role,
      trace_kind: child.trace_kind,
      worker_index: child.worker_index,
      status: child.status,
      current_node: child.current_node,
      session_id: child.session_id,
    }));

    const goalExecutionPathMetadata = resolveGoalExecutionPathMetadata(state.context || {});
    const ageSignals = deriveRunAgeSignals({
      started_at: startedAt,
      updated_at: updatedAt,
    }, {
      now: safeNow,
      fallbackUpdatedMs: activityUpdatedMs,
    });

    active.push({
      id,
      run_id: id,
      status,
      node,
      current_node: node,
      graph,
      issue,
      milestone,
      started_at: startedAt,
      startedAt,
      updated_at: updatedAt,
      updatedAt,
      ...ageSignals,
      children,
      active_children: activeChildren,
      control_plane_blocked: blockedControlPlane,
      ...goalExecutionPathMetadata,
    });
  }

  // @context:regression Active rows display true run age, but list ordering must still follow freshest progress first.
  active.sort((a, b) => a.last_progress_age_ms - b.last_progress_age_ms);

  const managedState = deriveManagedState({
    controlState: controlState || {},
    controlPlane: controlPlaneStatus,
    blockedControlPlane: latestBlockedControlPlane,
    failed,
    latestFailedMs,
    latestCompletedMs,
  });
  const openPackets = summarizeOpenPackets({ runsDir, nowMs: safeNow });

  return {
    context: resolvedContext,
    active,
    runs: active,
    completed,
    failed,
    blocked_control_plane: latestBlockedControlPlane,
    managed_state: {
      ...managedState,
      state_path: String(controlState?.state_path || ""),
    },
    control_plane: controlPlaneStatus,
    open_packets: openPackets,
  };
}

export function legacyFixtureFactoryStatus(opts = {}) {
  return buildLegacyFixtureFactoryStatus(opts);
}

export function formatFactoryStatus(status) {
  return renderFactoryPresentation(presentFactoryStatus(status));
}

function parseJsonArray(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== "string" || !raw.trim()) return [];
  return parseJson(raw, []);
}

function deriveGoalRunProgressState(state = {}, runContext = {}) {
  const context = runContext && typeof runContext === "object" ? runContext : {};
  const lastOutput = parseJson(state?.lastOutput, {});
  const completedIssues = new Set();
  for (const raw of [
    ...parseJsonArray(context.completed_issues),
    ...parseJsonArray(context.processed_issues),
  ]) {
    const issueNumber = asIssueNumber(raw);
    if (issueNumber) completedIssues.add(issueNumber);
  }

  return {
    current_issue_number: asIssueNumber(context.next_issue_number || lastOutput?.next_issue_number),
    completed_issue_numbers: [...completedIssues].sort((left, right) => left - right),
  };
}

function resolveGoalRunIssueAnchor({ state = {}, runContext = {}, runsDir = "" } = {}) {
  const context = runContext && typeof runContext === "object" ? runContext : {};
  const preferredChildRunId = String(context.__child_run_id_execute_issue || "").trim();
  const children = parseActiveChildrenInState(state)
    .filter((child) => String(child.parent_node_id || "").trim() === "execute_issue");
  const selectedChild = children.find((child) => String(child.run_id || "").trim() === preferredChildRunId)
    || children.find((child) => String(child.status || "").trim().toLowerCase() === "running")
    || null;
  if (!selectedChild?.run_id) return { started_at: "", issue_number: null };

  const childState = readState(join(runsDir, selectedChild.run_id)) || {};
  return {
    started_at: String(childState.startedAt || childState.createdAt || "").trim(),
    issue_number: asIssueNumber(childState?.context?.issue_number || childState?.issue_number || childState?.issueNumber),
  };
}

function asIssueNumber(value) {
  const n = Number.parseInt(String(value || "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function countWaveFeatureTotals(milestoneIssuesRaw) {
  const items = parseJsonArray(milestoneIssuesRaw);
  if (!Array.isArray(items)) return { total: 0, featureNumbers: new Set() };
  const featureNumbers = new Set();
  for (const item of items) {
    const title = String(item?.title || "");
    if (title.startsWith("Wave Ready:")) continue;
    const num = asIssueNumber(item?.number);
    if (num) featureNumbers.add(num);
  }
  return { total: featureNumbers.size, featureNumbers };
}

function compactGraphLabel(graph = "") {
  const raw = String(graph || "");
  if (!raw) return "";
  const parts = raw.split("/");
  return (parts[parts.length - 1] || raw).replace(/\.workflow-source\.mjs$/, ".dot");
}

function shellSingleQuote(value = "") {
  return `'${String(value || "").replace(/'/g, `'\\''`)}'`;
}

function buildTraceCommand(runId = "", runsDir = "") {
  if (!runId) return "";
  const parts = [
    "node packages/factory-ops/src/cli.ts factory session-tail",
    `--run-id ${runId}`,
  ];
  const resolvedRunsDir = String(runsDir || "").trim();
  if (resolvedRunsDir) parts.push(`--runs-dir ${shellSingleQuote(resolvedRunsDir)}`);
  parts.push("--follow");
  return parts.join(" ");
}

function compareActiveSummaryWaves(left = {}, right = {}) {
  const leftMilestone = String(left?.milestone_title || "").trim();
  const rightMilestone = String(right?.milestone_title || "").trim();
  const byMilestone = leftMilestone.localeCompare(rightMilestone, "en");
  if (byMilestone !== 0) return byMilestone;

  const leftIssue = asIssueNumber(left?.current_issue_number) || 0;
  const rightIssue = asIssueNumber(right?.current_issue_number) || 0;
  if (leftIssue !== rightIssue) return leftIssue - rightIssue;

  return String(left?.current_issue_node || "").localeCompare(String(right?.current_issue_node || ""), "en");
}

function resolveTraceInfo(runState, runsDir, runId, childMetadata = null) {
  const { sessionLog, traceKind } = resolveSessionTrace(runState, {
    runSessionsDir: join(runsDir, runId, "sessions"),
    childMetadata: childMetadata || undefined,
  });
  if (!sessionLog) {
    return {
      trace_available: false,
      trace_kind: "none",
      trace_command: "",
      trace_session_log: "",
    };
  }
  return {
    trace_available: true,
    trace_kind: traceKind,
    trace_command: buildTraceCommand(runId, runsDir),
    trace_session_log: sessionLog,
  };
}

const LIVE_ATTACH_TRACE_KINDS = new Set(["coder", "reviewer", "manager", "judge", "llm"]);

function resolveSessionIdFromContext(ctx = {}) {
  if (!ctx || typeof ctx !== "object") return "";
  return String(ctx.agent_session_id || ctx.session_id || ctx["hatch.session_id"] || "").trim();
}

function sanitizeLiveAttachTarget(raw = {}) {
  const target = raw && typeof raw === "object" ? raw : {};
  const normalized = {
    factory_id: String(target.factory_id || "").trim(),
    run_id: String(target.run_id || "").trim(),
    wave_run_id: String(target.wave_run_id || "").trim(),
    trace_kind: String(target.trace_kind || "").trim(),
    session_id: String(target.session_id || "").trim(),
    child_id: String(target.child_id || "").trim(),
    parent_node_id: String(target.parent_node_id || "").trim(),
    node: String(target.node || "").trim(),
    graph_label: String(target.graph_label || "").trim(),
    worker_index: Number.isFinite(Number(target.worker_index)) ? Number(target.worker_index) : null,
  };

  const compact = {};
  for (const [key, value] of Object.entries(normalized)) {
    if (value === "" || value === null || value === undefined) continue;
    compact[key] = value;
  }
  return compact;
}

function buildLiveAttachProjection({
  trace_available = false,
  trace_kind = "",
  target = {},
} = {}) {
  const normalizedTraceKind = String(trace_kind || "").trim().toLowerCase();
  const normalizedTarget = sanitizeLiveAttachTarget({ ...target, trace_kind: normalizedTraceKind || target.trace_kind });
  const liveAttachable = Boolean(trace_available)
    && LIVE_ATTACH_TRACE_KINDS.has(normalizedTraceKind)
    && Boolean(String(normalizedTarget.run_id || "").trim());

  return {
    live_attachable: liveAttachable,
    live_attach_target: liveAttachable ? normalizedTarget : null,
  };
}

export function legacyFixtureFactoryActiveSummary({ runsDir = ".hatch/runs", now = Date.now(), context = {} } = {}) {
  const nowMs = Number(now);
  const safeNow = Number.isFinite(nowMs) ? nowMs : Date.now();
  const status = buildLegacyFixtureFactoryStatus({ runsDir, context, now: safeNow });
  const byId = new Map(status.active.map((r) => [r.id, r]));
  const waves = [];

  for (const run of status.active) {
    if (!/(?:^|\/)wave_execute\.(?:dot|workflow-source\.mjs)$/.test(String(run.graph || ""))) continue;

    const state = readState(join(runsDir, run.id)) || {};
    const ctx = state.context || {};
    const milestoneTitle = String(ctx.milestone_title || run.milestone || "");
    const waveIssueNumber = asIssueNumber(ctx.ready_issue_number);

    const { total, featureNumbers } = countWaveFeatureTotals(ctx.milestone_issues);
    const processed = parseJsonArray(ctx.processed_issues);
    const completedSet = new Set();
    for (const raw of processed) {
      const num = asIssueNumber(raw);
      if (num && (featureNumbers.size === 0 || featureNumbers.has(num))) completedSet.add(num);
    }

    let currentIssueNumber = asIssueNumber(ctx.next_issue_number);
    let currentIssueNode = run.node;
    let traceRunId = run.id;
    let traceChildId = "";
    let traceParentNodeId = "";
    let traceChildRole = "";
    let traceChildTraceKind = "";
    let traceChildWorkerIndex = null;
    let traceChildSessionId = "";
    let operatorSignalSourceRun = run;

    const selected = selectTraceChild(run, byId);
    if (selected) {
      const { child, childRun } = selected;
      const childIssue = asIssueNumber(childRun.issue);
      if (childIssue) currentIssueNumber = childIssue;
      currentIssueNode = childRun.node || currentIssueNode;
      traceRunId = childRun.id || traceRunId;
      traceChildId = String(child.child_id || "");
      traceParentNodeId = String(child.parent_node_id || "");
      traceChildRole = String(child.role || "");
      traceChildTraceKind = String(child.trace_kind || "");
      traceChildWorkerIndex = child.worker_index;
      traceChildSessionId = String(child.session_id || "");
      operatorSignalSourceRun = childRun;
    }

    const operatorSignals = describeOperatorSignals(operatorSignalSourceRun, {
      now: safeNow,
      node: currentIssueNode,
    });

    const traceState = readState(join(runsDir, traceRunId)) || {};
    const traceInfo = resolveTraceInfo(traceState, runsDir, traceRunId, {
      childId: traceChildId,
      parentNodeId: traceParentNodeId,
      role: traceChildRole,
      traceKind: traceChildTraceKind,
      workerIndex: traceChildWorkerIndex,
      sessionId: traceChildSessionId,
    });
    const liveAttach = buildLiveAttachProjection({
      trace_available: traceInfo.trace_available,
      trace_kind: traceInfo.trace_kind,
      target: {
        factory_id: String(status?.context?.factory_id || "").trim(),
        run_id: traceRunId,
        wave_run_id: run.id,
        trace_kind: traceInfo.trace_kind,
        session_id: traceChildSessionId || resolveSessionIdFromContext(traceState.context || {}),
        child_id: traceChildId,
        parent_node_id: traceParentNodeId,
        node: currentIssueNode,
        graph_label: compactGraphLabel(run.graph),
        worker_index: traceChildWorkerIndex,
      },
    });

    const executionMode = String(run.goal_execution_mode || "").trim();
    const issueUrls = parseJsonArray(ctx.issue_urls);
    const isDirectGoalExecution = (run.goal_execution_path || "") === "easy"
      && executionMode === "direct"
      && issueUrls.length === 0;

    waves.push({
      wave_run_id: run.id,
      milestone_title: milestoneTitle,
      wave_issue_number: waveIssueNumber,
      current_issue_number: currentIssueNumber,
      current_issue_node: currentIssueNode,
      completed_issues: completedSet.size,
      total_issues: total,
      goal_execution_path: run.goal_execution_path || "unknown",
      goal_execution_mode: executionMode,
      is_direct_goal_execution: isDirectGoalExecution,
      goal_execution_path_version: String(run.goal_execution_path_version || "").trim(),
      classification_version: String(run.classification_version || "").trim(),
      goal_routing_state: run.goal_routing_state && typeof run.goal_routing_state === "object"
        ? { ...run.goal_routing_state }
        : {},
      ...operatorSignals,
      trace_run_id: traceRunId,
      trace_child_id: traceChildId,
      trace_parent_node_id: traceParentNodeId,
      trace_child_role: traceChildRole,
      trace_child_trace_kind: traceChildTraceKind,
      trace_child_worker_index: traceChildWorkerIndex,
      trace_available: traceInfo.trace_available,
      trace_kind: traceInfo.trace_kind,
      trace_command: traceInfo.trace_command,
      trace_session_log: traceInfo.trace_session_log,
      live_attachable: liveAttach.live_attachable,
      live_attach_target: liveAttach.live_attach_target,
    });
  }

  const nonWaveActive = status.active
    .filter((run) => !/(?:^|\/)wave_execute\.(?:dot|workflow-source\.mjs)$/.test(String(run.graph || "")))
    .map((run) => {
      const state = readState(join(runsDir, run.id)) || {};
      const runContext = state.context && typeof state.context === "object" ? state.context : {};
      const issueAnchor = resolveGoalRunIssueAnchor({ state, runContext, runsDir });
      const goalRunProgress = deriveGoalRunProgressState(state, runContext);
      const traceInfo = resolveTraceInfo(state, runsDir, run.id);
      const operatorSignals = describeOperatorSignals(run, {
        now: safeNow,
        node: run.node,
      });
      const liveAttach = buildLiveAttachProjection({
        trace_available: traceInfo.trace_available,
        trace_kind: traceInfo.trace_kind,
        target: {
          factory_id: String(status?.context?.factory_id || "").trim(),
          run_id: run.id,
          trace_kind: traceInfo.trace_kind,
          session_id: resolveSessionIdFromContext(state.context || {}),
          node: run.node,
          graph_label: compactGraphLabel(run.graph),
        },
      });
      return {
        run_id: run.id,
        node: run.node,
        graph: run.graph,
        graph_label: compactGraphLabel(run.graph),
        issue_number: asIssueNumber(run.issue),
        goal_issue_number: asIssueNumber(state.context?.goal_issue_number),
        current_issue_number: issueAnchor.issue_number || goalRunProgress.current_issue_number,
        completed_issues: goalRunProgress.completed_issue_numbers.length,
        completed_issue_numbers: goalRunProgress.completed_issue_numbers,
        milestone_title: String(run.milestone || ""),
        age: run.age,
        goal_execution_path: run.goal_execution_path || "unknown",
        goal_execution_mode: String(run.goal_execution_mode || "").trim(),
        goal_execution_path_version: String(run.goal_execution_path_version || "").trim(),
        classification_version: String(run.classification_version || "").trim(),
        goal_routing_state: run.goal_routing_state && typeof run.goal_routing_state === "object"
          ? { ...run.goal_routing_state }
          : {},
        ...operatorSignals,
        trace_run_id: run.id,
        trace_available: traceInfo.trace_available,
        trace_kind: traceInfo.trace_kind,
        trace_command: traceInfo.trace_command,
        trace_session_log: traceInfo.trace_session_log,
        live_attachable: liveAttach.live_attachable,
        live_attach_target: liveAttach.live_attach_target,
      };
    });

  waves.sort(compareActiveSummaryWaves);

  return {
    context: status.context,
    generated_at: new Date(safeNow).toISOString(),
    active_run_count: status.active.length,
    active_wave_count: waves.length,
    managed_state: status.managed_state || null,
    blocked_control_plane: Array.isArray(status.blocked_control_plane) ? status.blocked_control_plane : [],
    control_plane: status.control_plane || null,
    waves,
    non_wave_active: nonWaveActive,
  };
}

export function formatFactoryActiveSummary(summary) {
  return renderFactoryPresentation(presentFactoryActiveSummary(summary));
}

function findSupervisorRow(summary = {}) {
  const rows = Array.isArray(summary?.non_wave_active) ? summary.non_wave_active : [];
  return rows.find((row) => String(row?.graph_label || "").trim() === "factory_supervisor_tick.dot")
    || rows.find((row) => String(row?.graph || "").includes("/factory_supervisor_tick.dot"))
    || null;
}

export function formatFactoryActiveMinimal(summary = {}) {
  const lines = [];
  const context = summary?.context || {};
  const factoryId = String(context.factory_id || "").trim() || "unknown";
  const targetRepo = String(context.target_repo || "").trim() || "unknown";
  const waves = Array.isArray(summary?.waves) ? [...summary.waves].sort(compareActiveSummaryWaves) : [];
  const supervisor = findSupervisorRow(summary);
  const managedState = summary?.managed_state && typeof summary.managed_state === "object"
    ? summary.managed_state
    : {};
  const blockedControlPlane = Array.isArray(summary?.blocked_control_plane) ? summary.blocked_control_plane : [];
  const managedClass = String(managedState.health_classification || "").trim();
  const managedReason = String(managedState.reason || "").trim();
  const blockedItem = blockedControlPlane[0] || null;
  const blockedWave = String(blockedItem?.milestone || "").trim();
  const blockedIssue = asIssueNumber(blockedItem?.issue_number);
  const blockedReason = managedReason
    || String(blockedItem?.unblockCondition || blockedItem?.status || "").trim()
    || String(summary?.control_plane?.resume_when || summary?.control_plane?.resume_reason || "").trim();

  lines.push(`${factoryId}  ${targetRepo}`);
  if (supervisor) {
    lines.push(`supervisor  ${supervisor.node || "unknown"}`);
  } else if (managedClass === "control_plane_blocked") {
    lines.push("supervisor  blocked");
  } else {
    lines.push("supervisor  idle");
  }

  if (waves.length === 0) {
    if (managedClass === "control_plane_blocked") {
      const parts = ["blocked"];
      if (blockedWave) parts.push(blockedWave);
      if (blockedIssue) parts.push(`#${blockedIssue}`);
      lines.push(parts.join(" "));
      if (blockedReason) lines.push(`reason  ${blockedReason}`);
    } else {
      lines.push("waves  idle");
    }
    return lines.join("\n");
  }

  for (const wave of waves) {
    const milestone = String(wave?.milestone_title || "").trim() || "(no-wave)";
    const issue = asIssueNumber(wave?.current_issue_number);
    const stage = String(wave?.current_issue_node || "").trim() || "unknown";
    const done = Number.isFinite(Number(wave?.completed_issues)) ? Number(wave.completed_issues) : 0;
    const total = Number.isFinite(Number(wave?.total_issues)) ? Number(wave.total_issues) : 0;
    lines.push(`${milestone}  ${issue ? `#${issue}` : "no-issue"}  ${stage}  ${done}/${total}`);
  }

  return lines.join("\n");
}
