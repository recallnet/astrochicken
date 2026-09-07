import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

import { createLegacyReadAdapter, reconcileCanonicalSubIssues } from "./goal-queue-ops.ts";
import { listGoalSubIssues } from "./goal-sub-issues.ts";
import { createGhCliAdapter } from "../../../github-adapter/src/github-adapter.ts";
import { listCanonicalIssueLifecycleForGoalSync } from "../lib/canonical-issue-lifecycle.ts";
import { trim } from "../lib/cli-helpers.ts";
import { getFactoryLabelName, FACTORY_LABEL_KEYS } from "../lib/factory-label-contract.ts";
import { getGoalExecutionPath, getLatestGoalExecutionPathPacket } from "../lib/goal-execution-path-packet.ts";
import { resolveGoalExecutionPathMetadata } from "../lib/goal-execution-path-visibility.ts";

const ACTIVE_STATUSES = new Set(["running", "suspended"]);
const OPEN_STATES = new Set(["OPEN", "open"]);
const QUARANTINED_LABELS = new Set(["quarantined"]);

function hasOpenGoalBlocker(blockedByNodes = []) {
  return (Array.isArray(blockedByNodes) ? blockedByNodes : [])
    .some((node) => OPEN_STATES.has(String(node?.state || "").toUpperCase()));
}

/**
 * Scan runs directory for goal_execute runs that are still active.
 * Returns a Set of goal issue numbers that already have in-flight runs.
 *
 * Identification: a run is a goal_execute run if its context has goal_issue_number.
 * The state.json graph field may be null for detached fan_out children, so we
 * rely on the context key which is always set by the supervisor's fan_out node.
 */
function collectActiveGoalNumbers(runsDir) {
  const active = new Set();
  if (!runsDir || !existsSync(runsDir)) return active;

  let entries;
  try { entries = readdirSync(runsDir); } catch { return active; }

  for (const entry of entries) {
    const stateFile = join(runsDir, entry, "state.json");
    const ctxFile = join(runsDir, entry, "context.json");
    if (!existsSync(stateFile) || !existsSync(ctxFile)) continue;

    try {
      const state = JSON.parse(readFileSync(stateFile, "utf8"));
      if (!ACTIVE_STATUSES.has(state.status)) continue;

      const ctx = JSON.parse(readFileSync(ctxFile, "utf8"));
      const goalNum = Number(ctx.goal_issue_number);
      if (goalNum > 0) active.add(goalNum);
    } catch {
      // Corrupt or partial run — skip.
    }
  }
  return active;
}

function collectGoalExecutionPathsByGoalNumber(runsDir) {
  const pathsByGoal = {};
  if (!runsDir || !existsSync(runsDir)) return pathsByGoal;

  let entries;
  try { entries = readdirSync(runsDir); } catch { return pathsByGoal; }

  for (const entry of entries) {
    const stateFile = join(runsDir, entry, "state.json");
    const ctxFile = join(runsDir, entry, "context.json");
    if (!existsSync(stateFile) || !existsSync(ctxFile)) continue;

    try {
      const ctx = JSON.parse(readFileSync(ctxFile, "utf8"));
      const goalNum = Number(ctx.goal_issue_number);
      if (!(goalNum > 0)) continue;

      const state = JSON.parse(readFileSync(stateFile, "utf8"));
      const resolvedPath = resolveGoalExecutionPathMetadata(state?.context || {}).goal_execution_path;

      const key = String(goalNum);
      if (!(key in pathsByGoal)) {
        pathsByGoal[key] = resolvedPath;
        continue;
      }
      if (pathsByGoal[key] === "unknown" && resolvedPath !== "unknown") {
        pathsByGoal[key] = resolvedPath;
      }
    } catch {
      // Corrupt or partial run — skip.
    }
  }

  return pathsByGoal;
}

function hydrateGoalExecutionPathsFromPackets({
  goalExecutionPaths = {},
  repoRoot = "",
  factoryId = "",
  goalNumbers = [],
} = {}) {
  const hydrated = { ...(goalExecutionPaths || {}) };
  const normalizedRepoRoot = trim(repoRoot);
  const normalizedFactoryId = trim(factoryId);
  if (!normalizedRepoRoot || !normalizedFactoryId) return hydrated;

  for (const goalNumber of goalNumbers) {
    const key = String(goalNumber);
    if (hydrated[key] && hydrated[key] !== "unknown") continue;
    const latest = getLatestGoalExecutionPathPacket({
      repo: normalizedRepoRoot,
      factoryId: normalizedFactoryId,
      goalIssueNumber: key,
    });
    const executionPath = getGoalExecutionPath(latest?.packet || {});
    if (executionPath) hydrated[key] = executionPath;
  }

  return hydrated;
}

