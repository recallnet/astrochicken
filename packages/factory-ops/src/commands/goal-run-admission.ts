import { resolveGhRepo } from "./common-resolve-gh-repo.ts";
import { classifyHardGoalState, HARD_GOAL_STATES } from "./goal-hard-state.ts";
import { trim, parseJson } from "../lib/cli-helpers.ts";
import { hasActiveGoalDecompositionPacket, listGoalDecompositionPackets } from "../lib/goal-decomposition-packet.ts";
import { listGoalExecutionPathPackets, parseGoalExecutionStickyState } from "../lib/goal-execution-path-packet.ts";
import { PACKET_STATE_SUPERSEDED, updatePersistedPacketState } from "../lib/packet-core.ts";
import { hasOpenPrerequisiteBlocker } from "../lib/prerequisite-blockers.ts";

export const GOAL_RUN_ADMISSION_DECISIONS = Object.freeze({
  ALLOW: "allow",
  ALLOW_APPROVED_PLAN_RESUME: "allow_approved_plan_resume",
  DENY_DUPLICATE_DECOMPOSITION: "deny_duplicate_decomposition",
  DENY_PLANNING_LOCKED: "deny_planning_locked",
  DENY_PREREQUISITE_BLOCKED: "deny_prerequisite_blocked",
  DENY_PREREQUISITE_LOOKUP_FAILURE: "deny_prerequisite_lookup_failure",
});

export const GOAL_RUN_ADMISSION_ERROR_CODES = Object.freeze({
  DUPLICATE_DECOMPOSITION: "E_GOAL_RUN_ADMISSION_DUPLICATE_DECOMPOSITION",
  PLANNING_LOCKED: "E_GOAL_RUN_ADMISSION_PLANNING_LOCKED",
  MALFORMED_ROUTING_STATE: "E_GOAL_RUN_ADMISSION_MALFORMED_ROUTING_STATE",
  PREREQUISITE_BLOCKED: "E_GOAL_RUN_ADMISSION_PREREQUISITE_BLOCKED",
  PREREQUISITE_LOOKUP_FAILURE: "E_GOAL_RUN_ADMISSION_PREREQUISITE_LOOKUP_FAILURE",
});

