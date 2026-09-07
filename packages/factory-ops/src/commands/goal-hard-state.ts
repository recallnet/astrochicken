import { createGhCliAdapter } from "@hatch/github-adapter";

import { parseJson, trim } from "../lib/cli-helpers.ts";
import { getFactoryLabelName, FACTORY_LABEL_KEYS } from "../lib/factory-label-contract.ts";
import { inspectGoalHardPlanAttachment } from "../lib/goal-hard-plan-packet.ts";

export const HARD_GOAL_STATES = Object.freeze({
  NEEDS_PLANNING: "needs_planning",
  AWAITING_POST_PLAN_REVIEW: "awaiting_post_plan_review",
  APPROVED_PLAN_RESUME: "approved_plan_resume",
});

function parseGoalRoutingState(goalRoutingStateRaw = "", goalRoutingState = null) {
  if (goalRoutingState && typeof goalRoutingState === "object" && !Array.isArray(goalRoutingState)) {
    return goalRoutingState;
  }
  const parsed = parseJson(trim(goalRoutingStateRaw), {});
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

function normalizeLabelNames(labels = []) {
  const names = new Set();
  for (const entry of Array.isArray(labels) ? labels : []) {
    const normalized = trim(typeof entry === "string" ? entry : entry?.name).toLowerCase();
    if (normalized) names.add(normalized);
  }
  return names;
}

function normalizeGoalLabels(goalLabelsRaw = "", goalLabels = null) {
  if (Array.isArray(goalLabels)) return goalLabels;
  const parsed = parseJson(trim(goalLabelsRaw), []);
  return Array.isArray(parsed) ? parsed : [];
}

function resolveHardPlanAttachment({
  repoRoot = ".",
  goalIssueNumber = "",
  factoryId = "mothership",
  hardPlanAttachment = null,
  inspectAttachmentFn = inspectGoalHardPlanAttachment,
} = {}) {
  if (hardPlanAttachment && typeof hardPlanAttachment === "object") {
    return hardPlanAttachment;
  }

  const normalizedGoalIssueNumber = trim(goalIssueNumber);
  if (!normalizedGoalIssueNumber) {
    return {
      attached: false,
      goal_number: "",
    };
  }

  return inspectAttachmentFn({
    repo: trim(repoRoot || "."),
    goalNumber: normalizedGoalIssueNumber,
    factoryId: trim(factoryId || "mothership"),
  });
}

function buildHardGoalArtifactRefs(attachment = {}) {
  const refs = Array.isArray(attachment?.artifact_refs) ? attachment.artifact_refs : [];
  return refs.map((entry) => {
    if (typeof entry === "string") {
      return { ref: trim(entry) };
    }
    if (!entry || typeof entry !== "object") {
      return { ref: "" };
    }
    return {
      label: trim(entry.label),
      url: trim(entry.url),
      path: trim(entry.path),
      ref: trim(entry.ref),
      sha256: trim(entry.sha256),
      type: trim(entry.type),
    };
  }).filter((entry) => Object.values(entry).some((value) => trim(value)));
}

function isHardGoal({
  goalExecutionPath = "",
  labelNames = new Set(),
  hardPlanPacketPresent = false,
  goalRoutingState = {},
} = {}) {
  if (trim(goalExecutionPath).toLowerCase() === "hard") return true;
  if (labelNames.has("hard")) return true;
  if (hardPlanPacketPresent) return true;

  const decompositionState = trim(goalRoutingState?.decomposition_state).toLowerCase();
  const planningState = trim(goalRoutingState?.planning_state).toLowerCase();
  return decompositionState === "required" && planningState === "required";
}

/**
 * Deterministic hard-goal state resolver.
 *
 * Decision tree:
 * 1) Goal is considered hard when execution_path=hard, label=hard, or a hard-plan packet is attached.
 * 2) If no hard-plan packet exists => needs_planning.
 * 3) If packet exists and ready label is missing => awaiting_post_plan_review.
 * 4) If packet exists and ready label is present => approved_plan_resume.
 */
export function classifyHardGoalState({
  goalIssueNumber = "",
  goalExecutionPath = "",
  goalRoutingStateRaw = "",
  goalRoutingState = null,
  goalLabelsRaw = "",
  goalLabels = null,
  repoRoot = ".",
  factoryId = "mothership",
  hardPlanAttachment = null,
  inspectAttachmentFn = inspectGoalHardPlanAttachment,
} = {}) {
  const normalizedGoalIssueNumber = trim(goalIssueNumber);
  const resolvedGoalRoutingState = parseGoalRoutingState(goalRoutingStateRaw, goalRoutingState);
  const labels = normalizeGoalLabels(goalLabelsRaw, goalLabels);
  const labelNames = normalizeLabelNames(labels);
  const readyLabelPresent = labelNames.has("ready");
  const awaitingHumanLabelPresent = labelNames.has("awaiting-human");

  const attachment = resolveHardPlanAttachment({
    repoRoot,
    goalIssueNumber: normalizedGoalIssueNumber,
    factoryId,
    hardPlanAttachment,
    inspectAttachmentFn,
  });
  const hardPlanPacketPresent = attachment?.attached === true;

  const hardGoal = isHardGoal({
    goalExecutionPath,
    labelNames,
    hardPlanPacketPresent,
    goalRoutingState: resolvedGoalRoutingState,
  });

  let hardGoalState = HARD_GOAL_STATES.NEEDS_PLANNING;
  let hardGoalStateReason = "missing_hard_plan_packet";

  if (hardPlanPacketPresent && readyLabelPresent) {
    hardGoalState = HARD_GOAL_STATES.APPROVED_PLAN_RESUME;
    hardGoalStateReason = "hard_plan_packet_present_and_ready_restored";
  } else if (hardPlanPacketPresent) {
    hardGoalState = HARD_GOAL_STATES.AWAITING_POST_PLAN_REVIEW;
    hardGoalStateReason = awaitingHumanLabelPresent
      ? "awaiting_human_review_hold"
      : "hard_plan_packet_present_waiting_ready";
  }

  return {
    goal_issue_number: normalizedGoalIssueNumber,
    goal_execution_path: trim(goalExecutionPath).toLowerCase(),
    goal_routing_state: {
      decomposition_state: trim(resolvedGoalRoutingState.decomposition_state).toLowerCase(),
      planning_state: trim(resolvedGoalRoutingState.planning_state).toLowerCase(),
    },
    hard_goal: hardGoal,
    hard_goal_state: hardGoal ? hardGoalState : "",
    hard_goal_state_reason: hardGoal ? hardGoalStateReason : "not_hard_goal",
    hard_label_present: labelNames.has("hard"),
    ready_label_present: readyLabelPresent,
    awaiting_human_label_present: awaitingHumanLabelPresent,
    hard_plan_packet_present: hardPlanPacketPresent,
    hard_plan_packet_id: trim(attachment?.packet_id),
    hard_plan_packet_path: trim(attachment?.packet_path),
    hard_plan_comment_marker: trim(attachment?.comment_marker),
    hard_plan_comment_id: trim(attachment?.goal_issue_comment_id),
    hard_plan_comment_url: trim(attachment?.goal_issue_comment_url),
    hard_plan_artifact_count: Array.isArray(attachment?.artifact_refs) ? attachment.artifact_refs.length : 0,
    hard_plan_artifact_refs: buildHardGoalArtifactRefs(attachment),
  };
}

export function inspectHardGoalState({
  repo = "",
  repoRoot = ".",
  goalIssueNumber = "",
  goalExecutionPath = "",
  goalRoutingStateRaw = "",
  goalRoutingState = null,
  goalLabelsRaw = "",
  goalLabels = null,
  factoryId = "mothership",
  inspectAttachmentFn = inspectGoalHardPlanAttachment,
} = {}) {
  const normalizedGoalIssueNumber = trim(goalIssueNumber);
  const resolvedGoalLabels = normalizeGoalLabels(goalLabelsRaw, goalLabels);
  const labels = resolvedGoalLabels;

  return classifyHardGoalState({
    goalIssueNumber: normalizedGoalIssueNumber,
    goalExecutionPath,
    goalRoutingStateRaw,
    goalRoutingState,
    goalLabels: labels,
    repoRoot,
    factoryId,
    inspectAttachmentFn,
  });
}

function resolveGoalTitle(goal = {}) {
  return trim(goal?.title) || `Goal #${trim(goal?.number)}`;
}

export function listGoalHardStates({
  repo = "",
  repoRoot = ".",
  factoryId = "mothership",
  goals = null,
  githubAdapter = null,
  inspectAttachmentFn = inspectGoalHardPlanAttachment,
} = {}) {
  const normalizedRepo = trim(repo);
  if (!normalizedRepo) {
    return {
      repo: "",
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

  const goalLabel = getFactoryLabelName(factoryId, FACTORY_LABEL_KEYS.GOAL);
  const adapter = githubAdapter || createGhCliAdapter({ repo: normalizedRepo });
  const listedGoals = Array.isArray(goals)
    ? goals
    : adapter.issueList({
      state: "open",
      labels: [goalLabel],
      limit: 200,
      fields: "number,title,labels",
    });

  const hardGoals = [];
  for (const goal of Array.isArray(listedGoals) ? listedGoals : []) {
    const goalIssueNumber = trim(goal?.number);
    const labels = Array.isArray(goal?.labels) ? goal.labels : [];
    const labelNames = normalizeLabelNames(labels);
    const hardPlanAttachment = resolveHardPlanAttachment({
      repoRoot,
      goalIssueNumber,
      factoryId,
      inspectAttachmentFn,
    });

    const classification = classifyHardGoalState({
      goalIssueNumber,
      goalLabels: labels,
      goalExecutionPath: labelNames.has("hard") || hardPlanAttachment?.attached === true ? "hard" : "",
      hardPlanAttachment,
      repoRoot,
      factoryId,
      inspectAttachmentFn,
    });

    if (!classification.hard_goal) continue;

    hardGoals.push({
      goal_number: Number(goalIssueNumber),
      title: resolveGoalTitle(goal),
      hard_goal_state: classification.hard_goal_state,
      hard_goal_state_reason: classification.hard_goal_state_reason,
      ready_label_present: classification.ready_label_present,
      awaiting_human_label_present: classification.awaiting_human_label_present,
      hard_plan_packet_present: classification.hard_plan_packet_present,
      hard_plan_packet_id: classification.hard_plan_packet_id,
      hard_plan_packet_path: classification.hard_plan_packet_path,
      hard_plan_comment_url: classification.hard_plan_comment_url,
      hard_plan_artifact_count: classification.hard_plan_artifact_count,
    });
  }

  const awaitingPostPlanReview = hardGoals
    .filter((goal) => goal.hard_goal_state === HARD_GOAL_STATES.AWAITING_POST_PLAN_REVIEW)
    .map((goal) => goal.goal_number)
    .sort((left, right) => left - right);

  const approvedPlanResume = hardGoals
    .filter((goal) => goal.hard_goal_state === HARD_GOAL_STATES.APPROVED_PLAN_RESUME)
    .map((goal) => goal.goal_number)
    .sort((left, right) => left - right);

  return {
    repo: normalizedRepo,
    goal_count: Array.isArray(listedGoals) ? listedGoals.length : 0,
    hard_goal_count: hardGoals.length,
    needs_planning_count: hardGoals.filter((goal) => goal.hard_goal_state === HARD_GOAL_STATES.NEEDS_PLANNING).length,
    awaiting_post_plan_review_count: awaitingPostPlanReview.length,
    approved_plan_resume_count: approvedPlanResume.length,
    awaiting_post_plan_review_goal_numbers: awaitingPostPlanReview,
    approved_plan_resume_goal_numbers: approvedPlanResume,
    hard_goals: hardGoals,
  };
}
