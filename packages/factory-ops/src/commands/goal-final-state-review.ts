import { createGhCliAdapter } from "@hatch/github-adapter";

import {
  buildGoalCloseAppliedEvent,
  buildGoalCloseRequestedEvent,
  dispatchCanonicalDomainEvents,
} from "../lib/canonical-domain-events.ts";
import { appendCanonicalEventsSync } from "../lib/canonical-event-log.ts";
import {
  getFactoryLabelName,
  FACTORY_LABEL_KEYS,
} from "../lib/factory-label-contract.ts";
import { resolveGitHubProjectionTarget } from "../lib/github-projection-target.ts";
import { repairCanonicalGoalCloseProjection } from "../lib/goal-close-projection-repair.ts";
import {
  canAutoCloseGoal,
  projectGoalFinalState,
  readAllRunStatesFromRunsDir,
} from "../lib/goal-final-state-projection.ts";

const DIRECT_SUCCESS_RESULTS = new Set(["merged", "success", "completed", "close", "closed"]), TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "suspended", "guarded", "guarded_terminal", "blocked", "terminal"]);
export { canAutoCloseGoal } from "../lib/goal-final-state-projection.ts";

function normalizeGoalNumber(value = "") {
  const match = String(value ?? "").match(/\d+/);
  if (!match) return "";
  const parsed = Number.parseInt(match[0], 10);
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : "";
}

function activeRunEntries(runStates) {
  if (runStates instanceof Map) return [...runStates.entries()];
  if (Array.isArray(runStates)) return runStates;
  if (runStates && typeof runStates === "object") return Object.entries(runStates);
  return [];
}

function resolveGoalNumberFromRunState(state = {}) {
  const context = state?.context && typeof state.context === "object" ? state.context : {};
  const candidates = [
    context.goal_issue_number,
    context.goalNumber,
    context.goal_number,
    context.goal_issue,
    context.issue_number,
    context.issueNumber,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeGoalNumber(candidate);
    if (normalized) return normalized;
  }
  return "";
}

function isActiveGoalRunState(state = {}) {
  const status = String(state?.status || "").trim().toLowerCase();
  if (!status) return false;
  return !TERMINAL_RUN_STATUSES.has(status);
}

export function listActiveGoalRuns({
  runsDir = "",
  goalNumber = "",
  excludeRunId = "",
  readAllRunStatesFn = readAllRunStatesFromRunsDir,
} = {}) {
  const normalizedGoalNumber = normalizeGoalNumber(goalNumber);
  if (!normalizedGoalNumber || !String(runsDir || "").trim()) return [];
  const states = readAllRunStatesFn({ runsDir });
  return activeRunEntries(states)
    .map(([candidateRunId, state]) => ({
      runId: String(state?.runId || candidateRunId || "").trim(),
      state,
    }))
    .filter(({ runId, state }) => runId && runId !== String(excludeRunId || "").trim() && isActiveGoalRunState(state))
    .filter(({ state }) => resolveGoalNumberFromRunState(state) === normalizedGoalNumber);
}

function normalizeMode(value = "") {
  return String(value || "").trim().toLowerCase() === "direct" ? "direct" : "issue";
}

function normalizeDirectGoalResult(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || "unknown";
}

function isDirectSuccessResult(value = "") {
  return DIRECT_SUCCESS_RESULTS.has(normalizeDirectGoalResult(value));
}

function buildDirectFinalizerCommentBody({
  success = false,
  directGoalResult = "unknown",
  runId = "",
  directGoalOutcomeNotes = "",
  goalNumber = "",
} = {}) {
  const marker = `<!-- goal-final-state:direct:${success ? "success" : "failure"}:${directGoalResult} -->`;
  const statusLine = success
    ? "Direct easy execution shipped and the goal is finalized."
    : "Direct easy execution ended without a merged outcome; goal remains queued for retry.";
  const retryDirective = success
    ? "retry_ready_label=removed"
    : "retry_ready_label=present";

  return [
    marker,
    `direct_goal_execution=true`,
    `direct_goal_result=${directGoalResult}`,
    `goal_issue_number=${String(goalNumber || "").trim()}`,
    `run_id=${String(runId || "").trim() || "unknown"}`,
    `direct_goal_outcome_notes=${String(directGoalOutcomeNotes || "").trim() || "none"}`,
    retryDirective,
    statusLine,
  ].join("\n");
}

function buildDirectFinalizerMarker({ success = false, directGoalResult = "unknown" } = {}) {
  return `<!-- goal-final-state:direct:${success ? "success" : "failure"}:${directGoalResult} -->`;
}

function buildGoalProjectionTarget({
  repo,
  githubProjectionTarget,
  ghExecFn,
  factoryId = "mothership",
  runId = "",
  emitCanonicalEventFn,
} = {}) {
  return resolveGitHubProjectionTarget({
    repo,
    ghExec: ghExecFn,
    githubProjectionTarget,
    factoryId,
    runId,
    emitCanonicalEventFn,
  });
}

