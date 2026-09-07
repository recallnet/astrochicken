import { listGoalHardStates } from "./goal-hard-state.ts";
import {
  factoryActiveSummary as readCanonicalFactoryActiveSummary,
  formatFactoryActiveMinimal,
  formatFactoryActiveSummary,
} from "../lib/factory-active-summary.ts";
import {
  formatFactoryStatus,
  factoryStatus as readCanonicalFactoryStatus,
} from "../lib/factory-status-canonical.ts";
import {
  ACTIVE_SUMMARY_STALLED_THRESHOLD_MS,
  describeOperatorSignals,
  duration,
  expectedNextOutcomeForNode,
  mtime,
  readAllRunStates as readAllRunStatesFromSupport,
  readState as readStateFromSupport,
  resolveGraph,
  resolveIssue,
  resolveMilestone,
} from "../lib/factory-status-support.ts";
import {
  getLatestGoalHardPlanMaterializationPacket,
} from "../lib/goal-hard-plan-materialization-packet.ts";
import {
  PROJECTION_DIMENSIONS,
  ensureProjectionDimensions,
} from "../lib/insight-contract.ts";

const RUN_DIR_RE = /[/\\][^/\\]+$/;

function emptyHardPlanTraceability() {
  return {
    goals_with_materialized_hard_plans: 0,
    goals: [],
  };
}

