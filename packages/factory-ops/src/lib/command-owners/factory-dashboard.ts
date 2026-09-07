import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import {
  applyDashboardFiltersToTabs,
  compactGraphLabel,
  normalizeDashboardFilters,
  normalizeRunIdentity,
  withRunIdentity,
} from "../../commands/factory-dashboard-filters.ts";
import { collectFactoryOutcomes } from "../../commands/factory-outcomes.ts";
import { factoryStatus, factoryActiveSummary, readAllRunStates } from "../../commands/factory-status.ts";
import { tickStatus } from "../../commands/factory-tick-status.ts";
import { listGoalSubIssues } from "../../commands/goal-sub-issues.ts";
import { trim } from "../cli-helpers.ts";
import { readScheduledJobsState, resolveScheduledJobs } from "../daemon-schedules.ts";
import { resolveBugGateSummary } from "../factory-dashboard-bug-gate.ts";
import { buildGoalIssueRows } from "../factory-dashboard-goal-issue-rows.ts";
import {
  fetchGoalProgress,
  resolveGoalRunProgressLabel,
} from "../factory-dashboard-goal-progress.ts";
import {
  buildGroupedGoalRuns,
  buildRecentHandoffRows,
  resolveGoalRunIssueNumber,
} from "../factory-dashboard-handoffs.ts";
import { buildRecentRows, summarizeRecent } from "../factory-dashboard-recent.ts";
import { fetchGoalTitlesGraphQLOnly as fetchGoalTitles } from "../fetch-goal-titles-graphql-only.ts";

export const FACTORY_DASHBOARD_SCHEMA_VERSION = "factory_dashboard.v1";

const dashboardRowSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  title: z.string().min(1),
  status: z.string().min(1),
  rows: z.undefined().optional(),
}).passthrough();

const dashboardTabSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  rows: z.array(dashboardRowSchema),
  empty_message: z.string().optional(),
}).passthrough();

