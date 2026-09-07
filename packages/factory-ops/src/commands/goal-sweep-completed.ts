import { createGhCliAdapter } from "@hatch/github-adapter";

import { reconcileGoalFinalState } from "./goal-final-state-review.ts";
import { listCanonicalGoalCandidatesForRepoSync } from "../lib/canonical-issue-lifecycle.ts";

function buildGoalSweepAdapter({ repo, ghExecFn } = {}) {
  if (!repo) return null;
  // @context:integration Goal sweep must read open goals through github-adapter ownership so
  // the recovery path cannot regress back to repo-local gh issue list transport.
  return createGhCliAdapter({
    repo,
    ghFn: typeof ghExecFn === "function"
      ? (args, options) => ghExecFn(args, options)
      : undefined,
  });
}

/**
 * Sweep all open goals.
 * For each, run reconcileGoalFinalState to close the goal if all
 * sub-issues are done. This catches goals that goal_execute's
 * final_state_review missed (e.g., silent failures, goals reopened
 * after sub-issues already closed).
 *
 * @param {{ repo: string, githubAdapter?: object, ghExecFn?: Function, reconcileFn?: Function }} opts
 */
// @context:regression !critical reconcileGoalFinalState is async. The sweep must
// await it, otherwise result.closedGoal is undefined (Promise property access) and
// the sweep always reports "not_all_work_done" even when all sub-issues are closed.
// This caused example-trading #1942 to stay open despite 6/6 sub-issues being done.
export async function sweepCompletedGoals({
  repo,
  repoRoot = process.cwd(),
  runsDir = "",
  factoryId = "mothership",
  githubAdapter,
  ghExecFn,
  listCanonicalGoalCandidatesFn = listCanonicalGoalCandidatesForRepoSync,
  reconcileFn = reconcileGoalFinalState,
} = {}) {
  if (!repo) return { swept: 0, closed: [], skipped: [], errors: [] };

  const goalReadAdapter = githubAdapter || buildGoalSweepAdapter({ repo, ghExecFn });
  const canonicalGoals = typeof listCanonicalGoalCandidatesFn === "function"
    ? listCanonicalGoalCandidatesFn({ factoryId, repo })
    : [];
  const githubOpenGoals = canonicalGoals.length > 0
    ? []
    : (goalReadAdapter?.issueList({
      state: "open",
      labels: ["goal"],
      limit: 100,
      fields: "number,title,labels",
    }) || []);

  const goalCandidates = new Map();
  for (const goal of Array.isArray(canonicalGoals) ? canonicalGoals : []) {
    const goalNumber = Number.parseInt(String(goal?.goal_number || ""), 10);
    if (!Number.isFinite(goalNumber) || goalNumber <= 0) continue;
    const viewedGoal = typeof goalReadAdapter?.issueView === "function"
      ? goalReadAdapter.issueView({ number: goalNumber, fields: "number,title" })
      : null;
    goalCandidates.set(goalNumber, {
      number: goalNumber,
      title: String(viewedGoal?.title || goal?.title || `#${goalNumber}`),
      labels: [],
    });
  }
  for (const goal of Array.isArray(githubOpenGoals) ? githubOpenGoals : []) {
    const goalNumber = Number.parseInt(String(goal?.number || ""), 10);
    if (!Number.isFinite(goalNumber) || goalNumber <= 0) continue;
    const current = goalCandidates.get(goalNumber) || {};
    goalCandidates.set(goalNumber, {
      number: goalNumber,
      title: String(goal?.title || current.title || `#${goalNumber}`),
      labels: Array.isArray(goal?.labels) ? goal.labels : [],
    });
  }
  const openGoals = [...goalCandidates.values()].sort((left, right) => left.number - right.number);

  const closed = [];
  const skipped = [];
  const errors = [];

  for (const goal of openGoals) {
    try {
      // @context:regression !critical The sweep must NOT set
      // allSubIssueExecutionsCompleted. The sweep has no knowledge of whether
      // sub-issue executions actually ran. Setting it unconditionally caused
      // freshly-decomposed goals to have their sub-issues immediately closed
      // before any code was written (example-trading #1748-#1758 incident).
      // Sub-issue orphan cleanup belongs in the goal execution graph's
      // final_state_review node, not in the periodic sweep.
      const result = await reconcileFn({
        repo,
        repoRoot,
        goalNumber: goal.number,
        runsDir,
        factoryId,
      });
      if (result.closedGoal) {
        closed.push({ number: goal.number, title: goal.title });
      } else {
        const reasons = [];
        if (result.skippedGoalClosureReason) reasons.push(result.skippedGoalClosureReason);
        skipped.push({ number: goal.number, title: goal.title, reason: reasons.join("; ") || "not_all_work_done" });
      }
    } catch (err) {
      errors.push({ number: goal.number, error: String(err?.message || err) });
    }
  }

  return {
    swept: openGoals.length,
    closed,
    skipped,
    errors,
  };
}
