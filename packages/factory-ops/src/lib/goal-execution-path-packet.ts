import { parseJson, trim } from "./cli-helpers.ts";
import {
  deriveRationaleRequirement,
  normalizeUnderstandingRisk,
} from "./goal-rationale-doc.ts";
import {
  buildNamedPacketEnvelope,
  buildPacketTakeoverContract,
  listPersistedFactoryPackets,
  makePacketId,
  PACKET_STATE_SUPERSEDED,
  persistNamedPacket,
  validateNamedPacketBase,
  validatePacketTakeoverContract,
  validateRegisteredPacketType,
} from "./packet-core.ts";

export const GOAL_EXECUTION_PATH_PACKET_SCHEMA_VERSION = "goal_execution_path_packet/v1";
export const GOAL_EXECUTION_PATH_PACKET_TYPE = "goal_execution_path_packet";
export const GOAL_EXECUTION_PATH_VALUES = Object.freeze(["easy", "medium", "hard"]);

export const GOAL_EXECUTION_PATH_CANONICAL_STATE_VALUES = Object.freeze([
  "pending",
  "running",
  "completed",
  "failed",
  "pending_review",
  "approved",
]);

// Legacy-compatible values that are already persisted in historical packets.
// Keep these during the ratchet rollout so existing packets remain readable,
// while still enforcing an explicit enum contract.
export const GOAL_EXECUTION_PATH_LEGACY_STATE_VALUES = Object.freeze([
  "required",
  "not_required",
  "blocked",
]);

export const GOAL_EXECUTION_PATH_STATE_VALUES = Object.freeze([
  ...GOAL_EXECUTION_PATH_CANONICAL_STATE_VALUES,
  ...GOAL_EXECUTION_PATH_LEGACY_STATE_VALUES,
]);

function normalizeExecutionPath(value = "") {
  const normalized = trim(value).toLowerCase();
  return GOAL_EXECUTION_PATH_VALUES.includes(normalized) ? normalized : "";
}

function normalizeGoalExecutionState(value = "") {
  const normalized = trim(value).toLowerCase();
  return GOAL_EXECUTION_PATH_STATE_VALUES.includes(normalized) ? normalized : "";
}

function normalizeGoalExecutionStateForPacket(value = "") {
  return trim(value).toLowerCase();
}

function normalizeClassificationSignals({ classificationSignalsRaw = "", classificationSignals } = {}) {
  if (Array.isArray(classificationSignals)) return classificationSignals;
  if (classificationSignals && typeof classificationSignals === "object") return { ...classificationSignals };

  const parsed = parseJson(trim(classificationSignalsRaw), {});
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") return parsed;
  return {};
}

export function parseGoalExecutionStickyState({ decompositionState = "", planningState = "" } = {}) {
  const decomposition_state = normalizeGoalExecutionState(decompositionState);
  const planning_state = normalizeGoalExecutionState(planningState);

  return {
    ok: Boolean(decomposition_state && planning_state),
    decomposition_state,
    planning_state,
  };
}

export function parseGoalExecutionPathPacketShape(packet = {}) {
  const sticky = parseGoalExecutionStickyState({
    decompositionState: packet?.decomposition_state,
    planningState: packet?.planning_state,
  });
  const rationale = deriveRationaleRequirement({
    executionPath: packet?.execution_path,
    understandingRisk: packet?.understanding_risk,
    rationaleRequired: packet?.rationale_required,
    classificationSignals: packet?.classification_signals,
  });

  const planningArtifactPath = trim(packet?.planning_artifact_path);
  return {
    goal_issue_number: trim(packet?.goal_issue_number),
    execution_path: normalizeExecutionPath(packet?.execution_path),
    routing_contract_version: trim(packet?.routing_contract_version),
    classification_version: trim(packet?.classification_version),
    decomposition_state: sticky.decomposition_state,
    planning_state: sticky.planning_state,
    understanding_risk: rationale.understanding_risk,
    rationale_required: rationale.rationale_required,
    ...(planningArtifactPath ? { planning_artifact_path: planningArtifactPath } : {}),
  };
}

