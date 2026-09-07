import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  listCanonicalGoalLifecycleForGoalSync,
  listCanonicalIssueLifecycleForGoalSync,
} from "./canonical-issue-lifecycle.ts";
import { listGoalDecompositionPackets } from "./goal-decomposition-packet.ts";
import { getLatestGoalHardPlanMaterializationPacket } from "./goal-hard-plan-materialization-packet.ts";

const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "suspended", "guarded", "guarded_terminal", "blocked", "terminal"]);

function trim(value = "") {
  return String(value ?? "").trim();
}

function normalizeIssueNumber(value = "") {
  const match = trim(value).match(/\d+/);
  if (!match) return "";
  const parsed = Number.parseInt(match[0], 10);
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : "";
}

function parseIssueNumberArray(value = []) {
  const raw = Array.isArray(value) ? value : [];
  const numbers = new Set();
  for (const entry of raw) {
    const normalized = normalizeIssueNumber(entry);
    if (normalized) numbers.add(normalized);
  }
  return [...numbers].sort((left, right) => Number(left) - Number(right));
}

function parseJsonIssueArray(value = "") {
  const normalized = trim(value);
  if (!normalized) return [];
  try {
    const parsed = JSON.parse(normalized);
    return parseIssueNumberArray(parsed);
  } catch {
    return [];
  }
}

function activeRunEntries(runStates) {
  if (runStates instanceof Map) return [...runStates.entries()];
  if (Array.isArray(runStates)) return runStates;
  if (runStates && typeof runStates === "object") return Object.entries(runStates);
  return [];
}

