const NON_ACTIONABLE_LABELS = new Set(["deferred", "quarantined"]);

function hasLabel(issue, name) {
  return (issue?.labels || []).some((l) => String(l?.name || "") === name);
}

/**
 * Detect goals with zero actionable features.
 * A feature is "actionable" if it has none of the non-actionable labels.
 * Only flags goals that have evidence of prior decomposition (milestones exist).
 * Backlog goals (no milestones) are not stuck — they just haven't been dispatched.
 *
 * @param {{ goals: Array<{number, title, labels}>, features: Array<{number, milestone: {title}, labels: Array<{name}>}>, milestones: Array<{title, state}> }} opts
 * @returns {Array<{issue, title, problem, suggested_action}>}
 */
export function detectStuckGoals({ goals = [], features = [], milestones = [], goalSubIssues = {} } = {}) {
  const items = [];

  for (const goal of goals) {
    const goalPrefix = `goal-${goal.number}-`;

    // Check if this goal has ever been decomposed (milestones created)
    const goalMilestones = milestones.filter((m) => m.title?.startsWith(goalPrefix));
    if (goalMilestones.length === 0) {
      // Backlog goal — never decomposed, not stuck
      continue;
    }

    const hasReady = hasLabel(goal, "ready");
    const subIssues = Array.isArray(goalSubIssues[goal.number]) ? goalSubIssues[goal.number] : [];

    const openSubIssues = subIssues.filter(
      (s) => String(s.state || "").toLowerCase() === "open",
    );
    const openGoalMilestones = goalMilestones.filter(
      (m) => String(m.state || "").toLowerCase() === "open",
    );
    const openGoalFeatures = features.filter(
      (f) => f.milestone?.title?.startsWith(goalPrefix),
    );

    if (hasReady && goalMilestones.length > 0 && openGoalMilestones.length === 0 && openGoalFeatures.length === 0 && openSubIssues.length === 0) {
      items.push({
        issue: goal.number,
        title: goal.title,
        problem: `goal is still labeled ready but all ${goalMilestones.length} historical milestone(s) are closed and zero open features remain — goal should be closed`,
        suggested_action: `gh issue close ${goal.number} --repo REPO --reason completed --comment 'All goal work complete. Closing goal.'`,
      });
      continue;
    }

    const goalFeatures = features.filter(
      (f) => f.milestone?.title?.startsWith(goalPrefix)
    );

    if (goalFeatures.length === 0 && subIssues.length === 0) {
      items.push({
        issue: goal.number,
        title: goal.title,
        problem: `goal has ${goalMilestones.length} milestone(s) but zero feature issues — decomposition may have failed`,
        suggested_action: `Review goal #${goal.number} — milestones exist but no features were created. May need re-decomposition.`,
      });
      continue;
    }

    const actionable = goalFeatures.filter((f) => {
      const labels = (f.labels || []).map((l) => l.name);
      return !labels.some((l) => NON_ACTIONABLE_LABELS.has(l));
    });

    if (actionable.length === 0 && subIssues.length === 0) {
      const labelSummary = goalFeatures.map(
        (f) => `#${f.number}: ${(f.labels || []).map((l) => l.name).join(",")}`
      );
      items.push({
        issue: goal.number,
        title: goal.title,
        problem: `goal has no actionable features — all ${goalFeatures.length} features are blocked/deferred/quarantined: ${labelSummary.join("; ")}`,
        suggested_action: `Re-triage features for goal #${goal.number} — remove deferred/blocked labels where possible, or close the goal if it's no longer viable`,
      });
    }
  }

  return items;
}