export function buildGoalExecutionPathPacket({
  goalIssueNumber = "",
  executionPath = "",
  routingContractVersion = "",
  classificationVersion = "",
  decompositionState = "",
  planningState = "",
  planningArtifactPath = "",
  classifiedAt = "",
  classifiedBy = "",
  classificationReason = "",
  classificationSignalsRaw = "",
  classificationSignals,
  understandingRisk = "",
  rationaleRequired = "",
  factoryId = "",
  runId = "",
  pipeline = "",
  nodeId = "",
  targetRepo = "",
  controlPlaneRepo = "",
  packetState = "",
} = {}) {
  const normalizedGoalIssueNumber = trim(goalIssueNumber);
  const normalizedExecutionPath = normalizeExecutionPath(executionPath);
  const normalizedRoutingContractVersion = trim(routingContractVersion);
  const normalizedClassificationVersion = trim(classificationVersion);
  const normalizedStickyState = {
    decomposition_state: normalizeGoalExecutionStateForPacket(decompositionState),
    planning_state: normalizeGoalExecutionStateForPacket(planningState),
  };
  const normalizedPlanningArtifactPath = trim(planningArtifactPath);
  const normalizedClassifiedAt = trim(classifiedAt || new Date().toISOString());
  const normalizedClassifiedBy = trim(classifiedBy);
  const normalizedClassificationReason = trim(classificationReason);
  const normalizedClassificationSignals = normalizeClassificationSignals({
    classificationSignalsRaw,
    classificationSignals,
  });
  const rationale = deriveRationaleRequirement({
    executionPath: normalizedExecutionPath,
    understandingRisk,
    rationaleRequired,
    classificationSignals: normalizedClassificationSignals,
  });

  return {
    ...buildNamedPacketEnvelope({
      schemaVersion: GOAL_EXECUTION_PATH_PACKET_SCHEMA_VERSION,
      packetType: GOAL_EXECUTION_PATH_PACKET_TYPE,
      packetId: makePacketId({
        packetType: GOAL_EXECUTION_PATH_PACKET_TYPE,
        identity: {
          factory_id: trim(factoryId),
          goal_issue_number: normalizedGoalIssueNumber,
          execution_path: normalizedExecutionPath,
          routing_contract_version: normalizedRoutingContractVersion,
          classification_version: normalizedClassificationVersion,
        },
      }),
      packetState,
      factoryId,
      runId,
      pipeline,
      nodeId,
      targetRepo,
      controlPlaneRepo,
    }),
    ...buildPacketTakeoverContract({
      handoffOwner: "goal.execution_path_router",
      handoffKind: "goal_execution_path",
      resourceRefs: {
        goal_issue_number: normalizedGoalIssueNumber,
        execution_path: normalizedExecutionPath,
        routing_contract_version: normalizedRoutingContractVersion,
        classification_version: normalizedClassificationVersion,
        target_repo: trim(targetRepo),
      },
      inspectionCommands: [
        "Load this packet before routing goal execution so the selected path remains sticky.",
      ],
      // @context:regression !critical This packet is a durable routing contract, not a shell
      // work order. Treating prose guidance as execution_commands makes supervisor auto-exec try
      // to run English text through `sh`, which forces needless review stalls every tick.
      executionCommands: [],
      verifyCommands: [
        "Confirm downstream stages consume this packet metadata and preserve versioned routing semantics.",
      ],
      expectedOutcomes: [
        "Goal routing is durable, versioned, and replayable from packet data.",
      ],
      preserveWork: {
        preserve_work_required: true,
        execution_path: normalizedExecutionPath,
        decomposition_state: normalizedStickyState.decomposition_state,
        planning_state: normalizedStickyState.planning_state,
        ...(normalizedPlanningArtifactPath ? { planning_artifact_path: normalizedPlanningArtifactPath } : {}),
      },
      operatorPrompt: "Use this packet as the canonical execution-path contract for the goal. Do not reclassify unless a new packet is written with explicit version metadata.",
    }),
    goal_issue_number: normalizedGoalIssueNumber,
    execution_path: normalizedExecutionPath,
    routing_contract_version: normalizedRoutingContractVersion,
    classification_version: normalizedClassificationVersion,
    decomposition_state: normalizedStickyState.decomposition_state,
    planning_state: normalizedStickyState.planning_state,
    understanding_risk: rationale.understanding_risk,
    rationale_required: rationale.rationale_required,
    ...(normalizedPlanningArtifactPath ? { planning_artifact_path: normalizedPlanningArtifactPath } : {}),
    classified_at: normalizedClassifiedAt,
    classified_by: normalizedClassifiedBy,
    classification_reason: normalizedClassificationReason,
    classification_signals: normalizedClassificationSignals,
  };
}

