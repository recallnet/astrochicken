import { parseJson } from "./cli-helpers.ts";

const GOAL_EXECUTION_PATH_VALUES = new Set(["easy", "medium", "hard"]);
const GOAL_EXECUTION_MODE_VALUES = new Set(["direct"]);
const GOAL_EXECUTION_STATE_VALUES = new Set([
  "pending",
  "running",
  "completed",
  "failed",
  "required",
  "not_required",
  "blocked",
  "pending_review",
  "approved",
]);

function normalizeGoalExecutionPath(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return GOAL_EXECUTION_PATH_VALUES.has(normalized) ? normalized : "";
}

function normalizeGoalExecutionMode(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return GOAL_EXECUTION_MODE_VALUES.has(normalized) ? normalized : "";
}

function normalizeGoalExecutionState(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return GOAL_EXECUTION_STATE_VALUES.has(normalized) ? normalized : "";
}

function parseGoalRoutingState(value = {}) {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? { ...value }
    : (typeof value === "string" && value.trim() ? parseJson(value, {}) : {});

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {
    decomposition_state: "",
    planning_state: "",
  };

  const decomposition_state = normalizeGoalExecutionState(raw.decomposition_state);
  const planning_state = normalizeGoalExecutionState(raw.planning_state);
  const planningArtifactPath = String(raw.planning_artifact_path || "").trim();
  return {
    decomposition_state,
    planning_state,
    ...(planningArtifactPath ? { planning_artifact_path: planningArtifactPath } : {}),
  };
}

function isProvisionalHardExecutionPath({
  goalExecutionPath = "",
  goalRoutingState = {},
} = {}) {
  const path = normalizeGoalExecutionPath(goalExecutionPath);
  const state = goalRoutingState && typeof goalRoutingState === "object" ? goalRoutingState : {};
  const decompositionState = String(state.decomposition_state || "").trim().toLowerCase();
  const planningState = String(state.planning_state || "").trim().toLowerCase();
  return path === "hard"
    && decompositionState === "required"
    && planningState === "not_required";
}

export function resolveGoalExecutionPathMetadata(context = {}) {
  const ctx = context && typeof context === "object" ? context : {};
  const goalExecutionPath = normalizeGoalExecutionPath(ctx.goal_execution_path)
    || normalizeGoalExecutionPath(ctx.execution_path)
    || normalizeGoalExecutionPath(ctx.routeHint)
    || "unknown";
  const goalRoutingState = parseGoalRoutingState(ctx.goal_routing_state);
  const provisionalHard = isProvisionalHardExecutionPath({
    goalExecutionPath,
    goalRoutingState,
  });

  const planningReviewRequired = goalExecutionPath === "hard"
    && goalRoutingState.planning_state === "pending_review";

  return {
    goal_execution_path: goalExecutionPath,
    goal_execution_mode: normalizeGoalExecutionMode(ctx.goal_execution_mode),
    goal_execution_path_version: String(ctx.goal_execution_path_version || ctx.routing_contract_version || "").trim(),
    classification_version: String(ctx.classification_version || "").trim(),
    goal_routing_state: goalRoutingState,
    decomposition_state: goalRoutingState.decomposition_state,
    planning_state: goalRoutingState.planning_state,
    ...(goalRoutingState.planning_artifact_path ? { planning_artifact_path: goalRoutingState.planning_artifact_path } : {}),
    planning_review_required: planningReviewRequired,
    provisional_hard: provisionalHard,
    provisional: provisionalHard,
  };
}