function buildHardPlanTraceability({
  repoRoot = ".",
  factoryId = "mothership",
  hardGoalReview = {},
} = {}) {
  const goalNumbers = new Set([
    ...(Array.isArray(hardGoalReview.awaiting_post_plan_review_goal_numbers)
      ? hardGoalReview.awaiting_post_plan_review_goal_numbers
      : []),
    ...(Array.isArray(hardGoalReview.approved_plan_resume_goal_numbers)
      ? hardGoalReview.approved_plan_resume_goal_numbers
      : []),
    ...(Array.isArray(hardGoalReview.hard_goals)
      ? hardGoalReview.hard_goals.map((entry) => Number(entry?.goal_number || 0))
      : []),
  ]
    .map((entry) => Number.parseInt(String(entry || "").trim(), 10))
    .filter((entry) => Number.isFinite(entry) && entry > 0));

  if (goalNumbers.size === 0) return emptyHardPlanTraceability();

  const rows = [];
  for (const goalNumber of [...goalNumbers].sort((left, right) => left - right)) {
    const packet = getLatestGoalHardPlanMaterializationPacket({
      repo: repoRoot,
      factoryId,
      goalIssueNumber: String(goalNumber),
    });
    if (!packet?.packet) continue;
    const payload = packet.packet;
    rows.push({
      goal_issue_number: goalNumber,
      plan_packet_id: String(payload.plan_packet_id || "").trim(),
      decomposition_packet_id: String(payload.decomposition_packet_id || "").trim(),
      decomposition_packet_path: String(payload.decomposition_packet_path || "").trim(),
      materialization_packet_id: String(payload.packet_id || "").trim(),
      materialization_packet_path: String(packet.packet_path || "").trim(),
      created_issue_numbers: Array.isArray(payload.created_issue_numbers)
        ? payload.created_issue_numbers
          .map((entry) => Number.parseInt(String(entry || "").trim(), 10))
          .filter((entry) => Number.isFinite(entry) && entry > 0)
          .sort((left, right) => left - right)
        : [],
      // Canonical prerequisite → final reuse wiring from hard-plan materialization packets.
      // Keep these fields additive with stable defaults so status/dashboard JSON consumers
      // can rely on the same shape even when older packets omit provenance details.
      goal_issue_map: payload.goal_issue_map && typeof payload.goal_issue_map === "object" && !Array.isArray(payload.goal_issue_map)
        ? payload.goal_issue_map
        : {},
      issue_set_map: payload.issue_set_map && typeof payload.issue_set_map === "object" && !Array.isArray(payload.issue_set_map)
        ? payload.issue_set_map
        : {},
      goal_feature_issue_map: payload.goal_feature_issue_map && typeof payload.goal_feature_issue_map === "object" && !Array.isArray(payload.goal_feature_issue_map)
        ? payload.goal_feature_issue_map
        : {},
      prerequisite_goal_issue_numbers: Array.isArray(payload.prerequisite_goal_issue_numbers)
        ? payload.prerequisite_goal_issue_numbers
          .map((entry) => Number.parseInt(String(entry || "").trim(), 10))
          .filter((entry) => Number.isFinite(entry) && entry > 0)
          .sort((left, right) => left - right)
        : [],
      final_instantiation_goal_issue_number: (() => {
        const parsed = Number.parseInt(String(payload.final_instantiation_goal_issue_number || "").trim(), 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
      })(),
    });
  }

  return {
    goals_with_materialized_hard_plans: rows.length,
    goals: rows,
  };
}

function readerForRunsDir(runsDir = ".hatch/runs") {
  return {
    readState(runDir) {
      return readStateFromSupport(runDir);
    },
    readAllRunStates() {
      return readAllRunStatesFromSupport({ runsDir });
    },
  };
}

export {
  ACTIVE_SUMMARY_STALLED_THRESHOLD_MS,
  describeOperatorSignals,
  duration,
  expectedNextOutcomeForNode,
  formatFactoryActiveMinimal,
  formatFactoryActiveSummary,
  formatFactoryStatus,
  mtime,
  resolveGraph,
  resolveIssue,
  resolveMilestone,
};

export function readState(runDir) {
  const parentRunsDir = runDir ? runDir.replace(RUN_DIR_RE, "") : ".hatch/runs";
  return readerForRunsDir(parentRunsDir).readState(runDir);
}

export function readAllRunStates({ runsDir = ".hatch/runs" } = {}) {
  return readerForRunsDir(runsDir).readAllRunStates({ runsDir });
}

export const FACTORY_STATUS_PROJECTION_DIMENSIONS = PROJECTION_DIMENSIONS.factory_status;

export function factoryStatus({
  runsDir = ".hatch/runs",
  staleMinutes = 20,
  context = {},
  now = Date.now(),
  listGoalHardStatesFn = listGoalHardStates,
} = {}) {
  const resolvedContext = {
    ...context,
    factory_id: String(context?.factory_id || "mothership").trim() || "mothership",
  };
  const status = readCanonicalFactoryStatus({
    runsDir,
    staleMinutes,
    context: resolvedContext,
    now,
  });
  const repoRoot = String(context?.repo || process.cwd()).trim() || ".";
  const factoryId = resolvedContext.factory_id;
  const repo = String(context?.target_repo || context?.gh_repo || "").trim();
  if (!repo) {
    return ensureProjectionDimensions("factory_status", {
      ...status,
      hard_goal_review: {
        repo: "",
        goal_count: 0,
        hard_goal_count: 0,
        needs_planning_count: 0,
        awaiting_post_plan_review_count: 0,
        approved_plan_resume_count: 0,
        awaiting_post_plan_review_goal_numbers: [],
        approved_plan_resume_goal_numbers: [],
        hard_goals: [],
      },
      hard_plan_traceability: emptyHardPlanTraceability(),
    });
  }

  let hardGoalReview;
  try {
    hardGoalReview = listGoalHardStatesFn({
      repo,
      repoRoot,
      factoryId,
    });
  } catch {
    hardGoalReview = {
      repo,
      goal_count: 0,
      hard_goal_count: 0,
      needs_planning_count: 0,
      awaiting_post_plan_review_count: 0,
      approved_plan_resume_count: 0,
      awaiting_post_plan_review_goal_numbers: [],
      approved_plan_resume_goal_numbers: [],
      hard_goals: [],
    };
  }

  let hardPlanTraceability;
  try {
    hardPlanTraceability = buildHardPlanTraceability({
      repoRoot,
      factoryId,
      hardGoalReview,
    });
  } catch {
    hardPlanTraceability = emptyHardPlanTraceability();
  }

  return ensureProjectionDimensions("factory_status", {
    ...status,
    hard_goal_review: hardGoalReview,
    hard_plan_traceability: hardPlanTraceability,
  });
}

export function factoryActiveSummary({ runsDir = ".hatch/runs", now = Date.now(), context = {} } = {}) {
  return readCanonicalFactoryActiveSummary({ runsDir, now, context });
}