const dashboardSchema = z.object({
  schema_version: z.literal(FACTORY_DASHBOARD_SCHEMA_VERSION),
  context: z.record(z.string(), z.any()).optional().default({}),
  generated_at: z.string(),
  summary: z.record(z.string(), z.any()),
  tabs: z.array(dashboardTabSchema),
  extension: z.object({
    module_path: z.string(),
  }).nullable().optional(),
}).superRefine((dashboard, ctx) => {
  const ids = new Set();
  for (const tab of dashboard.tabs) {
    if (ids.has(tab.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate tab id: ${tab.id}`,
        path: ["tabs"],
      });
    }
    ids.add(tab.id);
  }
  for (const required of ["now", "recent"]) {
    if (!ids.has(required)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `required tab missing: ${required}`,
        path: ["tabs"],
      });
    }
  }
});

function buildScheduledJobsSummary({ config = {}, scheduledJobsStatePath = "", nowMs = Date.now() } = {}) {
  const jobs = resolveScheduledJobs(config);
  if (jobs.length === 0) return "";
  const state = readScheduledJobsState(scheduledJobsStatePath);
  const parts = jobs.map((job) => {
    const id = trim(job.id);
    const jobState = state?.jobs?.[id] || {};
    const lastStatus = trim(jobState.last_status || "never_ran");
    const lastAt = trim(jobState.last_completed_at || jobState.last_failed_at || "");
    const age = lastAt ? formatAge(nowMs, lastAt) : "";
    const cron = trim(job.cron);
    const tz = trim(job.time_zone || "UTC");
    const statusLabel = lastStatus === "ok" ? "ok" : lastStatus === "never_ran" ? "pending" : lastStatus;
    return `${id}(${cron} ${tz})=${statusLabel}${age ? ` ${age} ago` : ""}`;
  });
  return `Jobs  ${parts.join("  ")}`;
}


function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseGoalNumber(value = "") {
  const match = String(value || "").match(/goal-(\d+)-wave-\d+/i);
  return match?.[1] ? Number(match[1]) : 0;
}

function formatAge(nowMs, iso = "") {
  const ms = Date.parse(String(iso || ""));
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const diff = Math.max(0, nowMs - ms);
  if (diff < 1000) return `${Math.round(diff)}ms`;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d${hours % 24}h`;
}

function stableCompare(a = "", b = "") {
  return String(a || "").localeCompare(String(b || ""), "en");
}

function isGoalRunGraph(graph = "") {
  return compactGraphLabel(graph) === "goal_execute.dot";
}

function isGoalIssueGraph(graph = "") {
  return compactGraphLabel(graph) === "goal_issue_execute.dot";
}

function isSupervisorGraph(graph = "") {
  const label = compactGraphLabel(graph);
  return label === "factory_supervisor_tick.dot" || label === "managed_supervisor.dot";
}

function isGoalRunFamily(run = {}) {
  const label = compactGraphLabel(run.graph || run.graph_label);
  if (isGoalRunGraph(label)) return true;
  if (label === "goal_run.dot" || label === "goal_intake_decompose.dot" || label === "managed_software_delivery_domain.dot") return true;
  const issueNumber = toNumber(run.issue_number, 0);
  const goalIssueNumber = toNumber(run.goal_issue_number, 0);
  return goalIssueNumber > 0 && (issueNumber <= 0 || issueNumber === goalIssueNumber);
}

function isGoalIssueFamily(run = {}) {
  const label = compactGraphLabel(run.graph || run.graph_label);
  if (isGoalIssueGraph(label)) return true;
  const issueNumber = toNumber(run.issue_number, 0);
  const goalIssueNumber = toNumber(run.goal_issue_number, 0);
  return issueNumber > 0 && goalIssueNumber > 0 && issueNumber !== goalIssueNumber;
}

function normalizeDetail(lines = []) {
  return lines.map((line) => trim(line)).filter(Boolean);
}

function normalizeLiveAttachTarget(value = null) {
  if (!value || typeof value !== "object") return null;
  const compact = {};
  for (const [key, raw] of Object.entries(value)) {
    if (raw === "" || raw === null || raw === undefined) continue;
    compact[key] = raw;
  }
  return Object.keys(compact).length > 0 ? compact : null;
}

function buildLiveAttachRefs({ refs = {}, liveAttachable = false, liveAttachTarget = null } = {}) {
  if (!liveAttachable) return refs;
  const target = normalizeLiveAttachTarget(liveAttachTarget);
  if (!target) return refs;
  return {
    ...refs,
    live_attachable: true,
    live_attach_target: target,
  };
}

function withLivePrefix(text = "", liveAttachable = false) {
  const value = trim(text || "");
  if (!liveAttachable) return value;
  if (!value) return "[live]";
  if (value.startsWith("[live]")) return value;
  return `[live] ${value}`;
}

function buildHardPlanReuseProvenance(hardPlanGoals = []) {
  return (Array.isArray(hardPlanGoals) ? hardPlanGoals : [])
    .map((row) => {
      const goalIssueNumber = toNumber(row?.goal_issue_number, 0);
      if (goalIssueNumber <= 0) return null;
      return {
        goal_issue_number: goalIssueNumber,
        prerequisite_goal_issue_numbers: Array.isArray(row?.prerequisite_goal_issue_numbers)
          ? row.prerequisite_goal_issue_numbers
            .map((entry) => toNumber(entry, 0))
            .filter((entry) => entry > 0)
            .sort((left, right) => left - right)
          : [],
        final_instantiation_goal_issue_number: (() => {
          const value = toNumber(row?.final_instantiation_goal_issue_number, 0);
          return value > 0 ? value : null;
        })(),
        goal_issue_map: row?.goal_issue_map && typeof row.goal_issue_map === "object" && !Array.isArray(row.goal_issue_map)
          ? row.goal_issue_map
          : {},
        issue_set_map: row?.issue_set_map && typeof row.issue_set_map === "object" && !Array.isArray(row.issue_set_map)
          ? row.issue_set_map
          : {},
        goal_feature_issue_map: row?.goal_feature_issue_map && typeof row.goal_feature_issue_map === "object" && !Array.isArray(row.goal_feature_issue_map)
          ? row.goal_feature_issue_map
          : {},
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.goal_issue_number - right.goal_issue_number);
}

function buildHardPlanReuseSummaryLine(provenanceRows = []) {
  const rows = Array.isArray(provenanceRows) ? provenanceRows : [];
  if (rows.length === 0) return "";
  const latest = rows[rows.length - 1];
  const prereqList = Array.isArray(latest.prerequisite_goal_issue_numbers)
    ? latest.prerequisite_goal_issue_numbers.map((num) => `#${num}`).join(",")
    : "";
  const prereqLabel = `[${prereqList}]`;
  const finalLabel = latest.final_instantiation_goal_issue_number
    ? `#${latest.final_instantiation_goal_issue_number}`
    : "n/a";
  return `Prereqs: Goal #${latest.goal_issue_number} ← ${prereqLabel} → final ${finalLabel}`;
}

function buildSummary({ status = {}, summary = {}, tick = {}, nowMs = Date.now(), lookbackHours = 24 } = {}) {
  const managed = status.managed_state || {};
  const hasActiveRuns = Array.isArray(status.active) ? status.active.length > 0 : false;
  const currentTick = hasActiveRuns && Array.isArray(tick.ticks)
    ? tick.ticks.find((entry) => String(entry?.status || "").trim() === "running")
    : null;
  const blocked = Array.isArray(status.blocked_control_plane) ? status.blocked_control_plane.length : 0;
  const openPackets = Array.isArray(status.open_packets) ? status.open_packets.length : 0;
  const hardGoalReview = status?.hard_goal_review && typeof status.hard_goal_review === "object"
    ? status.hard_goal_review
    : {};
  const hardPlanTraceability = status?.hard_plan_traceability && typeof status.hard_plan_traceability === "object"
    ? status.hard_plan_traceability
    : {};
  const hardPlanMaterializedGoals = Array.isArray(hardPlanTraceability.goals)
    ? hardPlanTraceability.goals
    : [];
  const hardPlanReuseProvenance = buildHardPlanReuseProvenance(hardPlanMaterializedGoals);
  const outcomes = summary?.recent || {};
  const nonWaveActive = Array.isArray(summary.non_wave_active) ? summary.non_wave_active : [];
  const activeGoals = buildGroupedGoalRuns({ non_wave_active: nonWaveActive }, isGoalRunFamily).length;
  const activeGoalIssues = nonWaveActive.filter((row) => isGoalIssueFamily(row)).length;
  const bugGate = resolveBugGateSummary({ status, tick, summary });
  return {
    health: trim(managed.health_classification || "unknown"),
    state_action: trim(managed.state_action || "none"),
    state_reason: trim(managed.reason || ""),
    current_tick: currentTick ? {
      run_id: trim(currentTick.runId || currentTick.id || ""),
      stage: trim(currentTick.stageLabel || currentTick.stage || ""),
      progress: trim(currentTick.progress || ""),
      started_at: trim(currentTick.startedAt || ""),
      age: formatAge(nowMs, currentTick.startedAt || ""),
    } : null,
    active_runs: toNumber(summary.active_run_count, 0),
    active_waves: toNumber(summary.active_wave_count, 0),
    active_goals: activeGoals,
    active_goal_issues: activeGoalIssues,
    blocked,
    open_packets: openPackets,
    awaiting_hard_plan_review_count: toNumber(hardGoalReview.awaiting_post_plan_review_count, 0),
    awaiting_hard_plan_review_goal_numbers: Array.isArray(hardGoalReview.awaiting_post_plan_review_goal_numbers)
      ? hardGoalReview.awaiting_post_plan_review_goal_numbers
      : [],
    hard_plan_materialized_goal_count: toNumber(hardPlanTraceability.goals_with_materialized_hard_plans, 0),
    hard_plan_materialized_goals: hardPlanMaterializedGoals,
    hard_plan_reuse_provenance: hardPlanReuseProvenance,
    hard_plan_reuse_summary: buildHardPlanReuseSummaryLine(hardPlanReuseProvenance),
    lookback_hours: lookbackHours,
    bug_gate: bugGate,
    recent_outcomes: {
      merged: toNumber(outcomes.merged, 0),
      goals: toNumber(outcomes.goals, 0),
      issues: toNumber(outcomes.issues, 0),
      commits: toNumber(outcomes.commits, 0),
    },
  };
}

function isProvisionalHardExecutionPath({ path = "", provisional = false, routingState = {} } = {}) {
  if (provisional === true) return true;
  const normalizedPath = trim(path || "").toLowerCase();
  const state = routingState && typeof routingState === "object" ? routingState : {};
  return normalizedPath === "hard"
    && trim(state.decomposition_state || "").toLowerCase() === "required"
    && trim(state.planning_state || "").toLowerCase() === "not_required";
}

function resolveGoalExecutionPathBadge(path = "", mode = "", isDirect = false, provisional = false) {
  const normalizedPath = trim(path || "") || "unknown";
  const normalizedMode = trim(mode || "").toLowerCase();
  if (isDirect || (normalizedPath === "easy" && normalizedMode === "direct")) {
    return `${normalizedPath} (direct)`;
  }
  if (provisional === true && normalizedPath === "hard") {
    return "hard (provisional)";
  }
  return normalizedPath;
}


function buildGoalRows({ summary = {}, nowMs = Date.now(), goalTitles = {} } = {}) {
  const grouped = new Map();
  for (const wave of Array.isArray(summary.waves) ? summary.waves : []) {
    const goalNumber = parseGoalNumber(wave.milestone_title);
    if (!goalNumber) continue;
    const key = String(goalNumber);
    if (!grouped.has(key)) {
      grouped.set(key, {
        goal_number: goalNumber,
        active_waves: 0,
        completed_issues: 0,
        total_issues: 0,
        latest_update: "",
        wave_titles: [],
        stages: new Set(),
        goal_execution_path: "unknown",
        goal_execution_mode: "",
        is_direct_goal_execution: false,
        provisional_hard: false,
        planning_state: "",
        planning_review_required: false,
      });
    }
    const entry = grouped.get(key);
    entry.active_waves += 1;
    entry.completed_issues += toNumber(wave.completed_issues, 0);
    entry.total_issues += toNumber(wave.total_issues, 0);
    entry.wave_titles.push(trim(wave.milestone_title));
    entry.stages.add(trim(wave.current_issue_node || ""));
    const wavePath = trim(wave.goal_execution_path || "") || "unknown";
    if (entry.goal_execution_path === "unknown" && wavePath !== "unknown") {
      entry.goal_execution_path = wavePath;
    }
    const waveMode = trim(wave.goal_execution_mode || "");
    if (!entry.goal_execution_mode && waveMode) {
      entry.goal_execution_mode = waveMode;
    }
    if (wave.is_direct_goal_execution === true) {
      entry.is_direct_goal_execution = true;
    }
    if (isProvisionalHardExecutionPath({
      path: wave.goal_execution_path,
      provisional: wave.provisional_hard === true || wave.provisional === true,
      routingState: wave.goal_routing_state,
    })) {
      entry.provisional_hard = true;
    }
    const planningState = trim(wave.planning_state || wave.goal_routing_state?.planning_state || "").toLowerCase();
    if (!entry.planning_state && (planningState === "pending_review" || planningState === "approved")) {
      entry.planning_state = planningState;
    }
    if (planningState === "pending_review") {
      entry.planning_review_required = true;
    }
    const updatedAt = trim(wave.last_progress_at || "");
    if (!entry.latest_update || Date.parse(updatedAt) > Date.parse(entry.latest_update)) {
      entry.latest_update = updatedAt;
    }
  }

  return [...grouped.values()]
    .sort((left, right) => left.goal_number - right.goal_number)
    .map((goal) => withRunIdentity({
      id: `goal:${goal.goal_number}`,
      kind: "goal",
      issue: `#${goal.goal_number}`,
      title: trim(goalTitles[goal.goal_number] || "") || `Goal #${goal.goal_number}`,
      status: "in_flight",
      summary: `${goal.active_waves} wave${goal.active_waves === 1 ? "" : "s"} active • ${goal.completed_issues}/${goal.total_issues || 0} issues`,
      progress_label: `${goal.completed_issues}/${goal.total_issues || 0}`,
      updated_at: goal.latest_update,
      updated_age: formatAge(nowMs, goal.latest_update),
      badges: [
        ...[...goal.stages].filter(Boolean).sort((a, b) => stableCompare(a, b)),
        `path:${resolveGoalExecutionPathBadge(goal.goal_execution_path || "unknown", goal.goal_execution_mode || "", goal.is_direct_goal_execution === true, goal.provisional_hard === true)}`,
        goal.planning_state ? `planning:${goal.planning_state}` : "",
        goal.planning_review_required === true ? "planning_review_required" : "",
      ].filter(Boolean),
      refs: {
        goal_number: goal.goal_number,
        waves: goal.wave_titles,
        goal_execution_path: goal.goal_execution_path || "unknown",
        goal_execution_mode: goal.goal_execution_mode || "",
        is_direct_goal_execution: goal.is_direct_goal_execution === true,
        provisional_hard: goal.provisional_hard === true,
        provisional: goal.provisional_hard === true,
        planning_state: goal.planning_state || "",
        planning_review_required: goal.planning_review_required === true,
      },
      detail: normalizeDetail([
        `Execution path: ${resolveGoalExecutionPathBadge(goal.goal_execution_path || "unknown", goal.goal_execution_mode || "", goal.is_direct_goal_execution === true, goal.provisional_hard === true)}`,
        goal.provisional_hard === true ? "Provisional hard path: true" : "",
        goal.planning_state ? `Planning state: ${goal.planning_state}` : "",
        goal.planning_review_required === true ? "Planning review required: true" : "",
        `Active waves: ${goal.wave_titles.join(", ") || "none"}`,
        `Active stages: ${[...goal.stages].filter(Boolean).join(", ") || "none"}`,
      ]),
    }, {
      graph: "goal_execute.dot",
      issue_number: goal.goal_number,
    }));
}

function buildWaveRows({ summary = {}, nowMs = Date.now() } = {}) {
  return (Array.isArray(summary.waves) ? summary.waves : [])
    .map((wave) => {
      const liveAttachable = wave.live_attachable === true;
      const goalExecutionPath = trim(wave.goal_execution_path || "") || "unknown";
      const goalExecutionMode = trim(wave.goal_execution_mode || "");
      const isDirectGoalExecution = wave.is_direct_goal_execution === true;
      const provisionalHard = isProvisionalHardExecutionPath({
        path: goalExecutionPath,
        provisional: wave.provisional_hard === true || wave.provisional === true,
        routingState: wave.goal_routing_state,
      });
      const goalExecutionPathLabel = resolveGoalExecutionPathBadge(goalExecutionPath, goalExecutionMode, isDirectGoalExecution, provisionalHard);
      const planningState = trim(wave.planning_state || wave.goal_routing_state?.planning_state || "").toLowerCase();
      const planningReviewRequired = planningState === "pending_review";
      const refs = buildLiveAttachRefs({
        refs: {
          wave_run_id: trim(wave.wave_run_id || ""),
          current_issue_number: toNumber(wave.current_issue_number, 0),
          milestone_title: trim(wave.milestone_title || ""),
          trace_run_id: trim(wave.trace_run_id || ""),
          goal_execution_path: goalExecutionPath,
          goal_execution_mode: goalExecutionMode,
          is_direct_goal_execution: isDirectGoalExecution,
          provisional_hard: provisionalHard,
          provisional: provisionalHard,
          planning_state: planningState,
          planning_review_required: planningReviewRequired,
        },
        liveAttachable,
        liveAttachTarget: wave.live_attach_target,
      });

      return withRunIdentity({
        id: `wave:${trim(wave.wave_run_id || wave.milestone_title || "")}`,
        kind: "wave",
        issue: wave.wave_issue_number ? `#${wave.wave_issue_number}` : "",
        title: withLivePrefix(trim(wave.milestone_title || "(no wave)"), liveAttachable),
        status: wave.stalled ? "stalled" : "running",
        summary: `${wave.current_issue_number ? `#${wave.current_issue_number}` : "no-issue"} • ${trim(wave.current_issue_node || "unknown")} • path=${goalExecutionPathLabel}`,
        progress_label: `${toNumber(wave.completed_issues, 0)}/${toNumber(wave.total_issues, 0)}`,
        updated_at: trim(wave.last_progress_at || ""),
        updated_age: formatAge(nowMs, wave.last_progress_at || ""),
        badges: [
          trim(wave.current_issue_node || ""),
          `path:${goalExecutionPathLabel}`,
          planningState ? `planning:${planningState}` : "",
          planningReviewRequired ? "planning_review_required" : "",
          wave.stalled ? "stalled" : "",
          wave.trace_kind ? `trace:${wave.trace_kind}` : "",
          liveAttachable ? "live" : "",
        ].filter(Boolean),
        refs,
        detail: normalizeDetail([
          `Current issue: ${wave.current_issue_number ? `#${wave.current_issue_number}` : "none"}`,
          `Execution path: ${goalExecutionPathLabel}`,
          provisionalHard ? "Provisional hard path: true" : "",
          planningState ? `Planning state: ${planningState}` : "",
          planningReviewRequired ? "Planning review required: true" : "",
          `Expected next outcome: ${trim(wave.expected_next_outcome || "run state update")}`,
          wave.trace_command ? `Trace: ${wave.trace_command}` : "",
        ]),
      }, {
        run_id: trim(wave.wave_run_id || ""),
        graph: "wave_execute.dot",
        node: trim(wave.current_issue_node || ""),
        issue_number: toNumber(wave.current_issue_number, 0),
      });
    })
    .sort((left, right) => stableCompare(left.title, right.title));
}

function buildGoalRunRows({ summary = {}, nowMs = Date.now(), goalTitles = {}, goalProgress = {} } = {}) {
  return buildGroupedGoalRuns(summary, isGoalRunFamily)
    .map((runs) => {
      const run = runs[0] || {};
      const goalNumber = resolveGoalRunIssueNumber(run);
      const graphLabel = compactGraphLabel(run.graph || run.graph_label) || "goal_execute.dot";
      const stepLabel = trim(run.node || run.current_node || "");
      const progressLabel = resolveGoalRunProgressLabel({
        goalNumber,
        progress: goalProgress[goalNumber],
      }) || stepLabel;
      const currentIssueNumber = toNumber(goalProgress?.[goalNumber]?.currentIssueNumber, 0)
        || toNumber(run.current_issue_number, 0);
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
      const resolvedTitle = trim(goalTitles[goalNumber] || "") || (goalNumber > 0 ? `Goal #${goalNumber}` : graphLabel);
      const activeHandoffLines = runs.map((entry) => {
        const entryGraph = compactGraphLabel(entry.graph || entry.graph_label) || "goal_execute.dot";
        const entryNode = trim(entry.node || entry.current_node || "unknown");
        const entryAge = trim(entry.age || formatAge(nowMs, entry.last_progress_at || ""));
        return `${entryGraph}:${entryNode}${entryAge ? ` ${entryAge}` : ""}`.trim();
      });
      const primaryExpectedOutcome = trim(run.expected_next_outcome || "run state update");
      return withRunIdentity({
        id: `goal-run:${trim(run.run_id || "")}`,
        kind: "goal_run",
        issue: goalNumber > 0 ? `#${goalNumber}` : "",
        title: withLivePrefix(resolvedTitle, liveAttachable),
        status: "running",
        summary: `${currentIssueNumber > 0 ? `#${currentIssueNumber} • ` : ""}${trim(run.node || "unknown")} • handoffs=${runs.length} • path=${goalExecutionPathLabel} • ${primaryExpectedOutcome}`,
        progress_label: progressLabel,
        updated_at: trim(run.last_progress_at || ""),
        updated_age: progressAge || trim(run.age || ""),
        badges: [
          trim(run.node || ""),
          runs.length > 1 ? `handoffs:${runs.length}` : "",
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
          currentIssueNumber > 0 ? `Current issue: #${currentIssueNumber}` : "",
          `Execution path: ${goalExecutionPathLabel}`,
          `Active handoffs: ${runs.length}`,
          provisionalHard ? "Provisional hard path: true" : "",
          planningState ? `Planning state: ${planningState}` : "",
          planningReviewRequired ? "Planning review required: true" : "",
          run.no_git_delta_since_start === true ? "Git progress: none since current issue started" : "",
          run.worktree_clean === true ? "Worktree: clean" : "",
          run.worktree_clean === false ? "Worktree: dirty" : "",
          Number.isFinite(Number(run.commits_ahead)) ? `Branch ahead: ${Number(run.commits_ahead)}` : "",
          Number.isFinite(Number(run.issue_commits_since_snapshot)) || Array.isArray(run.issue_changed_files)
            ? `Issue-scoped delta since snapshot: ${Number(run.issue_commits_since_snapshot || 0)} commits, ${Array.isArray(run.issue_changed_files) ? run.issue_changed_files.length : 0} files`
            : "",
          run.trace_command ? `Trace: ${run.trace_command}` : "",
          progressLabel && progressLabel !== stepLabel ? `Goal progress: ${progressLabel}` : "",
          trim(run.age ? `Run age: ${run.age}` : ""),
          trim(progressAge ? `Last progress: ${progressAge} ago` : ""),
          ...activeHandoffLines,
        ]),
      }, {
        run_id: trim(run.run_id || ""),
        graph: graphLabel,
        node: stepLabel,
        issue_number: goalNumber,
      });
    })
    .sort((left, right) => stableCompare(left.issue, right.issue) || stableCompare(left.id, right.id));
}

function buildBlockerRows({ status = {}, nowMs = Date.now() } = {}) {
  return (Array.isArray(status.blocked_control_plane) ? status.blocked_control_plane : [])
    .map((item, index) => ({
      id: `blocker:${trim(item.milestone || "")}:${toNumber(item.issue_number, index)}`,
      kind: "blocker",
      issue: item.issue_number ? `#${item.issue_number}` : "",
      title: trim(item.milestone || "(blocked work)"),
      status: "blocked",
      summary: `${trim(item.blockerKind || "upstream_bug")} ${trim(item.blockerRef || "").trim() || "(unspecified)"}`.trim(),
      progress_label: "",
      updated_at: "",
      updated_age: "",
      badges: [trim(item.blockerKind || "upstream_bug")].filter(Boolean),
      refs: {
        issue_number: toNumber(item.issue_number, 0),
        linked_goal_number: toNumber(item.linked_goal_number, 0),
      },
      detail: normalizeDetail([
        item.issue_number ? `Issue: #${item.issue_number}` : "",
        trim(item.unblockCondition || "Wait for control-plane blocker status to change."),
      ]),
    }));
}

function buildPacketRows({ status = {}, nowMs = Date.now() } = {}) {
  return (Array.isArray(status.open_packets) ? status.open_packets : [])
    .map((packet) => ({
      id: `packet:${trim(packet.packet_id || packet.packet_path || "")}`,
      kind: "packet",
      issue: "",
      title: trim(packet.title || packet.packet_type || "packet"),
      status: trim(packet.packet_state || "open"),
      summary: `${trim(packet.packet_type || "packet")} • run=${trim(packet.run_id || "")}`.trim(),
      progress_label: "",
      updated_at: "",
      updated_age: "",
      badges: [trim(packet.packet_type || ""), trim(packet.pipeline || "")].filter(Boolean),
      refs: {
        packet_id: trim(packet.packet_id || ""),
        packet_path: trim(packet.packet_path || ""),
        run_id: trim(packet.run_id || ""),
      },
      detail: normalizeDetail([
        trim(packet.packet_path || ""),
        trim(packet.pipeline ? `Pipeline: ${packet.pipeline}` : ""),
      ]),
    }));
}

function buildSupervisorRow({ status = {}, tick = {}, summary = {}, nowMs = Date.now() } = {}) {
  const hasActiveRuns = Array.isArray(status.active) ? status.active.length > 0 : false;
  const currentTick = hasActiveRuns && Array.isArray(tick.ticks)
    ? tick.ticks.find((entry) => String(entry?.status || "").trim() === "running")
    : null;
  const supervisorRun = (Array.isArray(status.active) ? status.active : [])
    .find((row) => isSupervisorGraph(row.graph));
  const supervisorSummary = (Array.isArray(summary.non_wave_active) ? summary.non_wave_active : [])
    .find((row) => isSupervisorGraph(row.graph || row.graph_label));
  if (!currentTick && !supervisorRun && !supervisorSummary) return [];
  const liveAttachable = supervisorSummary?.live_attachable === true;
  const bugGate = resolveBugGateSummary({ status, tick, summary });
  const children = currentTick
    ? (Array.isArray(currentTick.children) ? currentTick.children : [])
    : (Array.isArray(supervisorRun?.children) ? supervisorRun.children : []);
  const childSummaries = children.slice(0, 3).map((child) => {
    const runId = trim(child?.runId || "").slice(0, 8) || "(unknown)";
    const node = trim(child?.node || child?.current_node || "unknown");
    const issue = trim(child?.issue || "");
    return `${runId}:${node}${issue ? ` #${issue}` : ""}`;
  });
  const extraChildren = Math.max(0, children.length - childSummaries.length);
  const detail = [
    trim(currentTick?.stageLabel || currentTick?.stage || supervisorRun?.node || supervisorSummary?.node || ""),
    trim(currentTick?.progress || ""),
  ];
  if (children.length > 0) {
    detail.push(`Active children: ${children.length}`);
    for (const child of childSummaries) detail.push(child);
    if (extraChildren > 0) detail.push(`... and ${extraChildren} more`);
  }
  if (bugGate.active) {
    detail.push("Mode: bug-fast");
    detail.push("Admission: paused_for_bug_review");
    if (bugGate.open_bug_refs.length > 0) {
      detail.push(`Open bug refs: ${bugGate.open_bug_refs.join(", ")}`);
    }
    for (const blocker of bugGate.blockers) {
      if (!blocker.blockerKind && !blocker.blockerRef && !blocker.unblockCondition) continue;
      detail.push(
        [
          "Blocker:",
          blocker.blockerKind || "upstream_bug",
          blocker.blockerRef || "",
          blocker.unblockCondition ? `until ${blocker.unblockCondition}` : "",
        ].filter(Boolean).join(" "),
      );
    }
  }

  const refs = buildLiveAttachRefs({
    refs: {
      tick_run_id: trim(currentTick?.runId || currentTick?.id || supervisorRun?.run_id || supervisorRun?.id || ""),
    },
    liveAttachable,
    liveAttachTarget: supervisorSummary?.live_attach_target || null,
  });

  return [withRunIdentity({
    id: `supervisor:${trim(currentTick?.runId || currentTick?.id || supervisorRun?.run_id || supervisorRun?.id || "active")}`,
    kind: "supervisor",
    issue: "",
    title: withLivePrefix("Supervisor", liveAttachable),
    status: "running",
    summary: bugGate.active
      ? `bug-fast • ${bugGate.open_bug_refs.length > 0 ? bugGate.open_bug_refs.join(", ") : "open bug review"} • admission paused`
      : children.length > 0
      ? `${trim(currentTick?.stageLabel || currentTick?.stage || supervisorRun?.node || "unknown")} • ${childSummaries.join(" • ")}${extraChildren > 0 ? ` • +${extraChildren} more` : ""}`
      : trim(currentTick?.stageLabel || currentTick?.stage || supervisorRun?.node || supervisorSummary?.node || "unknown"),
    progress_label: trim(currentTick?.progress || ""),
    updated_at: trim(currentTick?.startedAt || supervisorRun?.updated_at || supervisorSummary?.last_progress_at || ""),
    updated_age: formatAge(nowMs, currentTick?.startedAt || supervisorRun?.updated_at || supervisorSummary?.last_progress_at || ""),
    badges: [bugGate.active ? "bug-fast" : "", trim(currentTick?.stage || supervisorRun?.node || ""), trim(currentTick?.status || supervisorRun?.status || "running"), liveAttachable ? "live" : ""].filter(Boolean),
    refs,
    detail: normalizeDetail(detail),
  }, {
    run_id: trim(currentTick?.runId || currentTick?.id || supervisorRun?.run_id || supervisorRun?.id || ""),
    graph: trim(supervisorRun?.graph || supervisorSummary?.graph || "factory_supervisor_tick.dot"),
    node: trim(currentTick?.stage || currentTick?.stageLabel || supervisorRun?.node || supervisorSummary?.node || ""),
  })];
}

function buildNowRows({ status = {}, summary = {}, tick = {}, runsDir = "", nowMs = Date.now(), goalTitles = {}, goalProgress = {}, readAllRunStatesFn = readAllRunStates } = {}) {
  const activeRows = [
    ...buildSupervisorRow({ status, tick, summary, nowMs }),
    ...buildGoalRunRows({ summary, nowMs, goalTitles, goalProgress }),
    ...buildGoalIssueRows({
      summary,
      nowMs,
      helpers: {
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
      },
    }),
    ...buildGoalRows({ summary, nowMs, goalTitles }),
    ...buildWaveRows({ summary, nowMs }),
    ...buildBlockerRows({ status, nowMs }),
  ];
  const hasInteractiveRows = activeRows.some((row) => ["goal_run", "goal_issue", "goal", "wave"].includes(trim(row.kind || "")));
  if (hasInteractiveRows || activeRows.length > 1) return activeRows;
  const recentHandoffRows = buildRecentHandoffRows({
    runsDir,
    nowMs,
    goalTitles,
    readAllRunStatesFn,
    formatAge,
    normalizeDetail,
  });
  if (recentHandoffRows.length === 0) return activeRows;
  return [...activeRows, ...recentHandoffRows];
}

function buildPacketsTab({ status = {}, nowMs = Date.now() } = {}) {
  const rows = buildPacketRows({ status, nowMs });
  if (rows.length === 0) return null;
  // @context:decision !critical Open packets are durable remediation residue, not primary live work.
  // Keep them reachable in the dashboard, but isolate them behind a dedicated tab so the default
  // operator view stays anchored on active execution state instead of historical packet backlog.
  return {
    id: "packets",
    title: "Packets",
    rows,
    empty_message: "No open packets.",
  };
}

async function maybeLoadExtensionModule({ context = {}, config = {} } = {}) {
  const moduleHint = trim(config?.dashboard?.extension_module || config?.dashboard_extension_module || "");
  const candidatePaths = [];
  if (moduleHint) {
    candidatePaths.push(moduleHint);
    const configPath = trim(context.factory_config_path || "");
    if (configPath) candidatePaths.push(join(dirname(configPath), moduleHint));
    if (trim(context.factory_root)) candidatePaths.push(join(context.factory_root, moduleHint));
  }
  if (trim(context.factory_root)) candidatePaths.push(join(context.factory_root, "dashboard.extension.mjs"));
  for (const candidate of candidatePaths) {
    const absPath = resolve(candidate);
    if (!existsSync(absPath)) continue;
    const mod = await import(pathToFileURL(absPath).href);
    if (mod && typeof mod.buildFactoryDashboardExtension === "function") {
      return { module: mod, path: absPath };
    }
  }
  return { module: null, path: "" };
}

function readFactoryDashboardConfig(context = {}) {
  const inlineConfig = context?.factory_config;
  if (inlineConfig && typeof inlineConfig === "object") return inlineConfig;
  const configPath = trim(context?.factory_config_path || "");
  if (!configPath || !existsSync(configPath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeTabs({ nowRows = [], recentRows = [], extensionTabs = [], packetTab = null } = {}) {
  const tabs = [
    {
      id: "now",
      title: "Now",
      rows: nowRows,
      empty_message: "No active work or recent handoffs.",
    },
    {
      id: "recent",
      title: "Recent",
      rows: recentRows,
      empty_message: "No recent outcomes.",
    },
    packetTab,
    ...extensionTabs,
  ];
  return tabs.filter(Boolean).map((tab) => ({
    id: trim(tab.id),
    title: trim(tab.title || tab.id),
    rows: (Array.isArray(tab.rows) ? tab.rows : []).map((row) => withRunIdentity(row, row?.runIdentity || null)),
    empty_message: trim(tab.empty_message || "No rows."),
  })).filter((tab) => tab.id && tab.title);
}

function truncate(value = "", width = 0) {
  const text = String(value ?? "");
  if (!width || text.length <= width) return text.padEnd(width, " ");
  if (width <= 1) return text.slice(0, width);
  return `${text.slice(0, width - 1)}…`;
}

function repeat(char, width) {
  return String(char || "").repeat(Math.max(0, width));
}

function formatTabLabel(tab = {}, index = 0, selected = false) {
  const prefix = selected ? ">" : " ";
  const title = trim(tab.title || tab.id || `Tab ${index + 1}`);
  return `${prefix}${index + 1}:${title}${selected ? "<" : ""}`;
}

function buildDetailLines(selectedRow = null) {
  if (!selectedRow) {
    return [
      "Selection",
      "  No row selected.",
    ];
  }
  const runIdentity = normalizeRunIdentity(selectedRow.runIdentity || null);
  const runIdentityLines = runIdentity
    ? [
      `  runIdentity.run_id: ${trim(runIdentity.run_id || "") || "n/a"}`,
      `  runIdentity.graph: ${trim(runIdentity.graph || "") || "n/a"}`,
      `  runIdentity.node: ${trim(runIdentity.node || "") || "n/a"}`,
      runIdentity.issue_number ? `  runIdentity.issue_number: ${runIdentity.issue_number}` : "",
    ].filter(Boolean)
    : [];

  const refs = selectedRow.refs && typeof selectedRow.refs === "object"
    ? Object.entries(selectedRow.refs)
        .filter(([key, value]) => {
          if (key === "live_attach_target") return false;
          return trim(value) || Number.isFinite(value);
        })
        .map(([key, value]) => `  ${key}: ${value}`)
    : [];

  const liveAttachRefs = selectedRow.refs && typeof selectedRow.refs === "object"
    ? selectedRow.refs.live_attach_target
    : null;
  const liveAttachLines = liveAttachRefs && typeof liveAttachRefs === "object"
    ? [
      "  live_attach_target:",
      ...Object.entries(liveAttachRefs)
        .filter(([, value]) => trim(value) || Number.isFinite(value))
        .map(([key, value]) => `    ${key}: ${value}`),
    ]
    : [];

  return [
    "Selection",
    `  ${selectedRow.issue ? `${selectedRow.issue}  ` : ""}${selectedRow.title}  [${selectedRow.kind}]`,
    `  status: ${selectedRow.status}${selectedRow.progress_label ? `  progress: ${selectedRow.progress_label}` : ""}${selectedRow.updated_age ? `  age: ${selectedRow.updated_age}` : ""}`,
    ...(selectedRow.summary ? [`  summary: ${selectedRow.summary}`] : []),
    ...(Array.isArray(selectedRow.badges) && selectedRow.badges.length > 0 ? [`  badges: ${selectedRow.badges.join(", ")}`] : []),
    ...runIdentityLines,
    ...refs,
    ...liveAttachLines,
    ...normalizeDetail(selectedRow.detail || []).map((line) => `  ${line}`),
  ];
}

export function validateFactoryDashboard(dashboard = {}) {
  const parsed = dashboardSchema.safeParse(dashboard);
  if (parsed.success) return [];
  return parsed.error.issues.map((issue) => issue.message);
}

function assertValidExtensionTabs(extensionTabs = []) {
  const parsed = z.array(dashboardTabSchema).safeParse(extensionTabs);
  if (parsed.success) return parsed.data;
  throw new Error(`invalid_factory_dashboard:${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
}

function assertValidFactoryDashboard(dashboard = {}) {
  const parsed = dashboardSchema.safeParse(dashboard);
  if (parsed.success) return parsed.data;
  // @context:decision !critical The dashboard builder is the ownership seam
  // for TUI detail payload shape. Extensions and future refactors must fail
  // closed here instead of leaking malformed rows/tabs into Ink state.
  throw new Error(`invalid_factory_dashboard:${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
}

export async function buildFactoryDashboard({
  runsDir = ".hatch/runs",
  context = {},
  lookbackHours = 24,
  nowMs = Date.now(),
  factoryStatusFn = factoryStatus,
  factoryActiveSummaryFn = factoryActiveSummary,
  tickStatusFn = tickStatus,
  collectFactoryOutcomesFn = collectFactoryOutcomes,
  fetchGoalTitlesFn = fetchGoalTitles,
  listGoalSubIssuesFn = listGoalSubIssues,
  readAllRunStatesFn = readAllRunStates,
  scheduledJobsStatePath = "",
  factoryConfig = null,
  filters = {},
} = {}) {
  const status = factoryStatusFn({ runsDir, context });
  const activeSummary = factoryActiveSummaryFn({ runsDir, context, now: nowMs });
  const tick = tickStatusFn({ runsDir, context });
  const repo = trim(context.target_repo || context.gh_repo || "");
  const repoPath = trim(context.repo || process.cwd());
  const outcomes = repo
    ? collectFactoryOutcomesFn({ repo, repoPath, lookbackHours, nowMs })
    : { commits: [], closed_goals: 0, closed_features: 0, closed_bugs: 0, merge_commits_main: 0 };
  const recentSummary = summarizeRecent(outcomes);

  const goalNumbers = new Set();
  for (const wave of Array.isArray(activeSummary.waves) ? activeSummary.waves : []) {
    const num = parseGoalNumber(wave.milestone_title);
    if (num) goalNumbers.add(num);
  }
  for (const run of Array.isArray(activeSummary.non_wave_active) ? activeSummary.non_wave_active : []) {
    if (!isGoalRunFamily(run)) continue;
    const num = toNumber(run.issue_number, 0);
    if (num > 0) goalNumbers.add(num);
  }
  const goalTitles = fetchGoalTitlesFn([...goalNumbers], { repo });
  const goalProgress = fetchGoalProgress([...goalNumbers], {
    repo,
    summary: activeSummary,
    listGoalSubIssuesFn,
  });

  const nowRows = buildNowRows({
    status,
    summary: activeSummary,
    tick,
    runsDir,
    nowMs,
    goalTitles,
    goalProgress,
    readAllRunStatesFn,
  });
  const recentRows = buildRecentRows({ outcomes, nowMs, formatAge });
  const packetTab = buildPacketsTab({ status, nowMs });
  const normalizedFilters = normalizeDashboardFilters(filters);

  const extensionLoad = await maybeLoadExtensionModule({
    context,
    config: readFactoryDashboardConfig(context),
  });
  let extensionTabs = [];
  if (extensionLoad.module) {
    const built = await extensionLoad.module.buildFactoryDashboardExtension({
      context,
      dashboard: {
        schema_version: FACTORY_DASHBOARD_SCHEMA_VERSION,
        context,
        summary: {},
        tabs: [],
      },
      status,
      active_summary: activeSummary,
      tick_status: tick,
      outcomes,
      now_ms: nowMs,
    });
    extensionTabs = assertValidExtensionTabs(Array.isArray(built?.tabs) ? built.tabs : []);
  }

  const scheduledJobsLine = buildScheduledJobsSummary({
    config: factoryConfig || context.config || {},
    scheduledJobsStatePath,
    nowMs,
  });

  const tabs = normalizeTabs({ nowRows, recentRows, packetTab, extensionTabs });
  const filteredTabs = applyDashboardFiltersToTabs(tabs, normalizedFilters);
  const dashboard = {
    schema_version: FACTORY_DASHBOARD_SCHEMA_VERSION,
    context: {
      ...(context && typeof context === "object" ? context : {}),
      dashboard_filters: normalizedFilters,
    },
    generated_at: new Date(nowMs).toISOString(),
    summary: {
      ...buildSummary({
        status,
        summary: { ...activeSummary, recent: recentSummary },
        tick,
        nowMs,
        lookbackHours,
      }),
      scheduled_jobs_line: scheduledJobsLine,
      filters: normalizedFilters,
    },
    tabs: filteredTabs,
    extension: extensionLoad.path ? { module_path: extensionLoad.path } : null,
  };
  return assertValidFactoryDashboard(dashboard);
}

function computeColumnWidths(totalWidth = 120) {
  const fixed = { marker: 2, kind: 10, issue: 6, status: 9, progress: 5, age: 6 };
  const separators = 7; // 7 spaces between 8 columns
  const fixedTotal = fixed.marker + fixed.kind + fixed.issue + fixed.status + fixed.progress + fixed.age + separators;
  const remaining = Math.max(4, totalWidth - fixedTotal);
  const titleShare = totalWidth < 80 ? 0.4 : 0.45;
  const titleWidth = Math.max(6, Math.floor(remaining * titleShare));
  const summaryWidth = Math.max(4, remaining - titleWidth);
  return { ...fixed, title: titleWidth, summary: summaryWidth };
}

function renderTable(rows = [], selectedId = "", totalWidth = 120) {
  const columns = computeColumnWidths(totalWidth);
  const divider = [
    repeat("-", columns.marker),
    repeat("-", columns.kind),
    repeat("-", columns.issue),
    repeat("-", columns.title),
    repeat("-", columns.status),
    repeat("-", columns.progress),
    repeat("-", columns.age),
    repeat("-", columns.summary),
  ].join(" ");
  const lines = [
    `${truncate("#", columns.marker)} ${truncate("KIND", columns.kind)} ${truncate("ISSUE", columns.issue)} ${truncate("TITLE", columns.title)} ${truncate("STATUS", columns.status)} ${truncate("STEP", columns.progress)} ${truncate("AGE", columns.age)} ${truncate("SUMMARY", columns.summary)}`,
    divider,
  ];
  rows.forEach((row, index) => {
    const selected = selectedId && row.id === selectedId;
    const marker = selected ? "->" : `${index + 1}.`;
    lines.push(
      `${truncate(marker, columns.marker)} ${truncate(row.kind || "", columns.kind)} ${truncate(row.issue || "", columns.issue)} ${truncate(row.title || "", columns.title)} ${truncate(row.status || "", columns.status)} ${truncate(row.progress_label || "", columns.progress)} ${truncate(row.updated_age || "", columns.age)} ${truncate(row.summary || "", columns.summary)}`,
    );
  });
  return lines;
}

export function formatFactoryDashboardHuman(dashboard = {}, { activeTab = "now", selectedRowId = "", terminalColumns = 0, terminalRows = 0, initialFilters = null } = {}) {
  const width = terminalColumns > 0 ? terminalColumns : 120;
  const tabs = Array.isArray(dashboard.tabs) ? dashboard.tabs : [];
  const tab = tabs.find((entry) => entry.id === activeTab) || tabs[0] || { id: "now", title: "Now", rows: [], empty_message: "No rows." };
  const summary = dashboard.summary || {};
  const selectedRow = (Array.isArray(tab.rows) ? tab.rows : []).find((row) => row.id === selectedRowId) || (Array.isArray(tab.rows) ? tab.rows[0] : null);
  const currentTick = summary.current_tick || null;
  const tabLine = tabs.length > 0
    ? tabs.map((entry, index) => formatTabLabel(entry, index, entry.id === tab.id)).join("  ")
    : ">1:Now<";
  const awaitingHardPlanReview = toNumber(summary.awaiting_hard_plan_review_count, 0);
  const awaitingHardPlanGoals = Array.isArray(summary.awaiting_hard_plan_review_goal_numbers)
    ? summary.awaiting_hard_plan_review_goal_numbers
    : [];
  const materializedHardPlanGoals = toNumber(summary.hard_plan_materialized_goal_count, 0);
  const displayFilters = normalizeDashboardFilters(summary.filters || initialFilters || {});
  const filterSummary = [
    displayFilters.run_id ? `run=${displayFilters.run_id}` : "",
    displayFilters.graph ? `graph=${displayFilters.graph}` : "",
    displayFilters.node ? `node=${displayFilters.node}` : "",
    Number.isFinite(displayFilters.issue) ? `issue=#${displayFilters.issue}` : "",
  ].filter(Boolean).join("  ");

  const header = [
    truncate(`FACTORY DASHBOARD  ${trim(dashboard.context?.factory_id || "unknown")}  ${trim(dashboard.context?.target_repo || "unknown")}`, width),
    repeat("=", width),
    truncate(
      toNumber(summary.active_goals, 0) > 0 || toNumber(summary.active_goal_issues, 0) > 0
        ? `Health=${trim(summary.health || "unknown")}  State=${trim(summary.state_action || "none")}  Runs=${toNumber(summary.active_runs, 0)}  Goals=${toNumber(summary.active_goals, 0)}  Issues=${toNumber(summary.active_goal_issues, 0)}  AwaitingHardPlanReview=${toNumber(summary.awaiting_hard_plan_review_count, 0)}  MaterializedHardPlans=${materializedHardPlanGoals}  Blocked=${toNumber(summary.blocked, 0)}  Packets=${toNumber(summary.open_packets, 0)}`
        : `Health=${trim(summary.health || "unknown")}  State=${trim(summary.state_action || "none")}  Runs=${toNumber(summary.active_runs, 0)}  Waves=${toNumber(summary.active_waves, 0)}  AwaitingHardPlanReview=${toNumber(summary.awaiting_hard_plan_review_count, 0)}  MaterializedHardPlans=${materializedHardPlanGoals}  Blocked=${toNumber(summary.blocked, 0)}  Packets=${toNumber(summary.open_packets, 0)}`,
      width,
    ),
    ...(summary.bug_gate?.active === true
      ? [truncate(`Mode=bug-fast  OpenBugs=${toNumber(summary.bug_gate?.open_bug_count, 0)}  Refs=${(Array.isArray(summary.bug_gate?.open_bug_refs) ? summary.bug_gate.open_bug_refs.join(",") : "") || "n/a"}  Admission=${trim(summary.bug_gate?.admission || "paused_for_bug_review")}`, width)]
      : []),
    truncate(`Recent(${toNumber(summary.lookback_hours, 24)}h)  merges=${toNumber(summary.recent_outcomes?.merged, 0)}  goals=${toNumber(summary.recent_outcomes?.goals, 0)}  issues=${toNumber(summary.recent_outcomes?.issues, 0)}  commits=${toNumber(summary.recent_outcomes?.commits, 0)}`, width),
    truncate(awaitingHardPlanReview > 0
      ? `Awaiting hard-plan review: ${awaitingHardPlanReview} goal(s) ${awaitingHardPlanGoals.length > 0 ? `#${awaitingHardPlanGoals.join(", #")}` : ""}`
      : "Awaiting hard-plan review: 0",
    width),
    truncate(`Materialized hard plans: ${materializedHardPlanGoals}`, width),
    ...(trim(summary.hard_plan_reuse_summary) ? [truncate(summary.hard_plan_reuse_summary, width)] : []),
    truncate(currentTick
      ? `Tick=${trim(currentTick.run_id || "")}  Stage=${trim(currentTick.stage || "unknown")}  Progress=${trim(currentTick.progress || "")}  Age=${trim(currentTick.age || "")}`
      : "Tick=idle", width),
    ...(trim(summary.scheduled_jobs_line) ? [truncate(summary.scheduled_jobs_line, width)] : []),
    truncate(filterSummary ? `Filters  ${filterSummary}` : "Filters  (none)", width),
    truncate(`Tabs  ${tabLine}`, width),
    repeat("-", width),
    `${tab.title}  (${Array.isArray(tab.rows) ? tab.rows.length : 0} rows)`,
    "",
  ];
  const body = Array.isArray(tab.rows) && tab.rows.length > 0
    ? renderTable(tab.rows, selectedRow?.id || "", width)
    : [trim(tab.empty_message || "No rows.")];
  const detail = ["", ...buildDetailLines(selectedRow), "", "Keys  tab/l/h switch tabs  j/k move  i inspect (session browser)  r refresh  q quit"];
  const allLines = [...header, ...body, ...detail];
  if (terminalRows > 0 && allLines.length > terminalRows - 1) {
    return allLines.slice(0, terminalRows - 1).join("\n");
  }
  return allLines.join("\n");
}
