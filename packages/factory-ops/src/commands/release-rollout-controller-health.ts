import { trim } from "../lib/cli-helpers.ts";

const FAILING_TICK_STATUSES = new Set(["failed", "guarded", "guarded_terminal", "blocked", "suspended", "terminal"]);

function toPositiveInt(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return Math.max(0, Math.trunc(Number(fallback) || 0));
  return Math.max(1, Math.trunc(parsed));
}

function toNonNegativeInt(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return Math.max(0, Math.trunc(Number(fallback) || 0));
  return Math.max(0, Math.trunc(parsed));
}

function summarizeFactoryStatus(status = {}) {
  return {
    active_count: Array.isArray(status?.active) ? status.active.length : 0,
    completed_count: toNonNegativeInt(status?.completed, 0),
    failed_count: toNonNegativeInt(status?.failed, 0),
  };
}

function summarizeTickStatus(result = {}) {
  const ticks = Array.isArray(result?.ticks) ? result.ticks : [];
  const failedTickCount = ticks.filter((tick) => FAILING_TICK_STATUSES.has(trim(tick?.status || ""))).length;
  const current = ticks[0] || {};
  return {
    tick_count: ticks.length,
    failed_tick_count: failedTickCount,
    current_tick_status: trim(current?.status || ""),
    current_stage: trim(current?.stage || ""),
    current_stage_label: trim(current?.stageLabel || ""),
  };
}

function summarizeOutcomes(outcomes = {}) {
  return {
    merged_prs: toNonNegativeInt(outcomes?.merged_prs, 0),
    merge_commits_main: toNonNegativeInt(outcomes?.merge_commits_main, 0),
    closed_features: toNonNegativeInt(outcomes?.closed_features, 0),
    closed_bugs: toNonNegativeInt(outcomes?.closed_bugs, 0),
    closed_feature_bug_total: toNonNegativeInt(outcomes?.closed_feature_bug_total, 0),
  };
}

function normalizeHealthPolicy(policy = {}) {
  const raw = policy && typeof policy === "object" ? policy : {};
  return {
    max_failed_runs: toNonNegativeInt(raw.max_failed_runs, 0),
    max_failed_ticks: toNonNegativeInt(raw.max_failed_ticks, 0),
    min_merged_prs: toNonNegativeInt(raw.min_merged_prs, 0),
    min_merge_commits_main: toNonNegativeInt(raw.min_merge_commits_main, 0),
    min_closed_features: toNonNegativeInt(raw.min_closed_features, 0),
    min_closed_bugs: toNonNegativeInt(raw.min_closed_bugs, 0),
    min_closed_feature_bug_total: toNonNegativeInt(raw.min_closed_feature_bug_total, 0),
    max_polls: toPositiveInt(raw.max_polls, 1),
    poll_interval_ms: toNonNegativeInt(raw.poll_interval_ms, 0),
  };
}

export function evaluateReleaseCanaryHealth({
  factoryStatusSnapshot = {},
  tickStatusSnapshot = {},
  outcomesSnapshot = {},
  healthPolicy = {},
  checkedAt = "",
} = {}) {
  const policy = normalizeHealthPolicy(healthPolicy);
  const factory = summarizeFactoryStatus(factoryStatusSnapshot);
  const tick = summarizeTickStatus(tickStatusSnapshot);
  const outcomes = summarizeOutcomes(outcomesSnapshot);
  const snapshot = {
    checked_at: trim(checkedAt || new Date().toISOString()),
    policy,
    factory_status: factory,
    tick_status: tick,
    outcomes,
    verdict: "pending",
    reason: "health_checks_pending",
  };

  if (factory.failed_count > policy.max_failed_runs) {
    snapshot.verdict = "failed";
    snapshot.reason = "factory_status_failed_runs";
    return { passed: false, verdict: snapshot.verdict, reason: snapshot.reason, snapshot };
  }

  if (tick.failed_tick_count > policy.max_failed_ticks) {
    snapshot.verdict = "failed";
    snapshot.reason = "factory_tick_status_failed_ticks";
    return { passed: false, verdict: snapshot.verdict, reason: snapshot.reason, snapshot };
  }

  const pendingChecks = [];
  if (outcomes.merged_prs < policy.min_merged_prs) pendingChecks.push("merged_prs");
  if (outcomes.merge_commits_main < policy.min_merge_commits_main) pendingChecks.push("merge_commits_main");
  if (outcomes.closed_features < policy.min_closed_features) pendingChecks.push("closed_features");
  if (outcomes.closed_bugs < policy.min_closed_bugs) pendingChecks.push("closed_bugs");
  if (outcomes.closed_feature_bug_total < policy.min_closed_feature_bug_total) pendingChecks.push("closed_feature_bug_total");

  if (pendingChecks.length > 0) {
    snapshot.verdict = "pending";
    snapshot.reason = `health_outcomes_pending:${pendingChecks.join(",")}`;
    return { passed: false, verdict: snapshot.verdict, reason: snapshot.reason, snapshot };
  }

  snapshot.verdict = "passed";
  snapshot.reason = "health_check_passed";
  return { passed: true, verdict: snapshot.verdict, reason: snapshot.reason, snapshot };
}

export async function defaultReleaseRolloutSleep(ms = 0) {
  const waitMs = Math.max(0, Number(ms) || 0);
  if (waitMs <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, waitMs));
}

export async function pollReleaseCanaryHealth({
  repo = "",
  repoPath = ".",
  runsDir = ".hatch/runs",
  lookbackHours = 24,
  healthPolicy = {},
  factoryStatusFn,
  tickStatusFn,
  outcomesFn,
  sleepFn = defaultReleaseRolloutSleep,
  nowIsoFn = () => new Date().toISOString(),
} = {}) {
  const policy = normalizeHealthPolicy(healthPolicy);
  const snapshots = [];

  for (let attempt = 1; attempt <= policy.max_polls; attempt += 1) {
    const checkedAt = nowIsoFn();
    let statusSnapshot;
    let tickSnapshot;
    let outcomesSnapshot;

    try {
      statusSnapshot = await Promise.resolve(factoryStatusFn({ runsDir }));
      tickSnapshot = await Promise.resolve(tickStatusFn({ runsDir }));
      outcomesSnapshot = await Promise.resolve(outcomesFn({ repo, repoPath, lookbackHours }));
    } catch (error) {
      return {
        ok: false,
        passed: false,
        verdict: "failed",
        reason: "health_signal_read_failed",
        error: trim(error?.message || error),
        poll_count: attempt,
        snapshots,
      };
    }

    const evaluation = evaluateReleaseCanaryHealth({
      factoryStatusSnapshot: statusSnapshot,
      tickStatusSnapshot: tickSnapshot,
      outcomesSnapshot,
      healthPolicy: policy,
      checkedAt,
    });

    snapshots.push(evaluation.snapshot);

    if (evaluation.verdict === "passed" || evaluation.verdict === "failed") {
      return {
        ok: true,
        passed: evaluation.passed,
        verdict: evaluation.verdict,
        reason: evaluation.reason,
        poll_count: attempt,
        snapshots,
      };
    }

    if (attempt < policy.max_polls) {
      await sleepFn(policy.poll_interval_ms);
    }
  }

  return {
    ok: true,
    passed: false,
    verdict: "timeout",
    reason: "health_check_timeout",
    poll_count: policy.max_polls,
    snapshots,
  };
}