export function validateGoalExecutionPathPacket(packet = {}) {
  const base = validateNamedPacketBase(packet);
  const registration = validateRegisteredPacketType({
    packetType: packet?.packet_type,
    schemaVersion: packet?.schema_version,
  });
  const errors = [...base.errors, ...registration.errors];
  const parsedPacket = parseGoalExecutionPathPacketShape(packet);

  if (!parsedPacket.goal_issue_number) errors.push("missing_required_field:goal_issue_number");

  if (!parsedPacket.execution_path) {
    errors.push(`invalid_execution_path:${trim(packet?.execution_path) || "(empty)"}`);
  }

  if (!parsedPacket.routing_contract_version) {
    errors.push("missing_required_field:routing_contract_version");
  }
  if (!parsedPacket.classification_version) {
    errors.push("missing_required_field:classification_version");
  }

  const rawDecompositionState = trim(packet?.decomposition_state);
  if (!rawDecompositionState) {
    errors.push("missing_required_field:decomposition_state");
  } else if (!parsedPacket.decomposition_state) {
    errors.push(`invalid_decomposition_state:${rawDecompositionState}`);
  }

  const rawPlanningState = trim(packet?.planning_state);
  if (!rawPlanningState) {
    errors.push("missing_required_field:planning_state");
  } else if (!parsedPacket.planning_state) {
    errors.push(`invalid_planning_state:${rawPlanningState}`);
  }

  if (!trim(packet?.classified_at)) {
    errors.push("missing_required_field:classified_at");
  }
  if (!trim(packet?.classified_by)) {
    errors.push("missing_required_field:classified_by");
  }
  if (!trim(packet?.classification_reason)) {
    errors.push("missing_required_field:classification_reason");
  }

  const signals = packet?.classification_signals;
  if (signals === null || signals === undefined || typeof signals !== "object") {
    errors.push("missing_required_field:classification_signals");
  }

  const normalizedUnderstandingRisk = normalizeUnderstandingRisk(packet?.understanding_risk);
  if (!normalizedUnderstandingRisk) {
    errors.push(`invalid_understanding_risk:${trim(packet?.understanding_risk) || "(empty)"}`);
  }
  if (typeof packet?.rationale_required !== "boolean") {
    errors.push("missing_required_field:rationale_required");
  }

  const handoff = validatePacketTakeoverContract(packet, { required: true });
  errors.push(...handoff.errors);

  return {
    ok: errors.length === 0,
    errors,
  };
}

export function persistGoalExecutionPathPacket({ repo = "", packet = {} } = {}) {
  const validation = validateGoalExecutionPathPacket(packet);
  if (!validation.ok) {
    throw new Error(`invalid_goal_execution_path_packet:${validation.errors.join(",")}`);
  }
  return persistNamedPacket({ repo, packet });
}

export function listGoalExecutionPathPackets({
  repo = "",
  factoryId = "",
  goalIssueNumber = "",
  packetState = "",
} = {}) {
  const packets = listPersistedFactoryPackets({
    repo,
    factoryId,
    packetTypes: [GOAL_EXECUTION_PATH_PACKET_TYPE],
    durableOnly: true,
    packetState,
  });
  const normalizedGoalIssueNumber = trim(goalIssueNumber);
  return packets.filter(({ packet }) => {
    if (trim(packet?.packet_state) === PACKET_STATE_SUPERSEDED) return false;
    if (!normalizedGoalIssueNumber) return true;
    return trim(packet?.goal_issue_number) === normalizedGoalIssueNumber;
  });
}

export function getLatestGoalExecutionPathPacket({
  repo = "",
  factoryId = "",
  goalIssueNumber = "",
  packetState = "",
} = {}) {
  const packets = listGoalExecutionPathPackets({
    repo,
    factoryId,
    goalIssueNumber,
    packetState,
  });
  return packets[0] || null;
}

export function getGoalExecutionPath(packet = {}) {
  return normalizeExecutionPath(packet?.execution_path);
}

export function getGoalRoutingContractVersion(packet = {}) {
  return trim(packet?.routing_contract_version);
}

export function getGoalExecutionStickyState(packet = {}) {
  const sticky = parseGoalExecutionStickyState({
    decompositionState: packet?.decomposition_state,
    planningState: packet?.planning_state,
  });
  const planningArtifactPath = trim(packet?.planning_artifact_path);
  return {
    decomposition_state: sticky.decomposition_state,
    planning_state: sticky.planning_state,
    ...(planningArtifactPath ? { planning_artifact_path: planningArtifactPath } : {}),
  };
}

export function getGoalExecutionUnderstandingMetadata(packet = {}) {
  const rationale = deriveRationaleRequirement({
    executionPath: packet?.execution_path,
    understandingRisk: packet?.understanding_risk,
    rationaleRequired: packet?.rationale_required,
    classificationSignals: packet?.classification_signals,
  });
  return {
    understanding_risk: rationale.understanding_risk,
    rationale_required: rationale.rationale_required,
  };
}