function parseBackoffSeconds(backoffSeconds = 0) {
  const parsed = Number(backoffSeconds);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.trunc(parsed);
}

function hasRecentFailedGoalRun({ state = {}, context = {}, backoffMs = 0, nowMs = Date.now(), statePath = "" } = {}) {
  if (backoffMs <= 0) return false;
  const implResults = Array.isArray(context?.impl_results)
    ? context.impl_results
    : (() => {
        try {
          return JSON.parse(String(context?.impl_results || "[]"));
        } catch {
          return [];
        }
      })();
  const hasFailure = implResults.some((entry) => String(entry?.review_failed || "").trim() === "true");
  if (!hasFailure) return false;

  const endedAtMs = Date.parse(String(state?.endedAt || state?.ended_at || "").trim());
  const observedAtMs = Number.isFinite(endedAtMs)
    ? endedAtMs
    : (() => {
        try {
          return statSync(statePath).mtimeMs;
        } catch {
          return 0;
        }
      })();
  if (!Number.isFinite(observedAtMs) || observedAtMs <= 0) return false;
  return (nowMs - observedAtMs) < backoffMs;
}

function collectBackoffBlockedGoalNumbers(runsDir, { backoffSeconds = 0, nowMs = Date.now() } = {}) {
  const blocked = new Set();
  const normalizedBackoffSeconds = parseBackoffSeconds(backoffSeconds);
  if (!runsDir || !existsSync(runsDir) || normalizedBackoffSeconds <= 0) return blocked;
  const backoffMs = normalizedBackoffSeconds * 1000;

  let entries;
  try { entries = readdirSync(runsDir); } catch { return blocked; }

  for (const entry of entries) {
    const statePath = join(runsDir, entry, "state.json");
    const ctxPath = join(runsDir, entry, "context.json");
    if (!existsSync(statePath) || !existsSync(ctxPath)) continue;

    try {
      const state = JSON.parse(readFileSync(statePath, "utf8"));
      if (ACTIVE_STATUSES.has(String(state?.status || ""))) continue;

      const context = JSON.parse(readFileSync(ctxPath, "utf8"));
      const goalNum = Number(context?.goal_issue_number);
      if (!(goalNum > 0)) continue;

      if (hasRecentFailedGoalRun({ state, context, backoffMs, nowMs, statePath })) {
        blocked.add(goalNum);
      }
    } catch {
      // Corrupt or partial run — skip.
    }
  }

  return blocked;
}

/**
 * List goals ready for execution: ready + have open sub-issues + no active run.
 *
 * @param {{ repo: string, runsDir?: string, maxConcurrent?: number|string, ghJsonFn?: Function, listSubIssuesFn?: Function }} opts
 * @returns {{ executable_goals: Array<number>, goal_execution_paths: Record<string, string>, count: number, capped: boolean, execution_capacity: number, active_goal_count: number, free_slots: number, skipped_active?: Array<number> }}
 */
