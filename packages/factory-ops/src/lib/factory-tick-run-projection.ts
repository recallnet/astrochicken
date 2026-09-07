import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  describeUnblockCondition,
  extractBlockerRefIssueNumber,
  parseControlPlaneBlocker,
} from "./control-plane-blocker.ts";
import { normalizeFactoryContext } from "./factory-context-resolver.ts";
import { presentTickStatus, renderFactoryPresentation } from "./factory-status-presenter.ts";
import { resolveGoalExecutionPathMetadata } from "./goal-execution-path-visibility.ts";

function parseJson(raw, fallback) {
  try { return JSON.parse(raw); } catch { return fallback; }
}

function readMetadata(runDir) {
  try {
    return parseJson(readFileSync(join(runDir, "metadata.json"), "utf8"), null);
  } catch { return null; }
}

function parseIsoMs(value) {
  if (!value) return 0;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : 0;
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

/** Heartbeat older than 5 minutes is considered stale. */
const HEARTBEAT_STALE_MS = 5 * 60_000;

function isGoalExecution(state) {
  if (isSupervisorTick(state)) return false;
  const ctx = state.context || {};
  const goalNum = Number(ctx.goal_issue_number);
  return goalNum > 0;
}

function classifyGoalHealth({ heartbeatAge_ms, pidAlive }) {
  const heartbeatStale = heartbeatAge_ms > HEARTBEAT_STALE_MS;
  if (!heartbeatStale) return "healthy";
  if (pidAlive) return "stale";
  return "zombie";
}

function selectRunHeartbeat(state = {}, metadata = {}) {
  const candidates = [metadata.heartbeatAt, state.updatedAt]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .map((value) => ({ value, ms: parseIsoMs(value) }))
    .filter((entry) => entry.ms > 0)
    .sort((left, right) => right.ms - left.ms);
  return candidates[0]?.value || "";
}

function duration(ms) {
  if (ms < 0) ms = 0;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m${rem}s`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60}m`;
}

function isSupervisorTick(state) {
  const pipelineFile = String(state.pipelineFile || "");
  return pipelineFile.includes("factory_supervisor_tick")
    || pipelineFile.includes("managed_supervisor");
}

function resolveChildRunId(state, nodeId) {
  const ctx = state.context || {};
  return ctx[`__child_run_id_${nodeId}`] || "";
}

function resolveRunGoalExecutionPathMetadata(state) {
  const metadata = resolveGoalExecutionPathMetadata(state?.context || {});
  return {
    goal_execution_path: metadata.goal_execution_path,
    goal_execution_mode: metadata.goal_execution_mode,
    goal_execution_path_version: metadata.goal_execution_path_version,
    classification_version: metadata.classification_version,
    goal_routing_state: metadata.goal_routing_state,
    decomposition_state: metadata.decomposition_state,
    planning_state: metadata.planning_state,
    planning_review_required: metadata.planning_review_required === true,
    provisional_hard: metadata.provisional_hard === true,
    provisional: metadata.provisional === true,
    ...(metadata.planning_artifact_path
      ? { planning_artifact_path: metadata.planning_artifact_path }
      : {}),
  };
}

function resolveActiveChildrenForNode(state, nodeId, allStates) {
  const activeChildren = state?.activeChildren && typeof state.activeChildren === "object"
    ? Object.values(state.activeChildren)
    : [];
  const matches = [];

  for (const child of activeChildren) {
    const parentNodeId = String(child?.parentNodeId || "");
    const runId = String(child?.childRunId || child?.runId || "");
    if (!parentNodeId || !runId) continue;
    if (!parentNodeId.startsWith(nodeId)) continue;

    const childState = allStates.get(runId);
    if (!childState) continue;

    const item = {
      runId,
      node: childState.currentNode || "?",
      status: childState.status || "?",
      issue: resolveIssue(childState),
      milestone: resolveMilestone(childState),
      updatedAt: childState.updatedAt || "",
      ...resolveRunGoalExecutionPathMetadata(childState),
    };

    const grandchildId = resolveChildRunId(childState, childState.currentNode || "");
    if (grandchildId) {
      const gcState = allStates.get(grandchildId);
      if (gcState) {
        item.child = {
          runId: grandchildId,
          node: gcState.currentNode || "?",
          status: gcState.status || "?",
          issue: resolveIssue(gcState),
          milestone: resolveMilestone(gcState),
          updatedAt: gcState.updatedAt || "",
          ...resolveRunGoalExecutionPathMetadata(gcState),
        };
      }
    }

    matches.push({
      workerIndex: Number.isFinite(Number(child?.workerIndex)) ? Number(child.workerIndex) : Number.MAX_SAFE_INTEGER,
      runId,
      item,
    });
  }

  matches.sort((a, b) => {
    if (a.workerIndex !== b.workerIndex) return a.workerIndex - b.workerIndex;
    return a.runId.localeCompare(b.runId);
  });

  return matches.map((entry) => entry.item);
}

// Supervisor tick stages in execution order
export const STAGE_ORDER = [
  "set_gh_repo", "set_source_repos", "set_max_artifacts", "set_stalled_wave_minutes",
  "recovery_sweep_runtime",
  "artifact_ingest", "goal_queue",
  "fix_orphan_features", "release_wave_quarantine", "update_priorities",
  "normalize_feature_labels_pre",
  "set_release_sha", "release_manifest", "release_rollout_controller",
  "wave_dispatch", "wave_execute",
  "detect_stalled_wave", "sanitize_supervisor_goals",
  "normalize_feature_labels", "sanitize_artifact_labels",
  "close_stale_merge_followups", "merge_failure_metrics",
  "finalize_wave_state", "supervisor_health",
  "snapshot_state", "set_date", "supervisor_review",
  "done",
];

export const STAGE_LABELS = {
  set_gh_repo: "Resolving repo",
  set_source_repos: "Resolving source repos",
  set_max_artifacts: "Resolving config",
  set_stalled_wave_minutes: "Resolving config",
  recovery_sweep_runtime: "Sweeping run/worktree residue",
  artifact_ingest: "Ingesting artifacts",
  goal_queue: "Queuing goals",
  fix_orphan_features: "Fixing orphan features",
  release_wave_quarantine: "Releasing quarantine",
  update_priorities: "Updating priorities",
  normalize_feature_labels_pre: "Normalizing labels (pre)",
  set_release_sha: "Resolving release SHA",
  release_manifest: "Emitting release manifest",
  release_rollout_controller: "Evaluating release rollout",
  wave_dispatch: "Dispatching waves",
  wave_execute: "Executing wave",
  detect_stalled_wave: "Detecting stalled waves",
  sanitize_supervisor_goals: "Sanitizing goals",
  normalize_feature_labels: "Normalizing labels",
  sanitize_artifact_labels: "Sanitizing artifact labels",
  close_stale_merge_followups: "Closing stale followups",
  merge_failure_metrics: "Emitting merge metrics",
  finalize_wave_state: "Finalizing wave state",
  supervisor_health: "Health check",
  snapshot_state: "Snapshotting state",
  set_date: "Setting date",
  supervisor_review: "Supervisor LLM review",
  done: "Done",
};

function stageProgress(currentNode) {
  const idx = STAGE_ORDER.indexOf(currentNode);
  if (idx < 0) return "";
  return `[${idx + 1}/${STAGE_ORDER.length}]`;
}

// ── Tick progress signal ──────────────────────────────────────────────────

export function computeTickProgress(ctx) {
  const options = arguments[1] && typeof arguments[1] === "object" ? arguments[1] : {};
  const context = ctx && typeof ctx === "object" ? ctx : {};
  const parts = [];
  let madeProgress = false;

  const execGoals = Array.isArray(context.executable_goals) ? context.executable_goals : [];
  if (execGoals.length > 0) {
    parts.push(`dispatched ${execGoals.length} goal${execGoals.length === 1 ? "" : "s"}`);
    madeProgress = true;
  }

  const spawnCount = Number(context.__fan_out_detached_spawn_count) || 0;
  if (spawnCount > 0) {
    parts.push(`spawned ${spawnCount} execution${spawnCount === 1 ? "" : "s"}`);
    madeProgress = true;
  }

  const mergedCount = Number(context.merged_count) || 0;
  if (mergedCount > 0) {
    parts.push(`merged ${mergedCount} issue${mergedCount === 1 ? "" : "s"}`);
    madeProgress = true;
  }

  const closedCount = Number(context.closed_count) || 0;
  if (closedCount > 0) {
    parts.push(`closed ${closedCount} issue${closedCount === 1 ? "" : "s"}`);
    madeProgress = true;
  }

  const activeChildCount = Number(options.active_child_progress_count) || 0;
  if (activeChildCount > 0) {
    parts.push(`active child progress in ${activeChildCount} run${activeChildCount === 1 ? "" : "s"}`);
    madeProgress = true;
  }

  return {
    made_progress: madeProgress,
    summary: madeProgress ? parts.join(", ") : "no progress",
  };
}

// ── Stuck-node detector ───────────────────────────────────────────────────

export const NODE_DURATION_THRESHOLDS_MS = {
  clean_main: 10 * 60_000,
  wave_execute: 30 * 60_000,
  supervisor_review: 15 * 60_000,
};

const DEFAULT_NODE_THRESHOLD_MS = 5 * 60_000;

export function computeStuckWarning(currentNode, elapsed_ms) {
  const options = arguments[2] && typeof arguments[2] === "object" ? arguments[2] : {};
  if (options.has_fresh_child_progress === true) return "";
  const threshold = NODE_DURATION_THRESHOLDS_MS[currentNode] ?? DEFAULT_NODE_THRESHOLD_MS;
  if (elapsed_ms <= threshold) return "";

  const elapsedMin = Math.round(elapsed_ms / 60_000);
  const thresholdMin = Math.round(threshold / 60_000);
  return `${currentNode} has been running for ${elapsedMin}m (threshold: ${thresholdMin}m)`;
}

function collectDescendantProgress(children, now) {
  const pending = Array.isArray(children) ? [...children] : [];
  let activeChildProgressCount = 0;
  let latestUpdateMs = 0;

  while (pending.length > 0) {
    const child = pending.shift();
    if (!child || typeof child !== "object") continue;
    if (String(child.status || "") === "running") {
      activeChildProgressCount += 1;
      latestUpdateMs = Math.max(latestUpdateMs, parseIsoMs(child.updatedAt));
    }
    if (child.child && typeof child.child === "object") pending.push(child.child);
  }

  const hasFreshChildProgress = latestUpdateMs > 0 && (now - latestUpdateMs) <= HEARTBEAT_STALE_MS;
  return {
    activeChildProgressCount,
    hasFreshChildProgress,
  };
}

function resolveIssue(state) {
  const ctx = state.context || {};
  return ctx.current_issue_number || ctx.issue_number || ctx.target_issue_number || ctx.goal_issue_number || "";
}

function resolveMilestone(state) {
  return (state.context || {}).milestone_title || "";
}

function resolveGoalCount(state) {
  const ctx = state.context || {};
  const raw = ctx.goal_count || ctx.goal_issues || "";
  if (!raw) return "";
  // goal_count is a number; goal_issues might be JSON array
  const num = parseInt(String(raw), 10);
  if (!isNaN(num) && num > 0) return String(num);
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return String(arr.length);
  } catch {}
  return "";
}

