export function buildGoalIssueRows({
  summary = {},
  nowMs = Date.now(),
  helpers = {},
} = {}) {
  const {
    toNumber,
    trim,
    compactGraphLabel,
    buildLiveAttachRefs,
    withLivePrefix,
    withRunIdentity,
    normalizeDetail,
    formatAge,
    stableCompare,
    isGoalIssueFamily,
    isGoalRunFamily,
    isProvisionalHardExecutionPath,
    resolveGoalExecutionPathBadge,
  } = helpers;

  const nonWaveActive = Array.isArray(summary.non_wave_active) ? summary.non_wave_active : [];
  const explicitRows = nonWaveActive
    .filter((run) => isGoalIssueFamily(run))
    .map((run) => {
      const issueNumber = toNumber(run.issue_number, 0);
      const graphLabel = compactGraphLabel(run.graph || run.graph_label) || "goal_issue_execute.dot";
      const stepLabel = trim(run.node || run.current_node || "");
      const progressAge = formatAge(nowMs, run.last_progress_at || "");
      const liveAttachable = run.live_attachable === true;
      const refs = buildLiveAttachRefs({
        refs: {
          run_id: trim(run.run_id || ""),
          graph: trim(run.graph_label || graphLabel),
          trace_run_id: trim(run.trace_run_id || ""),
        },
        liveAttachable,
        liveAttachTarget: run.live_attach_target,
      });
      const goalExecutionPath = trim(run.goal_execution_path || "") || "unknown";
      const goalExecutionMode = trim(run.goal_execution_mode || "");
      const isDirectGoalExecution = run.is_direct_goal_execution === true;
      const planningState = trim(run.planning_state || run.goal_routing_state?.planning_state || "").toLowerCase();
      const planningReviewRequired = planningState === "pending_review";
      const provisionalHard = isProvisionalHardExecutionPath({
        path: goalExecutionPath,
        provisional: run.provisional_hard === true || run.provisional === true,
        routingState: run.goal_routing_state,
      });
      const goalExecutionPathLabel = resolveGoalExecutionPathBadge(goalExecutionPath, goalExecutionMode, isDirectGoalExecution, provisionalHard);
      const resolvedTitle = issueNumber > 0 ? `Issue #${issueNumber}` : graphLabel;
      return withRunIdentity({
        id: `goal-issue:${trim(run.run_id || "")}`,
        kind: "goal_issue",
        issue: issueNumber > 0 ? `#${issueNumber}` : "",
        title: withLivePrefix(resolvedTitle, liveAttachable),
        status: "running",
        summary: `${trim(run.node || "unknown")} • path=${goalExecutionPathLabel} • ${trim(run.expected_next_outcome || "run state update")}`,
        progress_label: stepLabel,
        updated_at: trim(run.last_progress_at || ""),
        // @context:regression !critical The AGE column must describe the current step freshness,
        // not total run lifetime. Using run.age here makes fresh judge/review/build stages look
        // hung for the entire goal duration even when the latest heartbeat is only seconds old.
        updated_age: progressAge || trim(run.age || ""),
        badges: [
          trim(run.node || ""),
          `path:${goalExecutionPathLabel}`,
          planningState ? `planning:${planningState}` : "",
          planningReviewRequired ? "planning_review_required" : "",
          run.no_git_delta_since_start === true ? "zero_delta_burn" : "",
          run.trace_kind ? `trace:${run.trace_kind}` : "",
          liveAttachable ? "live" : "",
        ].filter(Boolean),
        refs: {
          ...refs,
          goal_execution_path: goalExecutionPath,
          goal_execution_mode: goalExecutionMode,
          is_direct_goal_execution: isDirectGoalExecution,
          provisional_hard: provisionalHard,
          provisional: provisionalHard,
          planning_state: planningState,
          planning_review_required: planningReviewRequired,
        },
        detail: normalizeDetail([
          `Execution path: ${goalExecutionPathLabel}`,
          provisionalHard ? "Provisional hard path: true" : "",
          planningState ? `Planning state: ${planningState}` : "",
          planningReviewRequired ? "Planning review required: true" : "",
          run.no_git_delta_since_start === true ? "Git progress: none since issue start" : "",
          run.worktree_clean === true ? "Worktree: clean" : "",
          run.worktree_clean === false ? "Worktree: dirty" : "",
          Number.isFinite(Number(run.commits_ahead)) ? `Branch ahead: ${Number(run.commits_ahead)}` : "",
          Number.isFinite(Number(run.issue_commits_since_snapshot)) || Array.isArray(run.issue_changed_files)
            ? `Issue-scoped delta since snapshot: ${Number(run.issue_commits_since_snapshot || 0)} commits, ${Array.isArray(run.issue_changed_files) ? run.issue_changed_files.length : 0} files`
            : "",
          run.trace_command ? `Trace: ${run.trace_command}` : "",
          trim(run.age ? `Run age: ${run.age}` : ""),
          trim(progressAge ? `Last progress: ${progressAge} ago` : ""),
        ]),
      }, {
        run_id: trim(run.run_id || ""),
        graph: graphLabel,
        node: stepLabel,
        issue_number: issueNumber,
      });
    })
    .sort((left, right) => stableCompare(left.issue, right.issue) || stableCompare(left.id, right.id));

  const explicitIssueNumbers = new Set(
    explicitRows
      .map((row) => toNumber(String(row.issue || "").replace(/^#/, ""), 0))
      .filter((issueNumber) => issueNumber > 0),
  );

  // @context:regression !critical Parent goal runs remain the most durable
  // active record across handoffs. When the child issue run projection lags,
  // the dashboard must still surface the current decomposed issue as a
  // first-class row instead of collapsing visibility into the parent summary.
  const syntheticRows = nonWaveActive
    .filter((run) => isGoalRunFamily(run))
    .map((run) => {
      const currentIssueNumber = toNumber(run.current_issue_number, 0);
      if (currentIssueNumber <= 0 || explicitIssueNumbers.has(currentIssueNumber)) return null;
      const goalIssueNumber = toNumber(run.issue_number, 0);
      const stepLabel = trim(run.node || run.current_node || "");
      const progressAge = formatAge(nowMs, run.last_progress_at || "");
      const liveAttachable = run.live_attachable === true;
      const goalExecutionPath = trim(run.goal_execution_path || "") || "unknown";
      const goalExecutionMode = trim(run.goal_execution_mode || "");
      const isDirectGoalExecution = run.is_direct_goal_execution === true;
      const planningState = trim(run.planning_state || run.goal_routing_state?.planning_state || "").toLowerCase();
      const planningReviewRequired = planningState === "pending_review";
      const provisionalHard = isProvisionalHardExecutionPath({
        path: goalExecutionPath,
        provisional: run.provisional_hard === true || run.provisional === true,
        routingState: run.goal_routing_state,
      });
      const goalExecutionPathLabel = resolveGoalExecutionPathBadge(goalExecutionPath, goalExecutionMode, isDirectGoalExecution, provisionalHard);
      const refs = buildLiveAttachRefs({
        refs: {
          run_id: trim(run.run_id || ""),
          graph: trim(run.graph_label || "goal_issue_execute.dot"),
          trace_run_id: trim(run.trace_run_id || ""),
          synthetic_issue_projection: true,
          parent_goal_issue_number: goalIssueNumber,
        },
        liveAttachable,
        liveAttachTarget: run.live_attach_target,
      });
      return withRunIdentity({
        id: `goal-issue:projected:${trim(run.run_id || "")}:${currentIssueNumber}`,
        kind: "goal_issue",
        issue: `#${currentIssueNumber}`,
        title: withLivePrefix(`Issue #${currentIssueNumber}`, liveAttachable),
        status: "running",
        summary: `${stepLabel || "unknown"} • path=${goalExecutionPathLabel} • projected from parent goal run`,
        progress_label: stepLabel,
        updated_at: trim(run.last_progress_at || ""),
        updated_age: progressAge || trim(run.age || ""),
        badges: [
          stepLabel,
          `path:${goalExecutionPathLabel}`,
          planningState ? `planning:${planningState}` : "",
          planningReviewRequired ? "planning_review_required" : "",
          run.no_git_delta_since_start === true ? "zero_delta_burn" : "",
          "projection:parent_goal_run",
          run.trace_kind ? `trace:${run.trace_kind}` : "",
          liveAttachable ? "live" : "",
        ].filter(Boolean),
        refs: {
          ...refs,
          goal_execution_path: goalExecutionPath,
          goal_execution_mode: goalExecutionMode,
          is_direct_goal_execution: isDirectGoalExecution,
          provisional_hard: provisionalHard,
          provisional: provisionalHard,
          planning_state: planningState,
          planning_review_required: planningReviewRequired,
        },
        detail: normalizeDetail([
          `Projected from parent goal run #${goalIssueNumber || "unknown"} until child issue execution is persisted`,
          `Execution path: ${goalExecutionPathLabel}`,
          provisionalHard ? "Provisional hard path: true" : "",
          planningState ? `Planning state: ${planningState}` : "",
          planningReviewRequired ? "Planning review required: true" : "",
          run.no_git_delta_since_start === true ? "Git progress: none since issue start" : "",
          run.worktree_clean === true ? "Worktree: clean" : "",
          run.worktree_clean === false ? "Worktree: dirty" : "",
          Number.isFinite(Number(run.commits_ahead)) ? `Branch ahead: ${Number(run.commits_ahead)}` : "",
          Number.isFinite(Number(run.issue_commits_since_snapshot)) || Array.isArray(run.issue_changed_files)
            ? `Issue-scoped delta since snapshot: ${Number(run.issue_commits_since_snapshot || 0)} commits, ${Array.isArray(run.issue_changed_files) ? run.issue_changed_files.length : 0} files`
            : "",
          run.trace_command ? `Trace: ${run.trace_command}` : "",
          trim(run.age ? `Run age: ${run.age}` : ""),
          trim(progressAge ? `Last progress: ${progressAge} ago` : ""),
        ]),
      }, {
        run_id: trim(run.run_id || ""),
        graph: "goal_issue_execute.dot",
        node: stepLabel,
        issue_number: currentIssueNumber,
      });
    })
    .filter(Boolean);

  return [...explicitRows, ...syntheticRows]
    .sort((left, right) => stableCompare(left.issue, right.issue) || stableCompare(left.id, right.id));
}