export function readAllRunStatesFromRunsDir({ runsDir = "" } = {}) {
  const normalizedRunsDir = trim(runsDir);
  if (!normalizedRunsDir || !existsSync(normalizedRunsDir)) return new Map();
  const states = new Map();
  let entries = [];
  try {
    entries = readdirSync(normalizedRunsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  } catch {
    return states;
  }
  for (const entry of entries) {
    const statePath = join(normalizedRunsDir, entry.name, "state.json");
    if (!existsSync(statePath)) continue;
    try {
      const state = JSON.parse(readFileSync(statePath, "utf8"));
      states.set(entry.name, state);
    } catch {
      // @context:regression Goal final-state projection must skip malformed run state.
      // Crashing here would block closure and retry repair for unrelated goals.
    }
  }
  return states;
}

function resolveGoalNumberFromRunState(state = {}) {
  const context = state?.context && typeof state.context === "object" ? state.context : {};
  for (const candidate of [
    context.goal_issue_number,
    context.goalNumber,
    context.goal_number,
    context.goal_issue,
    context.issue_number,
    context.issueNumber,
  ]) {
    const normalized = normalizeIssueNumber(candidate);
    if (normalized) return normalized;
  }
  return "";
}

function isTerminalGoalRunState(state = {}) {
  const status = trim(state?.status).toLowerCase();
  if (!status || !TERMINAL_RUN_STATUSES.has(status)) return false;
  const pipeline = trim(state?.pipelineFile || state?.pipeline);
  return pipeline === "goal_execute.dot" || pipeline.endsWith("/goal_execute.dot");
}

function collectCompletedIssueNumbers(goalNumber, runStates) {
  const completed = new Set();
  for (const [, state] of activeRunEntries(runStates)) {
    if (resolveGoalNumberFromRunState(state) !== goalNumber) continue;
    if (!isTerminalGoalRunState(state)) continue;
    const context = state?.context && typeof state.context === "object" ? state.context : {};
    const completedIssues = Array.isArray(context.completed_issues)
      ? parseIssueNumberArray(context.completed_issues)
      : parseJsonIssueArray(context.completed_issues);
    for (const issueNumber of completedIssues) completed.add(issueNumber);
  }
  return [...completed].sort((left, right) => Number(left) - Number(right));
}

function collectClosedSubIssueNumbers({
  repo = "",
  goalNumber = "",
  listSubIssuesFn,
} = {}) {
  if (!goalNumber || typeof listSubIssuesFn !== "function") return [];
  const subIssues = listSubIssuesFn({ repo, goalNumber });
  if (!Array.isArray(subIssues) || subIssues.length === 0) return [];
  return parseIssueNumberArray(
    subIssues
      .filter((issue) => trim(issue?.state).toLowerCase() !== "open")
      .map((issue) => issue?.number),
  );
}

function collectCurrentSubIssueNumbers({
  repo = "",
  goalNumber = "",
  listSubIssuesFn,
} = {}) {
  if (!goalNumber || typeof listSubIssuesFn !== "function") return [];
  const subIssues = listSubIssuesFn({ repo, goalNumber });
  if (!Array.isArray(subIssues) || subIssues.length === 0) return [];
  return parseIssueNumberArray(subIssues.map((issue) => issue?.number));
}

function collectCanonicalIssueLifecycle({
  repo = "",
  goalRepo = "",
  factoryId = "",
  goalNumber = "",
  listCanonicalIssueLifecycleFn = listCanonicalIssueLifecycleForGoalSync,
} = {}) {
  const effectiveRepo = goalRepo || repo;
  if (!effectiveRepo || !goalNumber || typeof listCanonicalIssueLifecycleFn !== "function") return [];
  const lifecycle = listCanonicalIssueLifecycleFn({
    repo: effectiveRepo,
    factoryId,
    goalNumber,
  });
  return Array.isArray(lifecycle) ? lifecycle : [];
}

function collectCanonicalSubIssueNumbers(lifecycle = []) {
  return parseIssueNumberArray(
    lifecycle
      .filter((entry) => trim(entry?.sub_issue_link_status).toLowerCase() === "linked")
      .map((entry) => entry?.issue_number),
  );
}

function collectCanonicalClosedIssueNumbers(lifecycle = []) {
  return parseIssueNumberArray(
    lifecycle
      .filter((entry) => {
        if (entry?.shipped_to_main === true) return true;
        return trim(entry?.github_close_status).toLowerCase() === "closed";
      })
      .map((entry) => entry?.issue_number),
  );
}

function collectCanonicalGoalCloseState({
  repo = "",
  goalRepo = "",
  factoryId = "",
  goalNumber = "",
  listCanonicalGoalLifecycleFn = listCanonicalGoalLifecycleForGoalSync,
} = {}) {
  const effectiveRepo = goalRepo || repo;
  if (!effectiveRepo || !goalNumber || typeof listCanonicalGoalLifecycleFn !== "function") return null;
  const lifecycle = listCanonicalGoalLifecycleFn({
    repo: effectiveRepo,
    factoryId,
    goalNumber,
  });
  return Array.isArray(lifecycle) && lifecycle.length > 0 ? lifecycle[lifecycle.length - 1] : null;
}

function resolveCreatedIssueNumbers({
  repo = "",
  factoryId = "mothership",
  goalNumber = "",
  listGoalDecompositionPacketsFn = listGoalDecompositionPackets,
  getLatestGoalHardPlanMaterializationPacketFn = getLatestGoalHardPlanMaterializationPacket,
} = {}) {
  const hardPlanPacket = getLatestGoalHardPlanMaterializationPacketFn({
    repo,
    factoryId,
    goalIssueNumber: goalNumber,
  });
  if (hardPlanPacket?.packet?.created_issue_numbers) {
    return parseIssueNumberArray(hardPlanPacket.packet.created_issue_numbers);
  }

  const decompositionPacket = listGoalDecompositionPacketsFn({
    repo,
    factoryId,
    goalIssueNumber: goalNumber,
  })[0] || null;
  return parseIssueNumberArray(decompositionPacket?.packet?.created_issue_numbers || []);
}

export function projectGoalFinalState({
  repo = "",
  goalRepo = "",
  goalNumber = "",
  runsDir = "",
  factoryId = "mothership",
  readAllRunStatesFn = readAllRunStatesFromRunsDir,
  listGoalDecompositionPacketsFn = listGoalDecompositionPackets,
  getLatestGoalHardPlanMaterializationPacketFn = getLatestGoalHardPlanMaterializationPacket,
  listSubIssuesFn,
  listCanonicalIssueLifecycleFn = listCanonicalIssueLifecycleForGoalSync,
  listCanonicalGoalLifecycleFn = listCanonicalGoalLifecycleForGoalSync,
} = {}) {
  const normalizedGoalNumber = normalizeIssueNumber(goalNumber);
  const createdIssueNumbers = resolveCreatedIssueNumbers({
    repo,
    factoryId,
    goalNumber: normalizedGoalNumber,
    listGoalDecompositionPacketsFn,
    getLatestGoalHardPlanMaterializationPacketFn,
  });
  const completedIssueNumbers = normalizedGoalNumber && trim(runsDir)
    ? collectCompletedIssueNumbers(normalizedGoalNumber, readAllRunStatesFn({ runsDir }))
    : [];
  const currentlyClosedSubIssueNumbers = collectClosedSubIssueNumbers({
    repo,
    goalNumber: normalizedGoalNumber,
    listSubIssuesFn,
  });
  const currentSubIssueNumbers = collectCurrentSubIssueNumbers({
    repo,
    goalNumber: normalizedGoalNumber,
    listSubIssuesFn,
  });
  const canonicalIssueLifecycle = collectCanonicalIssueLifecycle({
    repo,
    goalRepo,
    factoryId,
    goalNumber: normalizedGoalNumber,
    listCanonicalIssueLifecycleFn,
  });
  const canonicalSubIssueNumbers = collectCanonicalSubIssueNumbers(canonicalIssueLifecycle);
  const canonicalClosedIssueNumbers = collectCanonicalClosedIssueNumbers(canonicalIssueLifecycle);
  const canonicalGoalCloseState = collectCanonicalGoalCloseState({
    repo,
    goalRepo,
    factoryId,
    goalNumber: normalizedGoalNumber,
    listCanonicalGoalLifecycleFn,
  });

  // @context:decision !critical Goal finalization now treats canonical lifecycle as the
  // ownership surface for shipped child work. GitHub sub-issue state is still useful as
  // projection evidence, but stale open issues must not strand a goal after code landed.
  const completedSet = new Set([
    ...completedIssueNumbers,
    ...currentlyClosedSubIssueNumbers,
    ...canonicalClosedIssueNumbers,
  ]);
  // @context:regression !critical When a goal is re-decomposed, both the decomposition packet
  // and canonical lifecycle only record the FIRST decomposition's sub-issues. If GitHub shows
  // MORE sub-issues than any historical source recorded, that source is stale and GitHub's
  // current sub-issue view must be preferred. Otherwise the sweep sees only the (closed)
  // first-pass issues and closes the goal while later-pass sub-issues are still open.
  // refs: example-trading #1780 premature closure loop.
  const historicalSubIssueCount = Math.max(createdIssueNumbers.length, canonicalSubIssueNumbers.length);
  const effectiveSubIssueNumbers = currentSubIssueNumbers.length > historicalSubIssueCount && historicalSubIssueCount > 0
    ? currentSubIssueNumbers
    : (createdIssueNumbers.length > 0
      ? createdIssueNumbers
      : (canonicalSubIssueNumbers.length > 0 ? canonicalSubIssueNumbers : currentSubIssueNumbers));
  const closedIssueNumbers = effectiveSubIssueNumbers.filter((issueNumber) => completedSet.has(issueNumber));
  // @context:decision !critical Goal closure keeps packet-owned child membership, but it must
  // refresh child closure from the current sub-issue projection as well as prior terminal
  // goal-run snapshots. Relying on stale completed_issues alone strands goals open after the
  // child issues are legitimately finished in a later pass or repair cycle.
  // @context:regression !critical Older decomposed goals can legitimately have live sub-issues
  // even when no decomposition packet survived. Fall back to current sub-issue membership so
  // repaired closure is based on present truth instead of a missing historical packet.
  const openIssueNumbers = effectiveSubIssueNumbers.filter((issueNumber) => !completedSet.has(issueNumber));

  return {
    goal_number: normalizedGoalNumber,
    has_sub_issues: effectiveSubIssueNumbers.length > 0,
    any_open_sub_issues: openIssueNumbers.length > 0,
    total_sub_issue_count: effectiveSubIssueNumbers.length,
    closed_sub_issue_count: closedIssueNumbers.length,
    open_sub_issue_count: openIssueNumbers.length,
    closed_sub_issue_numbers: closedIssueNumbers,
    open_sub_issue_numbers: openIssueNumbers,
    goal_close_request_status: trim(canonicalGoalCloseState?.goal_close_request_status),
    goal_close_request_reason: trim(canonicalGoalCloseState?.goal_close_request_reason),
    goal_close_status: trim(canonicalGoalCloseState?.goal_close_status),
    goal_close_reason: trim(canonicalGoalCloseState?.goal_close_reason),
    goal_close_error: trim(canonicalGoalCloseState?.last_error),
  };
}
