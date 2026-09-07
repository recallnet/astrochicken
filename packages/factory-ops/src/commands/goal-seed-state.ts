import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { listGoalSubIssues } from "./goal-sub-issues.ts";

const TERMINAL_STATUSES = new Set(["completed", "failed", "guarded"]);

/**
 * Collect issue numbers that were approved in prior goal_execute runs.
 *
 * Scans runsDir for terminal (completed/failed/guarded) runs whose context
 * has goal_issue_number matching goalNumber, and unions their completed_issues.
 *
 * Running/suspended runs are excluded — their completed_issues are in-flux.
 */
function collectPriorRunData(runsDir, goalNumber) {
  const approved = new Set();
  const bestProcessed = [];
  let bestImplResults = "[]";
  let bestImplCount = 0;
  let bestProgressCount = -1;

  if (!runsDir || !existsSync(runsDir)) {
    return { approved, processed: bestProcessed, implResults: bestImplResults, planIndex: 0 };
  }

  const goalNum = String(goalNumber);
  let entries;
  try { entries = readdirSync(runsDir); } catch { return { approved, implResults: bestImplResults }; }

  for (const entry of entries) {
    const stateFile = join(runsDir, entry, "state.json");
    if (!existsSync(stateFile)) continue;

    try {
      const state = JSON.parse(readFileSync(stateFile, "utf8"));
      if (!TERMINAL_STATUSES.has(state.status)) continue;

      const ctx = state.context || {};
      if (String(ctx.goal_issue_number || "") !== goalNum) continue;

      let completed = ctx.completed_issues;
      if (typeof completed === "string") {
        try { completed = JSON.parse(completed); } catch { continue; }
      }
      if (!Array.isArray(completed)) continue;

      for (const num of completed) {
        approved.add(String(num));
      }

      let processed = ctx.processed_issues;
      if (typeof processed === "string") {
        try { processed = JSON.parse(processed); } catch { processed = []; }
      }
      const normalizedProcessed = Array.isArray(processed)
        ? processed.map((num) => String(num)).filter(Boolean)
        : [];

      if (normalizedProcessed.length > bestProgressCount) {
        bestProcessed.length = 0;
        for (const num of normalizedProcessed) bestProcessed.push(num);
        bestProgressCount = normalizedProcessed.length;
      }

      // Track impl_results from the run with the most completed issues
      const implRaw = ctx.impl_results;
      if (implRaw && (
        normalizedProcessed.length > bestImplCount
        || (normalizedProcessed.length === 0 && completed.length > bestImplCount)
      )) {
        let parsed;
        try { parsed = typeof implRaw === "string" ? JSON.parse(implRaw) : implRaw; } catch { parsed = null; }
        if (Array.isArray(parsed) && parsed.length > 0) {
          bestImplResults = typeof implRaw === "string" ? implRaw : JSON.stringify(implRaw);
          bestImplCount = normalizedProcessed.length > 0 ? normalizedProcessed.length : completed.length;
        }
      }
    } catch {
      // Corrupt or partial — skip.
    }
  }

  return {
    approved,
    processed: bestProcessed,
    implResults: bestImplResults,
    planIndex: Math.max(0, bestProcessed.length),
  };
}

/**
 * Seed completed_issues and processed_issues from durable sub-issue state
 * and prior run history.
 *
 * - completed_issues: only currently closed sub-issues
 * - processed_issues: only currently closed issues with successful prior execution evidence
 *
 * @param {{ repo: string, goalNumber: string|number, runsDir?: string, listSubIssuesFn?: Function }} opts
 * @returns {{ completed_issues: string[], processed_issues: string[] }}
 */
export function seedGoalState({
  repo,
  goalNumber,
  runsDir,
  listSubIssuesFn = listGoalSubIssues,
} = {}) {
  if (!repo || !goalNumber) {
    return { completed_issues: [], processed_issues: [], impl_results: "[]", plan_index: 0 };
  }

  const subIssues = listSubIssuesFn({ repo, goalNumber });
  const closedSet = new Set(
    subIssues
      .filter((i) => i.state !== "open")
      .map((i) => String(i.number)),
  );
  const closedNums = subIssues
    .filter((i) => i.state !== "open")
    .map((i) => String(i.number));

  const {
    approved: priorApproved,
    processed: priorProcessed,
    implResults,
    planIndex,
  } = collectPriorRunData(runsDir, goalNumber);
  const merged = new Set(closedNums);
  for (const num of priorApproved) {
    if (closedSet.has(String(num))) merged.add(String(num));
  }

  // Only carry forward processed_issues for issues with a successful impl_result.
  // Failed issues must be re-attempted, not skipped as "already processed".
  const failedIssueNums = new Set();
  let parsedImplResults = [];
  try {
    const parsed = typeof implResults === "string" ? JSON.parse(implResults) : implResults;
    if (Array.isArray(parsed)) {
      parsedImplResults = parsed;
      for (const r of parsed) {
        if (String(r?.review_failed) === "true") {
          failedIssueNums.add(String(r.issue_number));
        }
      }
    }
  } catch { /* ignore parse errors */ }

  const effectiveProcessed = priorProcessed.filter((num) => closedSet.has(String(num)) && !failedIssueNums.has(String(num)));

  // Strip review_failed entries from seeded impl_results.
  // Failed issues will be re-attempted in the new run. If their stale
  // impl_results leak into split_results → handle_review_failures, the
  // system re-posts failure comments every cycle, inflating the quarantine
  // counter until the issue is permanently quarantined despite never being
  // re-executed. Only approved entries are needed for merge resume.
  const cleanedImplResults = parsedImplResults.filter(
    (r) => String(r?.review_failed) !== "true",
  );

  return {
    completed_issues: [...merged].sort((a, b) => Number(a) - Number(b)),
    processed_issues: [...new Set(effectiveProcessed)].sort((a, b) => Number(a) - Number(b)),
    // NEVER carry forward impl_results from prior runs. Each goal_execute
    // cycle must start with empty impl_results. Stale impl_results from
    // prior runs contain review_failed entries that feed into split_results
    // → handle_review_failures → quarantine, even when the items have real
    // execution evidence (branch, worktree) from the prior run. The only
    // safe seed is completed_issues (closed sub-issues to skip).
    impl_results: "[]",
    // plan_index must be 0: the execution plan only contains unprocessed
    // issues, so the loop always starts at the beginning. Using
    // effectiveProcessed.length skipped issues that were never executed
    // (e.g., #1355 was skipped because plan_index=1 from a prior run's
    // processed count, even though the plan only had 1 item).
    plan_index: 0,
  };
}