function parseControlPlaneBlocked(context = {}) {
  const ctx = context && typeof context === "object" ? context : {};
  const blockedItems = Array.isArray(ctx.control_plane_blocked_items)
    ? ctx.control_plane_blocked_items
    : parseJson(String(ctx.control_plane_blocked_items || "[]"), []);
  const blockedWaves = Array.isArray(ctx.control_plane_blocked_waves)
    ? ctx.control_plane_blocked_waves
    : parseJson(String(ctx.control_plane_blocked_waves || "[]"), []);
  const out = [];

  const pushEntry = (entry = {}, fallbackMilestone = "") => {
    const parsed = parseControlPlaneBlocker(entry);
    if (!parsed.kind && !parsed.status && !parsed.blockerRef && !parsed.unblockCondition) return;
    const linkedGoal = extractBlockerRefIssueNumber(parsed);
    out.push({
      milestone: String(entry?.milestone || fallbackMilestone || "").trim(),
      issue_number: Number.isFinite(Number(entry?.issue_number)) ? Number(entry.issue_number) : null,
      blockerKind: parsed.kind || "",
      blockerRef: parsed.blockerRef || "",
      unblockCondition: describeUnblockCondition(parsed) || "",
      status: parsed.status || "",
      linked_goal_number: linkedGoal ? Number(linkedGoal) : 0,
    });
  };

  for (const entry of Array.isArray(blockedItems) ? blockedItems : []) {
    pushEntry(entry, String(ctx.milestone_title || "").trim());
  }

  for (const wave of Array.isArray(blockedWaves) ? blockedWaves : []) {
    const waveMilestone = String(wave?.milestone || ctx.milestone_title || "").trim();
    for (const issue of Array.isArray(wave?.issues) ? wave.issues : []) {
      pushEntry(issue, waveMilestone);
    }
  }

  const deduped = new Map();
  for (const item of out) {
    const key = `${item.milestone}:${item.issue_number ?? ""}:${item.blockerKind}:${item.blockerRef}:${item.unblockCondition}:${item.status}`;
    deduped.set(key, item);
  }

  return [...deduped.values()].sort((a, b) => {
    if (a.milestone !== b.milestone) return String(a.milestone).localeCompare(String(b.milestone));
    return Number(a.issue_number || 0) - Number(b.issue_number || 0);
  });
}

