import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const TERMINAL_STATUSES = new Set(["completed", "failed", "guarded"]);
const MILESTONE_PIPELINE_SUFFIX = "/milestone_execute.dot";

function isMilestoneExecuteRun(state = {}) {
  const pipeline = String(state?.pipeline || state?.pipelineFile || "").trim();
  return pipeline === "milestone_execute.dot" || pipeline.endsWith(MILESTONE_PIPELINE_SUFFIX);
}

function collectPriorMilestoneCompletions(runsDir, milestoneTitle) {
  const completed = new Set();
  if (!String(runsDir || "").trim() || !existsSync(runsDir)) return completed;

  let entries = [];
  try {
    entries = readdirSync(runsDir);
  } catch {
    return completed;
  }

  for (const entry of entries) {
    const statePath = join(runsDir, entry, "state.json");
    if (!existsSync(statePath)) continue;

    try {
      const state = JSON.parse(readFileSync(statePath, "utf8"));
      if (!TERMINAL_STATUSES.has(String(state?.status || ""))) continue;
      if (!isMilestoneExecuteRun(state)) continue;

      const context = state?.context || {};
      if (String(context.milestone_title || "") !== String(milestoneTitle)) continue;

      let priorCompleted = context.completed_issues;
      if (typeof priorCompleted === "string") {
        priorCompleted = JSON.parse(priorCompleted);
      }
      if (!Array.isArray(priorCompleted)) continue;

      for (const issueNumber of priorCompleted) {
        const normalized = String(issueNumber || "").trim();
        if (normalized) completed.add(normalized);
      }
    } catch {
      // @context:regression !critical Malformed or in-flight run state must not
      // block seed-state recovery; the canonical invariant is "ignore bad runs",
      // not "crash and re-open already completed milestone issues".
    }
  }

  return completed;
}

/**
 * Seed completed_issues and processed_issues from canonical milestone runs.
 *
 * completed_issues comes only from terminal milestone_execute run state for the
 * same milestone. processed_issues intentionally starts empty because it tracks
 * attempts in the current execution only.
 */
export function seedMilestoneState({ milestoneTitle, runsDir } = {}) {
  if (!milestoneTitle) {
    return { completed_issues: [], processed_issues: [] };
  }

  const completed = [...collectPriorMilestoneCompletions(runsDir, milestoneTitle)]
    .sort((left, right) => Number(left) - Number(right));

  return {
    completed_issues: completed,
    processed_issues: [],
  };
}