export function listExecutableGoals({
  repo,
  repoRoot = "",
  factoryId = "",
  runsDir,
  maxConcurrent = 3,
  backoffSeconds = 0,
  adapter,
  ghJsonFn,
  listSubIssuesFn = listGoalSubIssues,
  listCanonicalIssueLifecycleFn = listCanonicalIssueLifecycleForGoalSync,
} = {}) {
  const effectiveRepo = repo || adapter?.repo;
  if (!effectiveRepo) return { executable_goals: [], goal_execution_paths: {}, count: 0, capped: false };
  const githubAdapter = adapter
    || (typeof ghJsonFn === "function" ? createLegacyReadAdapter({ repo: effectiveRepo, ghJsonFn }) : null)
    || createGhCliAdapter({ repo: effectiveRepo });

  const executionCapacity = Math.max(1, Number(maxConcurrent) || 3);

  const activeGoals = collectActiveGoalNumbers(runsDir);
  const backoffBlockedGoals = collectBackoffBlockedGoalNumbers(runsDir, { backoffSeconds });
  const activeGoalCount = activeGoals.size;
  const freeSlots = Math.max(0, executionCapacity - activeGoalCount);
  let goalExecutionPaths = collectGoalExecutionPathsByGoalNumber(runsDir);

  // @context:regression !critical Must use the caller-supplied factoryId, not the
  // hardcoded "mothership" default. Hardcoding caused managed factories (e.g. example-trading)
  // to query for mothership-prefixed labels and find 0 goals even when 10+ were open.
  // refs: #2598
  const effectiveFactoryId = trim(factoryId) || "mothership";
  const goalLabel = getFactoryLabelName(effectiveFactoryId, FACTORY_LABEL_KEYS.GOAL);
  const readyLabel = getFactoryLabelName(effectiveFactoryId, FACTORY_LABEL_KEYS.READY);

  const readyGoals = githubAdapter.issueList({
    state: "open",
    labels: [goalLabel, readyLabel],
    fields: "number,title",
    limit: 50,
  });

  goalExecutionPaths = hydrateGoalExecutionPathsFromPackets({
    goalExecutionPaths,
    repoRoot,
    factoryId,
    goalNumbers: readyGoals.map((goal) => Number(goal?.number)).filter(Number.isFinite),
  });

  const executable = [];
  const skippedActive = [];
  const skippedReasons = [];

  // Separate candidates (non-active goals) from skipped goals.
  const candidateGoals = [];
  for (const goal of readyGoals) {
    const goalNum = Number(goal.number);
    if (activeGoals.has(goalNum)) {
      skippedActive.push(goalNum);
      skippedReasons.push({ goal_number: goalNum, reason: "active_run" });
    } else if (backoffBlockedGoals.has(goalNum)) {
      skippedReasons.push({ goal_number: goalNum, reason: "dispatch_backoff_active" });
    } else {
      candidateGoals.push(goal);
    }
  }

  for (const goal of candidateGoals) {
    const goalNum = Number(goal.number);
    const blockedByNodes = githubAdapter.issueBlockedBy({ number: goalNum });

    if (hasOpenGoalBlocker(blockedByNodes)) {
      skippedReasons.push({ goal_number: goalNum, reason: "blocked_by_open_issue" });
      continue;
    }

    const executionPath = goalExecutionPaths[String(goalNum)] || "unknown";
    if (executionPath === "easy") {
      executable.push(goalNum);
      continue;
    }

    const rawSubIssues = typeof listSubIssuesFn === "function" && listSubIssuesFn !== listGoalSubIssues
      ? listSubIssuesFn({ repo: effectiveRepo, goalNumber: goal.number })
      : githubAdapter.listSubIssues({ number: goal.number });
    const subIssues = reconcileCanonicalSubIssues({
      repo: effectiveRepo,
      factoryId,
      goalNumber: goal.number,
      subIssues: rawSubIssues,
      listCanonicalIssueLifecycleFn,
    });
    if (!Array.isArray(subIssues) || subIssues.length === 0) {
      // @context:regression !critical Ready goals with zero linked sub-issues
      // are not missing work; goal_run owns decomposition from this state and
      // must stay dispatchable even before any durable execution-path packet.
      executable.push(goalNum);
      continue;
    }
    const openSubIssues = subIssues.filter((i) => i.state === "open");
    const dispatchable = subIssues.filter((i) => {
      if (i.state !== "open") return false;
      if (Number(i.blocked_by_count ?? 0) > 0) return false;
      const labels = Array.isArray(i.labels) ? i.labels : [];
      if (labels.some((l) => QUARANTINED_LABELS.has(String(l.name || l || "").toLowerCase()))) return false;
      return true;
    });
    if (dispatchable.length > 0) {
      executable.push(goalNum);
    } else {
      // Determine why: quarantined or no dispatchable sub-issues
      const quarantinedCount = openSubIssues.filter((i) => {
        const labels = Array.isArray(i.labels) ? i.labels : [];
        return labels.some((l) => QUARANTINED_LABELS.has(String(l.name || l || "").toLowerCase()));
      }).length;
      if (quarantinedCount > 0 && quarantinedCount === openSubIssues.length) {
        skippedReasons.push({ goal_number: goalNum, reason: "quarantined_sub_issues" });
      } else {
        skippedReasons.push({ goal_number: goalNum, reason: "no_dispatchable_sub_issues" });
      }
    }
  }

  // Sort by issue number (stable, deterministic order).
  executable.sort((a, b) => a - b);

  const capped = executable.length > freeSlots;
  const selected = executable.slice(0, freeSlots);
  const selectedExecutionPaths = {};
  for (const goalNum of selected) {
    const key = String(goalNum);
    selectedExecutionPaths[key] = goalExecutionPaths[key] || "unknown";
  }

  return {
    executable_goals: selected,
    goal_execution_paths: selectedExecutionPaths,
    count: selected.length,
    capped,
    execution_capacity: executionCapacity,
    active_goal_count: activeGoalCount,
    free_slots: freeSlots,
    skipped_reasons: skippedReasons,
    ...(skippedActive.length > 0 ? { skipped_active: skippedActive } : {}),
  };
}
