import { listGoalHardStates } from "./goal-hard-state.ts";
import { ghJson } from "../lib/cli-helpers.ts";

export function getSupervisorStatus({ repo, ghJsonFn = ghJson, listGoalHardStatesFn = listGoalHardStates } = {}) {
  if (!repo) return {
    repo: "",
    open_goals: [],
    ready_goals: [],
    awaiting_hard_plan_review_count: 0,
    awaiting_hard_plan_review_goal_numbers: [],
  };

  const goals = ghJsonFn([
    "issue", "list", "--repo", repo, "--state", "open", "--label", "goal", "--limit", "200",
    "--json", "number,title,labels",
  ]);

  const openGoals = goals.map((g) => ({
    goal_number: Number(g.number),
    title: String(g.title || ""),
    labels: (g.labels || []).map((l) => String(l?.name || "")).filter(Boolean),
  }));

  const readyGoals = openGoals.filter((g) => g.labels.includes("ready")).map((g) => g.goal_number);
  let hardGoalStates = {
    awaiting_post_plan_review_count: 0,
    awaiting_post_plan_review_goal_numbers: [],
  };
  try {
    hardGoalStates = listGoalHardStatesFn({
      repo,
      goals,
    });
  } catch {
    // Keep supervisor status available even if hard-state inspection fails.
  }

  return {
    repo,
    open_goal_count: openGoals.length,
    open_goals: openGoals,
    ready_goal_numbers: readyGoals,
    awaiting_hard_plan_review_count: Number(hardGoalStates.awaiting_post_plan_review_count || 0),
    awaiting_hard_plan_review_goal_numbers: Array.isArray(hardGoalStates.awaiting_post_plan_review_goal_numbers)
      ? hardGoalStates.awaiting_post_plan_review_goal_numbers
      : [],
  };
}