export function formatTickStatus(result) {
  return renderFactoryPresentation(presentTickStatus(result));
}

export function buildTickProjectionFromStates({
  allStates = new Map(),
  runsDir = ".hatch/runs",
  context = {},
  now = Date.now(),
} = {}) {
  const resolvedContext = normalizeFactoryContext(context, { runsDirFallback: runsDir });
  const nowMs = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const supervisorTicks = [];

  for (const [id, state] of allStates) {
    if (!isSupervisorTick(state)) continue;
    const startMs = state.startedAt ? Date.parse(state.startedAt) : 0;
    supervisorTicks.push({ id, state, startMs });
  }

  supervisorTicks.sort((a, b) => b.startMs - a.startMs);

  const ticks = [];
  for (const tick of supervisorTicks.slice(0, 3)) {
    const { id, state } = tick;
    const currentNode = state.currentNode || "?";
    const status = state.status || "unknown";
    const startedAt = state.startedAt || "";
    const elapsed = tick.startMs > 0 ? nowMs - tick.startMs : 0;

    const children = resolveActiveChildrenForNode(state, currentNode, allStates);
    let childInfo = children[0] || null;
    if (!childInfo) {
      const childRunId = resolveChildRunId(state, currentNode);
      if (childRunId) {
        const childState = allStates.get(childRunId);
        if (childState) {
          childInfo = {
            runId: childRunId,
            node: childState.currentNode || "?",
            status: childState.status || "?",
            issue: resolveIssue(childState),
            milestone: resolveMilestone(childState),
            updatedAt: childState.updatedAt || "",
            ...resolveRunGoalExecutionPathMetadata(childState),
          };

          const grandchildId = resolveChildRunId(childState, childState.currentNode || "");
          if (grandchildId) {
            const gcState = allStates.get(grandchildId);
            if (gcState) {
              childInfo.child = {
                runId: grandchildId,
                node: gcState.currentNode || "?",
                status: gcState.status || "?",
                issue: resolveIssue(gcState),
                milestone: resolveMilestone(gcState),
                updatedAt: gcState.updatedAt || "",
                ...resolveRunGoalExecutionPathMetadata(gcState),
              };
            }
          }
        }
      }
    }

    const ctx = state.context || {};
    const descendantProgress = collectDescendantProgress(children.length > 0 ? children : (childInfo ? [childInfo] : []), nowMs);
    const tick_progress = computeTickProgress(ctx, {
      active_child_progress_count: descendantProgress.hasFreshChildProgress
        ? descendantProgress.activeChildProgressCount
        : 0,
    });
    const stuck_warning = status === "running"
      ? computeStuckWarning(currentNode, elapsed, {
        has_fresh_child_progress: descendantProgress.hasFreshChildProgress,
      })
      : "";

    const goal_admission = {};
    const activeGoalCount = Number(ctx.active_goal_count) || 0;
    const freeSlots = Number(ctx.free_slots) || 0;
    if (activeGoalCount > 0 || freeSlots > 0) {
      goal_admission.active_goal_count = activeGoalCount;
      goal_admission.free_slots = freeSlots;
    }
    const skippedReasons = Array.isArray(ctx.skipped_reasons) ? ctx.skipped_reasons : [];
    if (skippedReasons.length > 0) {
      goal_admission.skipped_reasons = skippedReasons;
    }

    ticks.push({
      id,
      status,
      stage: currentNode,
      stageLabel: STAGE_LABELS[currentNode] || currentNode,
      progress: stageProgress(currentNode),
      startedAt,
      elapsed: duration(elapsed),
      elapsed_ms: elapsed,
      goalCount: resolveGoalCount(state),
      ...resolveRunGoalExecutionPathMetadata(state),
      child: childInfo,
      children,
      blocked_control_plane: parseControlPlaneBlocked(state.context || {}),
      tick_progress,
      stuck_warning,
      ...(Object.keys(goal_admission).length > 0 ? { goal_admission } : {}),
    });
  }

  const goal_executions = [];
  for (const [id, state] of allStates) {
    if (String(state.status) !== "running") continue;
    if (!isGoalExecution(state)) continue;

    const ctx = state.context || {};
    const goalIssueNumber = Number(ctx.goal_issue_number);
    const startMs = state.startedAt ? Date.parse(state.startedAt) : 0;
    const elapsed_ms = startMs > 0 ? nowMs - startMs : 0;

    const dir = join(runsDir, id);
    const metadata = readMetadata(dir) || {};
    const heartbeatAt = selectRunHeartbeat(state, metadata);
    const heartbeatMs = parseIsoMs(heartbeatAt);
    const heartbeatAge_ms = heartbeatMs > 0 ? nowMs - heartbeatMs : elapsed_ms;

    const pid = Number(metadata.pid ?? state.pid);
    const pidAlive = isProcessAlive(pid);
    const heartbeatStale = heartbeatAge_ms > HEARTBEAT_STALE_MS;
    const health = classifyGoalHealth({ heartbeatAge_ms, pidAlive });

    goal_executions.push({
      runId: id,
      goalIssueNumber,
      status: state.status,
      currentNode: state.currentNode || "?",
      startedAt: state.startedAt || "",
      elapsed: duration(elapsed_ms),
      elapsed_ms,
      heartbeatAt,
      heartbeatAge_ms,
      heartbeatStale,
      pidAlive,
      health,
      milestone: resolveMilestone(state),
      ...resolveRunGoalExecutionPathMetadata(state),
    });
  }

  goal_executions.sort((a, b) => a.goalIssueNumber - b.goalIssueNumber);

  const goal_execution_summary = {
    total: goal_executions.length,
    healthy: goal_executions.filter((g) => g.health === "healthy").length,
    stale: goal_executions.filter((g) => g.health === "stale").length,
    zombie: goal_executions.filter((g) => g.health === "zombie").length,
  };

  return { context: resolvedContext, ticks, goal_executions, goal_execution_summary };
}