function parseGoalRoutingState(goalRoutingStateRaw = "", goalRoutingState = null) {
  if (goalRoutingState && typeof goalRoutingState === "object" && !Array.isArray(goalRoutingState)) {
    return goalRoutingState;
  }

  const parsed = parseJson(trim(goalRoutingStateRaw), {});
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

function parseGoalLabels(goalLabelsRaw = "", goalLabels = null) {
  if (Array.isArray(goalLabels)) return goalLabels;
  const parsed = parseJson(trim(goalLabelsRaw), []);
  return Array.isArray(parsed) ? parsed : [];
}

function parseBooleanFlag(value = "") {
  const normalized = trim(value).toLowerCase();
  if (!normalized) return false;
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function normalizeHardStateFromInput({
  hardGoal = "",
  hardGoalState = "",
  hardGoalStateReason = "",
  readyLabelPresent = "",
  awaitingHumanLabelPresent = "",
  hardPlanPacketPresent = "",
  hardPlanPacketId = "",
  hardPlanPacketPath = "",
  hardPlanCommentMarker = "",
  hardPlanCommentId = "",
  hardPlanCommentUrl = "",
  hardPlanArtifactCount = "",
  hardPlanArtifactRefsRaw = "",
  hardPlanArtifactRefs = null,
} = {}) {
  const parsedRefs = Array.isArray(hardPlanArtifactRefs)
    ? hardPlanArtifactRefs
    : parseJson(trim(hardPlanArtifactRefsRaw), []);
  const artifactRefs = Array.isArray(parsedRefs) ? parsedRefs : [];

  const parsedArtifactCount = Number.parseInt(trim(hardPlanArtifactCount), 10);
  const artifactCount = Number.isFinite(parsedArtifactCount)
    ? parsedArtifactCount
    : artifactRefs.length;

  return {
    hard_goal: parseBooleanFlag(hardGoal),
    hard_goal_state: trim(hardGoalState),
    hard_goal_state_reason: trim(hardGoalStateReason),
    ready_label_present: parseBooleanFlag(readyLabelPresent),
    awaiting_human_label_present: parseBooleanFlag(awaitingHumanLabelPresent),
    hard_plan_packet_present: parseBooleanFlag(hardPlanPacketPresent),
    hard_plan_packet_id: trim(hardPlanPacketId),
    hard_plan_packet_path: trim(hardPlanPacketPath),
    hard_plan_comment_marker: trim(hardPlanCommentMarker),
    hard_plan_comment_id: trim(hardPlanCommentId),
    hard_plan_comment_url: trim(hardPlanCommentUrl),
    hard_plan_artifact_count: artifactCount,
    hard_plan_artifact_refs: artifactRefs,
  };
}

function isProvisionalHardRoute({ goalExecutionPath = "", decompositionState = "", planningState = "" } = {}) {
  return trim(goalExecutionPath).toLowerCase() === "hard"
    && trim(decompositionState).toLowerCase() === "required"
    && trim(planningState).toLowerCase() === "not_required";
}

function resolveGoalExecutionRouteClass({ goalExecutionPath = "", decompositionState = "", planningState = "" } = {}) {
  const normalizedPath = trim(goalExecutionPath).toLowerCase();
  if (normalizedPath === "medium") return "medium";
  if (isProvisionalHardRoute({ goalExecutionPath: normalizedPath, decompositionState, planningState })) {
    return "provisional_hard";
  }
  if (normalizedPath === "easy" || normalizedPath === "hard") return normalizedPath;
  return "unknown";
}

function buildHardStateFields(classification = {}) {
  const artifactRefs = Array.isArray(classification?.hard_plan_artifact_refs)
    ? classification.hard_plan_artifact_refs
    : [];

  return {
    hard_goal: classification?.hard_goal ? "true" : "false",
    hard_goal_state: trim(classification?.hard_goal_state),
    hard_goal_state_reason: trim(classification?.hard_goal_state_reason),
    ready_label_present: classification?.ready_label_present ? "true" : "false",
    awaiting_human_label_present: classification?.awaiting_human_label_present ? "true" : "false",
    hard_plan_packet_present: classification?.hard_plan_packet_present ? "true" : "false",
    hard_plan_packet_id: trim(classification?.hard_plan_packet_id),
    hard_plan_packet_path: trim(classification?.hard_plan_packet_path),
    hard_plan_comment_marker: trim(classification?.hard_plan_comment_marker),
    hard_plan_comment_id: trim(classification?.hard_plan_comment_id),
    hard_plan_comment_url: trim(classification?.hard_plan_comment_url),
    hard_plan_artifact_count: String(Number.isFinite(Number(classification?.hard_plan_artifact_count))
      ? Number(classification.hard_plan_artifact_count)
      : artifactRefs.length),
    hard_plan_artifact_refs: artifactRefs,
  };
}

function buildDuplicateDecompositionAdmission({
  normalizedGoalIssueNumber = "",
  goalExecutionPath = "",
  sticky = {},
  routeClass = "unknown",
  hardState = {},
} = {}) {
  const reasonByRouteClass = {
    medium: "decomposition_packet_exists_medium",
    provisional_hard: "decomposition_packet_exists_provisional_hard",
  };

  return {
    goal_issue_number: normalizedGoalIssueNumber,
    goal_execution_path: trim(goalExecutionPath),
    goal_execution_route_class: routeClass,
    goal_routing_state: {
      decomposition_state: sticky.decomposition_state,
      planning_state: sticky.planning_state,
    },
    decomposition_packet_present: "true",
    planning_locked: "false",
    planning_lock_bypassed: "false",
    goal_admission_allowed: "false",
    goal_admission_decision: GOAL_RUN_ADMISSION_DECISIONS.DENY_DUPLICATE_DECOMPOSITION,
    goal_admission_reason: reasonByRouteClass[routeClass] || "decomposition_packet_exists",
    goal_admission_error_code: GOAL_RUN_ADMISSION_ERROR_CODES.DUPLICATE_DECOMPOSITION,
    ...buildHardStateFields(hardState),
  };
}

function buildApprovedPlanResumeAdmission({
  normalizedGoalIssueNumber = "",
  goalExecutionPath = "",
  sticky = {},
  decompositionPacketPresent = false,
  hardState = {},
} = {}) {
  return {
    goal_issue_number: normalizedGoalIssueNumber,
    goal_execution_path: trim(goalExecutionPath),
    goal_execution_route_class: "hard",
    goal_routing_state: {
      decomposition_state: sticky.decomposition_state,
      planning_state: sticky.planning_state,
    },
    decomposition_packet_present: decompositionPacketPresent ? "true" : "false",
    planning_locked: "false",
    planning_lock_bypassed: "true",
    prerequisite_open_blockers: [],
    goal_admission_allowed: "true",
    goal_admission_decision: GOAL_RUN_ADMISSION_DECISIONS.ALLOW_APPROVED_PLAN_RESUME,
    goal_admission_reason: "approved_plan_resume",
    goal_admission_error_code: "",
    ...buildHardStateFields(hardState),
  };
}

function buildPrerequisiteBlockedAdmission({
  normalizedGoalIssueNumber = "",
  goalExecutionPath = "",
  sticky = {},
  decompositionPacketPresent = false,
  planningLockBypassed = false,
  hardState = {},
  openBlockers = [],
} = {}) {
  const blockers = Array.from(new Set(
    (Array.isArray(openBlockers) ? openBlockers : [])
      .map((value) => Number.parseInt(trim(value), 10))
      .filter((value) => Number.isFinite(value) && value > 0),
  )).sort((a, b) => a - b);
  const blockerSuffix = blockers.join(",");

  return {
    goal_issue_number: normalizedGoalIssueNumber,
    goal_execution_path: trim(goalExecutionPath),
    goal_routing_state: {
      decomposition_state: sticky.decomposition_state,
      planning_state: sticky.planning_state,
    },
    decomposition_packet_present: decompositionPacketPresent ? "true" : "false",
    planning_locked: "false",
    planning_lock_bypassed: planningLockBypassed ? "true" : "false",
    prerequisite_open_blockers: blockers,
    goal_admission_allowed: "false",
    goal_admission_decision: GOAL_RUN_ADMISSION_DECISIONS.DENY_PREREQUISITE_BLOCKED,
    goal_admission_reason: blockerSuffix
      ? `prerequisite_blockers_present:${blockerSuffix}`
      : "prerequisite_blockers_present",
    goal_admission_error_code: GOAL_RUN_ADMISSION_ERROR_CODES.PREREQUISITE_BLOCKED,
    ...buildHardStateFields(hardState),
  };
}

function buildPrerequisiteLookupFailureAdmission({
  normalizedGoalIssueNumber = "",
  goalExecutionPath = "",
  sticky = {},
  decompositionPacketPresent = false,
  planningLockBypassed = false,
  hardState = {},
  lookupError = "",
} = {}) {
  return {
    goal_issue_number: normalizedGoalIssueNumber,
    goal_execution_path: trim(goalExecutionPath),
    goal_routing_state: {
      decomposition_state: sticky.decomposition_state,
      planning_state: sticky.planning_state,
    },
    decomposition_packet_present: decompositionPacketPresent ? "true" : "false",
    planning_locked: "false",
    planning_lock_bypassed: planningLockBypassed ? "true" : "false",
    prerequisite_open_blockers: [],
    goal_admission_allowed: "false",
    goal_admission_decision: GOAL_RUN_ADMISSION_DECISIONS.DENY_PREREQUISITE_LOOKUP_FAILURE,
    goal_admission_reason: trim(lookupError)
      ? `prerequisite_blocker_lookup_failed:${trim(lookupError)}`
      : "prerequisite_blocker_lookup_failed",
    goal_admission_error_code: GOAL_RUN_ADMISSION_ERROR_CODES.PREREQUISITE_LOOKUP_FAILURE,
    ...buildHardStateFields(hardState),
  };
}

export function inspectGoalRunAdmission({
  repo = "",
  goalIssueNumber = "",
  goalExecutionPath = "",
  goalRoutingStateRaw = "",
  goalRoutingState = null,
  goalLabelsRaw = "",
  goalLabels = null,
  hardGoal = "",
  hardGoalState = "",
  hardGoalStateReason = "",
  readyLabelPresent = "",
  awaitingHumanLabelPresent = "",
  hardPlanPacketPresent = "",
  hardPlanPacketId = "",
  hardPlanPacketPath = "",
  hardPlanCommentMarker = "",
  hardPlanCommentId = "",
  hardPlanCommentUrl = "",
  hardPlanArtifactCount = "",
  hardPlanArtifactRefsRaw = "",
  hardPlanArtifactRefs = null,
  factoryId = "mothership",
  resolveGhRepoFn = resolveGhRepo,
  hasOpenPrerequisiteBlockerFn = hasOpenPrerequisiteBlocker,
} = {}) {
  const normalizedGoalIssueNumber = trim(goalIssueNumber);
  if (!normalizedGoalIssueNumber) {
    throw new Error("missing_goal_issue_number");
  }

  const routingState = parseGoalRoutingState(goalRoutingStateRaw, goalRoutingState);
  const sticky = parseGoalExecutionStickyState({
    decompositionState: routingState?.decomposition_state,
    planningState: routingState?.planning_state,
  });
  if (!sticky.ok) {
    throw new Error(
      `${GOAL_RUN_ADMISSION_ERROR_CODES.MALFORMED_ROUTING_STATE}:${normalizedGoalIssueNumber}:invalid_goal_routing_state`,
    );
  }

  const providedHardState = normalizeHardStateFromInput({
    hardGoal,
    hardGoalState,
    hardGoalStateReason,
    readyLabelPresent,
    awaitingHumanLabelPresent,
    hardPlanPacketPresent,
    hardPlanPacketId,
    hardPlanPacketPath,
    hardPlanCommentMarker,
    hardPlanCommentId,
    hardPlanCommentUrl,
    hardPlanArtifactCount,
    hardPlanArtifactRefsRaw,
    hardPlanArtifactRefs,
  });

  const hardState = providedHardState.hard_goal
    ? providedHardState
    : classifyHardGoalState({
      goalIssueNumber: normalizedGoalIssueNumber,
      goalExecutionPath,
      goalRoutingState: routingState,
      goalLabels: parseGoalLabels(goalLabelsRaw, goalLabels),
      repoRoot: repo,
      factoryId,
    });

  const decompositionPacketPresent = hasActiveGoalDecompositionPacket({
    repo,
    factoryId,
    goalIssueNumber: normalizedGoalIssueNumber,
  });
  const planningLocked = sticky.planning_state !== "not_required";
  const approvedPlanResume = hardState.hard_goal_state === HARD_GOAL_STATES.APPROVED_PLAN_RESUME;

  if (!approvedPlanResume && planningLocked) {
    return {
      goal_issue_number: normalizedGoalIssueNumber,
      goal_execution_path: trim(goalExecutionPath),
      goal_routing_state: {
        decomposition_state: sticky.decomposition_state,
        planning_state: sticky.planning_state,
      },
      decomposition_packet_present: decompositionPacketPresent ? "true" : "false",
      planning_locked: "true",
      planning_lock_bypassed: "false",
      prerequisite_open_blockers: [],
      goal_admission_allowed: "false",
      goal_admission_decision: GOAL_RUN_ADMISSION_DECISIONS.DENY_PLANNING_LOCKED,
      goal_admission_reason: "planning_lock_exists",
      goal_admission_error_code: GOAL_RUN_ADMISSION_ERROR_CODES.PLANNING_LOCKED,
      ...buildHardStateFields(hardState),
    };
  }

  if (!approvedPlanResume && decompositionPacketPresent) {
    const routeClass = resolveGoalExecutionRouteClass({
      goalExecutionPath,
      decompositionState: sticky.decomposition_state,
      planningState: sticky.planning_state,
    });
    return {
      ...buildDuplicateDecompositionAdmission({
        normalizedGoalIssueNumber,
        goalExecutionPath,
        sticky,
        routeClass,
        hardState,
      }),
      prerequisite_open_blockers: [],
    };
  }

  let effectiveGhRepo = "";
  try {
    effectiveGhRepo = trim(resolveGhRepoFn("", { cwd: repo, factoryId }));
  } catch (error) {
    return buildPrerequisiteLookupFailureAdmission({
      normalizedGoalIssueNumber,
      goalExecutionPath,
      sticky,
      decompositionPacketPresent,
      planningLockBypassed: approvedPlanResume,
      hardState,
      lookupError: `resolve_repo_failed:${trim(error?.message || error)}`,
    });
  }

  let prerequisiteCheck;
  try {
    prerequisiteCheck = hasOpenPrerequisiteBlockerFn({
      repo: effectiveGhRepo,
      goalIssueNumber: normalizedGoalIssueNumber,
    });
  } catch (error) {
    prerequisiteCheck = {
      ok: false,
      error: `lookup_exception:${trim(error?.message || error)}`,
      openBlockers: [],
    };
  }

  if (!prerequisiteCheck?.ok) {
    return buildPrerequisiteLookupFailureAdmission({
      normalizedGoalIssueNumber,
      goalExecutionPath,
      sticky,
      decompositionPacketPresent,
      planningLockBypassed: approvedPlanResume,
      hardState,
      lookupError: trim(prerequisiteCheck?.error) || "failed_lookup",
    });
  }

  if (Array.isArray(prerequisiteCheck?.openBlockers) && prerequisiteCheck.openBlockers.length > 0) {
    return buildPrerequisiteBlockedAdmission({
      normalizedGoalIssueNumber,
      goalExecutionPath,
      sticky,
      decompositionPacketPresent,
      planningLockBypassed: approvedPlanResume,
      hardState,
      openBlockers: prerequisiteCheck.openBlockers,
    });
  }

  if (approvedPlanResume) {
    // Approved hard-plan resumes intentionally bypass planning/decomposition
    // lock checks. The hard-plan packet is already the durable contract.
    return buildApprovedPlanResumeAdmission({
      normalizedGoalIssueNumber,
      goalExecutionPath,
      sticky,
      decompositionPacketPresent,
      hardState,
    });
  }

  return {
    goal_issue_number: normalizedGoalIssueNumber,
    goal_execution_path: trim(goalExecutionPath),
    goal_routing_state: {
      decomposition_state: sticky.decomposition_state,
      planning_state: sticky.planning_state,
    },
    decomposition_packet_present: "false",
    planning_locked: "false",
    planning_lock_bypassed: "false",
    prerequisite_open_blockers: [],
    goal_admission_allowed: "true",
    goal_admission_decision: GOAL_RUN_ADMISSION_DECISIONS.ALLOW,
    goal_admission_reason: "admission_allowed",
    goal_admission_error_code: "",
    ...buildHardStateFields(hardState),
  };
}

export function buildGoalRunAdmissionFailure({
  goalIssueNumber = "",
  goalAdmissionDecision = "",
  goalAdmissionReason = "",
  goalAdmissionErrorCode = "",
  decompositionPacketPresent = "",
  planningLocked = "",
} = {}) {
  const normalizedGoalIssueNumber = trim(goalIssueNumber) || "(unknown_goal_issue)";
  const normalizedDecision = trim(goalAdmissionDecision) || "deny_unknown";
  const normalizedReason = trim(goalAdmissionReason) || "admission_denied";
  const normalizedErrorCode = trim(goalAdmissionErrorCode) || "E_GOAL_RUN_ADMISSION_DENIED";

  const error = `${normalizedErrorCode}:${normalizedGoalIssueNumber}:${normalizedDecision}:${normalizedReason}`;
  return {
    ok: false,
    error,
    goal_issue_number: normalizedGoalIssueNumber,
    goal_admission_decision: normalizedDecision,
    goal_admission_reason: normalizedReason,
    goal_admission_error_code: normalizedErrorCode,
    decomposition_packet_present: trim(decompositionPacketPresent),
    planning_locked: trim(planningLocked),
  };
}

export function resetGoalRunAdmissionLocks({
  repo = "",
  goalIssueNumber = "",
  factoryId = "mothership",
  reason = "",
} = {}) {
  const normalizedGoalIssueNumber = trim(goalIssueNumber);
  if (!normalizedGoalIssueNumber) {
    throw new Error("missing_goal_issue_number");
  }
  const normalizedReason = trim(reason);
  if (!normalizedReason) {
    throw new Error("missing_reason");
  }

  const decompositionPackets = listGoalDecompositionPackets({
    repo,
    factoryId,
    goalIssueNumber: normalizedGoalIssueNumber,
  });
  const executionPathPackets = listGoalExecutionPathPackets({
    repo,
    factoryId,
    goalIssueNumber: normalizedGoalIssueNumber,
  });

  const statusReason = `goal_run_admission_reset:${normalizedReason}`;
  const superseded = [];

  for (const entry of [...decompositionPackets, ...executionPathPackets]) {
    const packetPath = trim(entry?.packet_path);
    if (!packetPath) continue;
    const updated = updatePersistedPacketState({
      packetPath,
      packetState: PACKET_STATE_SUPERSEDED,
      statusReason,
    });
    superseded.push({
      packet_id: trim(updated?.packet_id),
      packet_type: trim(updated?.packet_type),
      packet_path: packetPath,
      packet_state: trim(updated?.packet_state),
    });
  }

  return {
    ok: true,
    goal_issue_number: normalizedGoalIssueNumber,
    factory_id: trim(factoryId),
    reset_reason: normalizedReason,
    status_reason: statusReason,
    superseded_count: superseded.length,
    decomposition_packets_superseded: decompositionPackets.length,
    execution_path_packets_superseded: executionPathPackets.length,
    superseded_packets: superseded,
  };
}