function buildGoalReadAdapter({
  repo,
  ghExecFn,
} = {}) {
  if (!repo) return null;
  // @context:integration Goal final-state reads must stay behind github-adapter ownership so
  // the closure path cannot drift back into ad-hoc gh transport or repo-local GraphQL calls.
  return createGhCliAdapter({
    repo,
    ghFn: typeof ghExecFn === "function"
      ? (args, options) => ghExecFn(args, options)
      : undefined,
  });
}

function reconcileDirectGoalFinalState({
  goalNumber,
  projectionTarget,
  directGoalResult = "unknown",
  directGoalOutcomeNotes = "",
  runId = "",
} = {}) {
  const resultCode = normalizeDirectGoalResult(directGoalResult);
  const success = isDirectSuccessResult(resultCode);
  const readyLabel = getFactoryLabelName("mothership", FACTORY_LABEL_KEYS.READY);

  const actions = {
    mode: "direct",
    closedGoal: false,
    reAddedReady: false,
    removedReady: false,
    postedDirectFinalizerComment: false,
    directCommentAlreadyPresent: false,
    goalNumber: String(goalNumber),
    skippedGoalClosureReason: "",
    hasSubIssues: false,
    anyOpenSubIssues: false,
    openSubIssueCount: 0,
    closedSubIssueCount: 0,
    direct_goal_execution: true,
    direct_goal_result: resultCode,
    direct_goal_success: success,
    run_id: String(runId || "").trim(),
  };

  if (success) {
    const closeResult = projectionTarget.issueClose({ number: String(goalNumber), reason: "completed" });
    actions.closedGoal = !!(closeResult && closeResult.ok);
    if (!actions.closedGoal) {
      actions.skippedGoalClosureReason = "direct_goal_close_failed";
    } else {
      const removeReady = projectionTarget.issueEdit({ number: String(goalNumber), removeLabels: [readyLabel] });
      actions.removedReady = !!(removeReady && removeReady.ok);
    }
    if (!actions.closedGoal) {
      const addReady = projectionTarget.issueEdit({ number: String(goalNumber), addLabels: [readyLabel] });
      actions.reAddedReady = !!(addReady && addReady.ok);
    }
  } else {
    const addReady = projectionTarget.issueEdit({ number: String(goalNumber), addLabels: [readyLabel] });
    actions.reAddedReady = !!(addReady && addReady.ok);
  }

  const commentBody = buildDirectFinalizerCommentBody({
    success,
    directGoalResult: resultCode,
    runId,
    directGoalOutcomeNotes,
    goalNumber,
  });
  const commentResult = projectionTarget.issueComment({ number: String(goalNumber), body: commentBody });
  actions.postedDirectFinalizerComment = !!(commentResult && commentResult.ok);

  return actions;
}

export async function reconcileGoalFinalState({
  repo,
  repoRoot = process.cwd(),
  goalNumber,
  mode = "issue",
  directGoalResult = "",
  directGoalOutcomeNotes = "",
  runId = "",
  runsDir = "",
  readAllRunStatesFn = readAllRunStatesFromRunsDir,
  projectGoalFinalStateFn = projectGoalFinalState,
  ghExecFn,
  githubProjectionTarget,
  emitCanonicalEventFn,
  appendCanonicalEventsFn = appendCanonicalEventsSync,
  factoryId = "mothership",
  listGoalSubIssuesFn,
  readGoalIssueFn,
  // @context:regression !critical Legacy workflow callers may still provide this flag,
  // but canonical merge lifecycle now owns child completion. Goal finalization must not
  // infer closure from an execution boolean when GitHub projection is stale or failed.
  allSubIssueExecutionsCompleted = false,
}) {
  if (!repo || !goalNumber) throw new Error("repo and goalNumber are required");

  const projectionTarget = buildGoalProjectionTarget({
    repo,
    githubProjectionTarget,
    ghExecFn,
    factoryId,
    runId,
    emitCanonicalEventFn,
  });

  const normalizedMode = normalizeMode(mode);

  if (normalizedMode === "direct") {
    return reconcileDirectGoalFinalState({
      goalNumber,
      projectionTarget,
      directGoalResult,
      directGoalOutcomeNotes,
      runId,
    });
  }

  const goalReadAdapter = typeof listGoalSubIssuesFn === "function"
    ? null
    : buildGoalReadAdapter({ repo, ghExecFn });
  const resolvedListSubIssuesFn = typeof listGoalSubIssuesFn === "function"
    ? listGoalSubIssuesFn
    : ({ goalNumber }) => goalReadAdapter?.listSubIssues({ number: goalNumber }) || [];
  const resolvedReadGoalIssueFn = typeof readGoalIssueFn === "function"
    ? readGoalIssueFn
    : ({ goalNumber }) => goalReadAdapter?.issueView({ number: goalNumber, fields: "number,state" }) || {};

  // @context:regression !critical A failed push means the merge never landed on
  // main, so sub-issues and the parent goal must remain retryable. Do not
  // API-close open sub-issues here based only on completed execution state.
  const closedSubIssueNumbers = [];

  const goalProjection = projectGoalFinalStateFn({
    repo: repoRoot,
    goalRepo: repo,
    goalNumber,
    runsDir,
    factoryId,
    readAllRunStatesFn,
    listSubIssuesFn: resolvedListSubIssuesFn,
  });
  void allSubIssueExecutionsCompleted;

  const actions = {
    mode: "issue",
    closedGoal: false,
    reAddedReady: false,
    goalNumber: String(goalNumber),
    skippedGoalClosureReason: "",
    hasSubIssues: goalProjection.has_sub_issues === true,
    anyOpenSubIssues: goalProjection.any_open_sub_issues === true,
    openSubIssueCount: Number(goalProjection.open_sub_issue_count || 0),
    closedSubIssueCount: Number(goalProjection.closed_sub_issue_count || 0),
    activeGoalRunCount: 0,
    activeGoalRunIds: [],
    closedSubIssueNumbers,
    goalCloseStatus: String(goalProjection.goal_close_status || "").trim(),
    goalCloseRequestStatus: String(goalProjection.goal_close_request_status || "").trim(),
    canonical_event_commit_cursor: 0,
  };
  const canonicalEvents = [];
  const recordCanonicalEvents = (events = []) => {
    canonicalEvents.push(...dispatchCanonicalDomainEvents({ events, emitDomainEventFn: emitCanonicalEventFn }));
  };

  const autoCloseAllowed = canAutoCloseGoal({
    hasSubIssues: actions.hasSubIssues,
    anyOpenSubIssues: actions.anyOpenSubIssues,
  });

  if (autoCloseAllowed) {
    if (actions.goalCloseStatus === "closed") {
      const repaired = repairCanonicalGoalCloseProjection({
        goalNumber,
        readGoalIssueFn: resolvedReadGoalIssueFn,
        projectionTarget,
      });
      actions.closedGoal = repaired.closedGoal;
      actions.skippedGoalClosureReason = repaired.skippedGoalClosureReason;
      return actions;
    }
    if (!String(runsDir || "").trim()) {
      actions.skippedGoalClosureReason = "active_goal_run_guard_unavailable";
      return actions;
    }
    const activeGoalRuns = listActiveGoalRuns({
      runsDir,
      goalNumber,
      excludeRunId: runId,
      readAllRunStatesFn,
    });
    actions.activeGoalRunCount = activeGoalRuns.length;
    actions.activeGoalRunIds = activeGoalRuns.map((entry) => entry.runId);
    if (activeGoalRuns.length > 0) {
      actions.skippedGoalClosureReason = "goal_has_active_runs";
      return actions;
    }
    recordCanonicalEvents([
      buildGoalCloseRequestedEvent({
        factoryId,
        runId,
        goalIssueNumber: goalNumber,
        repo,
        requestStatus: "requested",
        reason: "all_sub_issues_shipped",
      }),
    ]);
    const c = projectionTarget.issueClose({ number: String(goalNumber), reason: "completed" });
    recordCanonicalEvents([
      buildGoalCloseAppliedEvent({
        factoryId,
        runId,
        goalIssueNumber: goalNumber,
        repo,
        closeStatus: c && c.ok ? "closed" : "failed",
        reason: "completed",
        error: c?.error || c?.stderr || "",
      }),
    ]);
    if (c && c.ok) {
      actions.closedGoal = true;
      actions.goalCloseStatus = "closed";
    } else {
      actions.goalCloseStatus = "failed";
    }
  }

  if (!actions.closedGoal && actions.anyOpenSubIssues) {
    // @context:regression !critical Must use the caller-supplied factoryId, not the
    // hardcoded "mothership" default. Hardcoding causes managed factories (e.g. example-trading)
    // to re-add a mothership-prefixed ready label instead of the factory's own label.
    // refs: #2598
    const effectiveFactoryId = (typeof factoryId === "string" && factoryId.trim()) ? factoryId.trim() : "mothership";
    const readyLabel = getFactoryLabelName(effectiveFactoryId, FACTORY_LABEL_KEYS.READY);
    const addReady = projectionTarget.issueEdit({ number: String(goalNumber), addLabels: [readyLabel] });
    actions.reAddedReady = !!(addReady && addReady.ok);
  }

  if (factoryId && canonicalEvents.length > 0 && typeof appendCanonicalEventsFn === "function") {
    actions.canonical_event_commit_cursor = Number(appendCanonicalEventsFn({
      events: canonicalEvents,
      runsDir,
      context: {
        factory_id: factoryId,
      },
      repoRoot,
      surface: "canonical goal lifecycle",
    }) || 0);
  }

  return actions;
}
