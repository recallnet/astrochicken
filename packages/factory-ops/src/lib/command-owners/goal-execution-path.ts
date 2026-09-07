import { checkGoalAlreadyDecomposedByPacket } from "../../commands/goal-decomposition-packet.ts";
import { parseJson, trim } from "../cli-helpers.ts";
import {
  buildGoalExecutionPathPacket,
  getGoalExecutionPath,
  getGoalExecutionUnderstandingMetadata,
  getGoalExecutionStickyState,
  getGoalRoutingContractVersion,
  getLatestGoalExecutionPathPacket,
  GOAL_EXECUTION_PATH_VALUES,
  parseGoalExecutionStickyState,
  persistGoalExecutionPathPacket,
  validateGoalExecutionPathPacket,
} from "../goal-execution-path-packet.ts";
import {
  PACKET_STATE_SUPERSEDED,
  updatePersistedPacketState,
} from "../packet-core.ts";

export const GOAL_EXECUTION_PATH_ROUTING_CONTRACT_VERSION = "routing/v1";
export const GOAL_EXECUTION_PATH_MIGRATION_CLASSIFICATION_VERSION = "goal_execution_path_migration/v1";
export const GOAL_EXECUTION_PATH_MALFORMED_ERROR_CODE = "E_GOAL_EXEC_PATH_MALFORMED";
export const GOAL_EXECUTION_PATH_RECLASSIFIED_ERROR_CODE = "E_GOAL_EXEC_PATH_RECLASSIFIED";

function normalizeGoalIssueNumbers(goalIssueNumbersRaw = "") {
  const parsed = parseJson(trim(goalIssueNumbersRaw), []);
  const values = Array.isArray(parsed) ? parsed : [];
  const deduped = new Set();
  for (const value of values) {
    const normalized = trim(value);
    if (normalized) deduped.add(normalized);
  }
  return [...deduped];
}

function buildMalformedGoalExecutionPathError({ goalIssueNumber = "", reason = "" } = {}) {
  const normalizedIssueNumber = trim(goalIssueNumber) || "(unknown_goal_issue)";
  const normalizedReason = trim(reason) || "malformed_goal_execution_path_metadata";
  return `${GOAL_EXECUTION_PATH_MALFORMED_ERROR_CODE}:${normalizedIssueNumber}:${normalizedReason}`;
}

function validateProvidedExecutionPathEntry({ goalIssueNumber = "", entry = {} } = {}) {
  const normalizedIssueNumber = trim(goalIssueNumber);
  const executionPath = trim(entry?.goal_execution_path || entry?.execution_path).toLowerCase();
  if (!GOAL_EXECUTION_PATH_VALUES.includes(executionPath)) {
    throw new Error(buildMalformedGoalExecutionPathError({
      goalIssueNumber: normalizedIssueNumber,
      reason: "invalid_execution_path",
    }));
  }

  const routingState = entry?.goal_routing_state && typeof entry.goal_routing_state === "object"
    ? entry.goal_routing_state
    : entry?.routing_state;
  const stickyState = parseGoalExecutionStickyState({
    decompositionState: routingState?.decomposition_state || entry?.decomposition_state,
    planningState: routingState?.planning_state || entry?.planning_state,
  });
  if (!stickyState.ok) {
    throw new Error(buildMalformedGoalExecutionPathError({
      goalIssueNumber: normalizedIssueNumber,
      reason: "invalid_routing_state",
    }));
  }

  const contractVersion = trim(entry?.goal_execution_path_version || entry?.routing_contract_version);
  if (!contractVersion) {
    throw new Error(buildMalformedGoalExecutionPathError({
      goalIssueNumber: normalizedIssueNumber,
      reason: "missing_goal_execution_path_version",
    }));
  }

  const provisionalHard = isProvisionalHardExecutionPath({
    executionPath,
    decompositionState: stickyState.decomposition_state,
    planningState: stickyState.planning_state,
  });

  return {
    goal_issue_number: normalizedIssueNumber,
    goal_execution_path: executionPath,
    goal_routing_state: {
      decomposition_state: stickyState.decomposition_state,
      planning_state: stickyState.planning_state,
    },
    goal_execution_path_version: contractVersion,
    classification_version: trim(entry?.classification_version),
    goal_execution_path_packet_id: trim(entry?.goal_execution_path_packet_id || entry?.packet_id),
    goal_execution_path_packet_path: trim(entry?.goal_execution_path_packet_path || entry?.packet_path),
    goal_execution_path_source: "supervisor_context",
    understanding_risk: trim(entry?.understanding_risk) || "unknown",
    rationale_required: entry?.rationale_required === true || String(entry?.rationale_required).trim().toLowerCase() === "true",
    provisional_hard: provisionalHard,
    provisional: provisionalHard,
  };
}

function readGoalExecutionPathFromProvidedMap({ goalIssueNumber = "", goalExecutionPathsRaw = "" } = {}) {
  const normalizedIssueNumber = trim(goalIssueNumber);
  if (!normalizedIssueNumber) return null;

  const parsed = parseJson(trim(goalExecutionPathsRaw), {});
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const entry = parsed[normalizedIssueNumber];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }

  return validateProvidedExecutionPathEntry({
    goalIssueNumber: normalizedIssueNumber,
    entry,
  });
}

function inspectPersistedGoalExecutionPathPacket({
  repo = "",
  goalIssueNumber = "",
  factoryId = "",
} = {}) {
  const latest = getLatestGoalExecutionPathPacket({
    repo,
    goalIssueNumber,
    factoryId,
  });
  if (!latest) {
    return {
      exists: false,
      routing_contract_upgrade_required: false,
      packet: null,
    };
  }

  const packet = latest.packet || {};
  const validation = validateGoalExecutionPathPacket(packet);
  if (!validation.ok) {
    throw new Error(buildMalformedGoalExecutionPathError({
      goalIssueNumber,
      reason: `invalid_goal_execution_path_packet:${validation.errors.join(",")}`,
    }));
  }

  const routingContractVersion = getGoalRoutingContractVersion(packet);

  return {
    exists: true,
    routing_contract_upgrade_required: Boolean(
      routingContractVersion
      && routingContractVersion !== GOAL_EXECUTION_PATH_ROUTING_CONTRACT_VERSION,
    ),
    packet,
  };
}

function isGoalAlreadyDecomposed({
  repo = "",
  goalIssueNumber = "",
  factoryId = "",
} = {}) {
  return checkGoalAlreadyDecomposedByPacket({
    repo,
    factoryId,
    issueNumber: goalIssueNumber,
  }) === "true";
}

function classifyLegacyMissingGoalExecutionPath({
  repo = "",
  goalIssueNumber = "",
  factoryId = "",
} = {}) {
  classifyGoalExecutionPath({
    repo,
    goalIssueNumber,
    executionPath: "medium",
    routingContractVersion: GOAL_EXECUTION_PATH_ROUTING_CONTRACT_VERSION,
    classificationVersion: GOAL_EXECUTION_PATH_MIGRATION_CLASSIFICATION_VERSION,
    decompositionState: "required",
    planningState: "not_required",
    classifiedBy: "goal.execution_path.ensure.migration",
    classificationReason: "Legacy goal missing durable execution-path metadata. Migrated to medium decomposition contract.",
    classificationSignalsRaw: JSON.stringify({
      migration_case: "missing_metadata",
      routing_contract_version: GOAL_EXECUTION_PATH_ROUTING_CONTRACT_VERSION,
      execution_path: "medium",
      decomposition_state: "required",
      planning_state: "not_required",
    }),
    factoryId,
    pipeline: "factory_supervisor_tick",
    nodeId: "ensure_goal_execution_path",
  });
}

function migrateLegacyGoalExecutionPathMetadata({
  repo = "",
  goalIssueNumber = "",
  factoryId = "",
} = {}) {
  const normalizedIssueNumber = trim(goalIssueNumber);
  if (!normalizedIssueNumber) {
    throw new Error("missing_goal_issue_number");
  }

  // Transition policy for #2259:
  // - missing metadata + not decomposed => deterministically classify and persist once.
  // - missing metadata + already decomposed => fail closed to avoid reinterpreting in-flight work.
  // - pre-existing valid metadata => preserve as canonical source; no reclassification.
  // - malformed metadata => fail closed with E_GOAL_EXEC_PATH_MALFORMED.
  const existing = inspectPersistedGoalExecutionPathPacket({
    repo,
    goalIssueNumber: normalizedIssueNumber,
    factoryId,
  });
  const goalIsDecomposed = isGoalAlreadyDecomposed({
    repo,
    goalIssueNumber: normalizedIssueNumber,
    factoryId,
  });

  if (!existing.exists) {
    if (goalIsDecomposed) {
      throw new Error(buildMalformedGoalExecutionPathError({
        goalIssueNumber: normalizedIssueNumber,
        reason: "missing_execution_path_for_decomposed_goal",
      }));
    }

    classifyLegacyMissingGoalExecutionPath({
      repo,
      goalIssueNumber: normalizedIssueNumber,
      factoryId,
    });

    const migrated = inspectPersistedGoalExecutionPathPacket({
      repo,
      goalIssueNumber: normalizedIssueNumber,
      factoryId,
    });

    return {
      goal_is_decomposed: "false",
      migration_status: "migrated_missing_metadata",
      routing_contract_upgrade_required: migrated.routing_contract_upgrade_required,
      required_goal_execution_path_version: GOAL_EXECUTION_PATH_ROUTING_CONTRACT_VERSION,
    };
  }

  return {
    goal_is_decomposed: goalIsDecomposed ? "true" : "false",
    migration_status: goalIsDecomposed ? "migration_complete_decomposed" : "migration_complete_existing",
    routing_contract_upgrade_required: existing.routing_contract_upgrade_required,
    required_goal_execution_path_version: GOAL_EXECUTION_PATH_ROUTING_CONTRACT_VERSION,
  };
}

function buildGoalExecutionPathLockedError({
  goalIssueNumber = "",
  reason = "",
  existingPacketId = "",
} = {}) {
  const normalizedIssueNumber = trim(goalIssueNumber) || "(unknown_goal_issue)";
  const normalizedReason = trim(reason) || "reclassification_requires_reset";
  const normalizedPacketId = trim(existingPacketId);
  return normalizedPacketId
    ? `${GOAL_EXECUTION_PATH_RECLASSIFIED_ERROR_CODE}:${normalizedIssueNumber}:${normalizedReason}:${normalizedPacketId}`
    : `${GOAL_EXECUTION_PATH_RECLASSIFIED_ERROR_CODE}:${normalizedIssueNumber}:${normalizedReason}`;
}

function isProvisionalHardExecutionPath({
  executionPath = "",
  decompositionState = "",
  planningState = "",
} = {}) {
  return trim(executionPath).toLowerCase() === "hard"
    && trim(decompositionState).toLowerCase() === "required"
    && trim(planningState).toLowerCase() === "not_required";
}

function normalizePlanningStateTransitionTarget(value = "") {
  const normalized = trim(value).toLowerCase();
  return normalized === "pending_review" || normalized === "approved"
    ? normalized
    : "";
}

function parseGoalRoutingStateRaw(goalRoutingStateRaw = "") {
  const parsed = parseJson(trim(goalRoutingStateRaw), {});
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

function inferExecutionPathForPlanningTransition({
  desiredGoalExecutionPath = "",
  packetExecutionPath = "",
  goalRoutingState = {},
} = {}) {
  const fromArgs = trim(desiredGoalExecutionPath).toLowerCase();
  if (GOAL_EXECUTION_PATH_VALUES.includes(fromArgs)) return fromArgs;

  const fromPacket = trim(packetExecutionPath).toLowerCase();
  if (GOAL_EXECUTION_PATH_VALUES.includes(fromPacket)) return fromPacket;

  const fromRoutingState = trim(goalRoutingState?.goal_execution_path).toLowerCase();
  if (GOAL_EXECUTION_PATH_VALUES.includes(fromRoutingState)) return fromRoutingState;

  return "";
}

function inferDecompositionStateForPlanningTransition({
  priorState = {},
  executionPath = "",
} = {}) {
  const prior = trim(priorState?.decomposition_state).toLowerCase();
  if (prior) return prior;

  const normalizedPath = trim(executionPath).toLowerCase();
  if (normalizedPath === "medium" || normalizedPath === "hard") return "required";
  if (normalizedPath === "easy") return "not_required";
  return "";
}

function mergeClassificationSignals(
  baseSignals = {},
  overrides = {},
) {
  const base = baseSignals && typeof baseSignals === "object" && !Array.isArray(baseSignals)
    ? { ...baseSignals }
    : {};
  const patch = overrides && typeof overrides === "object" && !Array.isArray(overrides)
    ? { ...overrides }
    : {};
  return { ...base, ...patch };
}

function normalizeStageOneStickyState({
  executionPath = "",
  routingContractVersion = "",
  decompositionState = "",
  planningState = "",
} = {}) {
  const normalizedExecutionPath = trim(executionPath).toLowerCase();
  if (trim(routingContractVersion) === GOAL_EXECUTION_PATH_ROUTING_CONTRACT_VERSION
      && (normalizedExecutionPath === "medium" || normalizedExecutionPath === "hard")) {
    return {
      decomposition_state: "required",
      planning_state: "not_required",
    };
  }

  return {
    decomposition_state: decompositionState,
    planning_state: planningState,
  };
}

function isEquivalentExecutionPathRecord(left = {}, right = {}) {
  const leftPath = trim(left.goal_execution_path).toLowerCase();
  const rightPath = trim(right.goal_execution_path).toLowerCase();

  const leftVersion = trim(left.goal_execution_path_version);
  const rightVersion = trim(right.goal_execution_path_version);

  const leftRoutingState = left.goal_routing_state && typeof left.goal_routing_state === "object"
    ? left.goal_routing_state
    : {};
  const rightRoutingState = right.goal_routing_state && typeof right.goal_routing_state === "object"
    ? right.goal_routing_state
    : {};

  return leftPath
    && leftPath === rightPath
    && leftVersion
    && leftVersion === rightVersion
    && trim(leftRoutingState.decomposition_state).toLowerCase() === trim(rightRoutingState.decomposition_state).toLowerCase()
    && trim(leftRoutingState.planning_state).toLowerCase() === trim(rightRoutingState.planning_state).toLowerCase();
}

function toClassificationResult({
  packet = {},
  packetPath = "",
  packetRef = {},
  storageClass = "",
  classificationTrace = "",
} = {}) {
  const provisionalHard = isProvisionalHardExecutionPath({
    executionPath: packet.execution_path,
    decompositionState: packet.decomposition_state,
    planningState: packet.planning_state,
  });

  return {
    packet_path: packetPath,
    packet_id: packetRef.packet_id,
    packet_type: packetRef.packet_type,
    schema_version: packetRef.schema_version,
    storage_class: storageClass,
    goal_issue_number: trim(packet.goal_issue_number),
    execution_path: packet.execution_path,
    routing_contract_version: packet.routing_contract_version,
    classification_version: packet.classification_version,
    decomposition_state: packet.decomposition_state,
    planning_state: packet.planning_state,
    understanding_risk: packet.understanding_risk,
    rationale_required: packet.rationale_required === true,
    provisional_hard: provisionalHard,
    provisional: provisionalHard,
    classified_at: packet.classified_at,
    classified_by: packet.classified_by,
    classification_reason: packet.classification_reason,
    classification_signals: packet.classification_signals,
    classification_trace: trim(classificationTrace),
  };
}

export function classifyGoalExecutionPath({
  repo = "",
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
} = {}) {
  const normalizedGoalIssueNumber = trim(goalIssueNumber);
  if (!normalizedGoalIssueNumber) {
    throw new Error("missing_goal_issue_number");
  }

  const existing = getLatestGoalExecutionPathPacket({
    repo,
    goalIssueNumber: normalizedGoalIssueNumber,
    factoryId,
  });

  if (existing?.packet) {
    const existingValidation = validateGoalExecutionPathPacket(existing.packet);
    if (!existingValidation.ok) {
      throw new Error(buildMalformedGoalExecutionPathError({
        goalIssueNumber: normalizedGoalIssueNumber,
        reason: `invalid_goal_execution_path_packet:${existingValidation.errors.join(",")}`,
      }));
    }

    throw new Error(buildGoalExecutionPathLockedError({
      goalIssueNumber: normalizedGoalIssueNumber,
      reason: "reclassification_requires_reset",
      existingPacketId: trim(existing?.packet_ref?.packet_id || existing?.packet?.packet_id),
    }));
  }

  const stageOneStickyState = normalizeStageOneStickyState({
    executionPath,
    routingContractVersion,
    decompositionState,
    planningState,
  });

  const packet = buildGoalExecutionPathPacket({
    goalIssueNumber: normalizedGoalIssueNumber,
    executionPath,
    routingContractVersion,
    classificationVersion,
    decompositionState: stageOneStickyState.decomposition_state,
    planningState: stageOneStickyState.planning_state,
    planningArtifactPath,
    classifiedAt,
    classifiedBy,
    classificationReason,
    classificationSignalsRaw,
    classificationSignals,
    understandingRisk,
    rationaleRequired,
    factoryId,
    runId,
    pipeline,
    nodeId,
    targetRepo,
    controlPlaneRepo,
  });

  const persisted = persistGoalExecutionPathPacket({ repo, packet });
  return toClassificationResult({
    packet,
    packetPath: persisted.packet_path,
    packetRef: persisted.packet_ref || {},
    storageClass: persisted.storage_class,
    classificationTrace: "persisted",
  });
}

export function inspectGoalExecutionPath({
  repo = "",
  goalIssueNumber = "",
  factoryId = "",
} = {}) {
  const latest = getLatestGoalExecutionPathPacket({
    repo,
    goalIssueNumber,
    factoryId,
  });
  if (!latest) {
    return {
      found: false,
      goal_issue_number: trim(goalIssueNumber),
    };
  }
  const packet = latest.packet || {};
  const provisionalHard = isProvisionalHardExecutionPath({
    executionPath: packet.execution_path,
    decompositionState: packet.decomposition_state,
    planningState: packet.planning_state,
  });

  return {
    found: true,
    packet_path: latest.packet_path,
    packet_id: packet.packet_id,
    packet_state: packet.packet_state,
    goal_issue_number: packet.goal_issue_number,
    execution_path: packet.execution_path,
    routing_contract_version: packet.routing_contract_version,
    classification_version: packet.classification_version,
    decomposition_state: packet.decomposition_state,
    planning_state: packet.planning_state,
    understanding_risk: packet.understanding_risk,
    rationale_required: packet.rationale_required === true,
    provisional_hard: provisionalHard,
    provisional: provisionalHard,
    classified_at: packet.classified_at,
    classified_by: packet.classified_by,
    classification_reason: packet.classification_reason,
    classification_signals: packet.classification_signals,
  };
}

export function readGoalExecutionPath({
  repo = "",
  goalIssueNumber = "",
  factoryId = "",
} = {}) {
  const normalizedIssueNumber = trim(goalIssueNumber);
  if (!normalizedIssueNumber) {
    throw new Error("missing_goal_issue_number");
  }

  const latest = getLatestGoalExecutionPathPacket({
    repo,
    goalIssueNumber: normalizedIssueNumber,
    factoryId,
  });
  if (!latest) {
    throw new Error(`missing_goal_execution_path_packet:${normalizedIssueNumber}`);
  }

  const packet = latest.packet || {};
  const validation = validateGoalExecutionPathPacket(packet);
  if (!validation.ok) {
    throw new Error(buildMalformedGoalExecutionPathError({
      goalIssueNumber: normalizedIssueNumber,
      reason: `invalid_goal_execution_path_packet:${validation.errors.join(",")}`,
    }));
  }

  const executionPath = getGoalExecutionPath(packet);
  const stickyState = getGoalExecutionStickyState(packet);
  const provisionalHard = isProvisionalHardExecutionPath({
    executionPath,
    decompositionState: stickyState.decomposition_state,
    planningState: stickyState.planning_state,
  });

  const planningArtifactPath = trim(stickyState.planning_artifact_path);
  const understanding = getGoalExecutionUnderstandingMetadata(packet);

  return {
    goal_issue_number: normalizedIssueNumber,
    goal_execution_path: executionPath,
    goal_routing_state: {
      decomposition_state: stickyState.decomposition_state,
      planning_state: stickyState.planning_state,
      ...(planningArtifactPath ? { planning_artifact_path: planningArtifactPath } : {}),
    },
    decomposition_state: stickyState.decomposition_state,
    planning_state: stickyState.planning_state,
    ...(planningArtifactPath ? { planning_artifact_path: planningArtifactPath } : {}),
    goal_execution_path_version: getGoalRoutingContractVersion(packet),
    classification_version: trim(packet.classification_version),
    goal_execution_path_packet_id: trim(packet.packet_id),
    goal_execution_path_packet_path: latest.packet_path,
    goal_execution_path_source: "packet_store",
    understanding_risk: understanding.understanding_risk,
    rationale_required: understanding.rationale_required,
    provisional_hard: provisionalHard,
    provisional: provisionalHard,
  };
}

export function ensureGoalExecutionPath({
  repo = "",
  goalIssueNumber = "",
  factoryId = "",
} = {}) {
  const migration = migrateLegacyGoalExecutionPathMetadata({
    repo,
    goalIssueNumber,
    factoryId,
  });

  return {
    ensured: true,
    ...readGoalExecutionPath({ repo, goalIssueNumber, factoryId }),
    ...migration,
  };
}

export function ensureGoalExecutionPaths({
  repo = "",
  goalIssueNumbersRaw = "",
  factoryId = "",
} = {}) {
  const goalIssueNumbers = normalizeGoalIssueNumbers(goalIssueNumbersRaw);
  const goalExecutionPathRecords = goalIssueNumbers.map((goalIssueNumber) => ensureGoalExecutionPath({
    repo,
    goalIssueNumber,
    factoryId,
  }));

  const goalExecutionPaths = Object.fromEntries(
    goalExecutionPathRecords.map((entry) => [
      entry.goal_issue_number,
      {
        goal_execution_path: entry.goal_execution_path,
        goal_routing_state: entry.goal_routing_state,
        goal_execution_path_version: entry.goal_execution_path_version,
        classification_version: entry.classification_version,
        goal_execution_path_packet_id: entry.goal_execution_path_packet_id,
        goal_execution_path_packet_path: entry.goal_execution_path_packet_path,
        understanding_risk: entry.understanding_risk,
        rationale_required: entry.rationale_required === true,
        provisional_hard: entry.provisional_hard === true,
        provisional: entry.provisional === true,
      },
    ]),
  );

  return {
    goal_execution_path_count: goalExecutionPathRecords.length,
    goal_execution_path_records: goalExecutionPathRecords,
    goal_execution_paths: goalExecutionPaths,
  };
}

export function resolveGoalExecutionPath({
  repo = "",
  goalIssueNumber = "",
  factoryId = "",
  goalExecutionPathsRaw = "",
} = {}) {
  const normalizedIssueNumber = trim(goalIssueNumber);
  const fromSupervisorContext = readGoalExecutionPathFromProvidedMap({
    goalIssueNumber: normalizedIssueNumber,
    goalExecutionPathsRaw,
  });

  if (fromSupervisorContext) {
    let persisted = null;
    try {
      persisted = readGoalExecutionPath({
        repo,
        goalIssueNumber: normalizedIssueNumber,
        factoryId,
      });
    } catch (error) {
      const message = trim(error?.message || error);
      if (!message.startsWith(`missing_goal_execution_path_packet:${normalizedIssueNumber}`)) {
        throw error;
      }
    }

    if (persisted && !isEquivalentExecutionPathRecord(persisted, fromSupervisorContext)) {
      throw new Error(buildGoalExecutionPathLockedError({
        goalIssueNumber: normalizedIssueNumber,
        reason: "supervisor_context_reclassified",
        existingPacketId: trim(persisted.goal_execution_path_packet_id),
      }));
    }

    return persisted || fromSupervisorContext;
  }

  return readGoalExecutionPath({
    repo,
    goalIssueNumber: normalizedIssueNumber,
    factoryId,
  });
}

export function transitionGoalExecutionPathPlanningState({
  repo = "",
  goalIssueNumber = "",
  factoryId = "",
  nextPlanningState = "",
  planningArtifactPath = "",
  goalExecutionPath = "",
  goalRoutingStateRaw = "",
  classifiedBy = "",
  classificationReason = "",
  classificationSignalsRaw = "",
  classificationSignals = null,
  runId = "",
  pipeline = "",
  nodeId = "",
  targetRepo = "",
  controlPlaneRepo = "",
} = {}) {
  const normalizedIssueNumber = trim(goalIssueNumber);
  if (!normalizedIssueNumber) throw new Error("missing_goal_issue_number");

  const normalizedFactoryId = trim(factoryId) || "mothership";
  const targetPlanningState = normalizePlanningStateTransitionTarget(nextPlanningState);
  if (!targetPlanningState) {
    throw new Error(`invalid_next_planning_state:${trim(nextPlanningState) || "(empty)"}`);
  }

  const latest = getLatestGoalExecutionPathPacket({
    repo,
    goalIssueNumber: normalizedIssueNumber,
    factoryId: normalizedFactoryId,
  });
  if (!latest?.packet) {
    throw new Error(`missing_goal_execution_path_packet:${normalizedIssueNumber}`);
  }

  const existingPacket = latest.packet;
  const existingValidation = validateGoalExecutionPathPacket(existingPacket);
  if (!existingValidation.ok) {
    throw new Error(buildMalformedGoalExecutionPathError({
      goalIssueNumber: normalizedIssueNumber,
      reason: `invalid_goal_execution_path_packet:${existingValidation.errors.join(",")}`,
    }));
  }

  const priorStickyState = getGoalExecutionStickyState(existingPacket);
  const goalRoutingState = parseGoalRoutingStateRaw(goalRoutingStateRaw);
  const resolvedExecutionPath = inferExecutionPathForPlanningTransition({
    desiredGoalExecutionPath: goalExecutionPath,
    packetExecutionPath: existingPacket.execution_path,
    goalRoutingState,
  });

  if (!resolvedExecutionPath) {
    throw new Error(buildMalformedGoalExecutionPathError({
      goalIssueNumber: normalizedIssueNumber,
      reason: "missing_execution_path_for_planning_transition",
    }));
  }

  const resolvedDecompositionState = inferDecompositionStateForPlanningTransition({
    priorState: priorStickyState,
    executionPath: resolvedExecutionPath,
  });
  if (!resolvedDecompositionState) {
    throw new Error(buildMalformedGoalExecutionPathError({
      goalIssueNumber: normalizedIssueNumber,
      reason: "missing_decomposition_state_for_planning_transition",
    }));
  }

  const normalizedPlanningArtifactPath = trim(planningArtifactPath);
  if (targetPlanningState === "pending_review" && !normalizedPlanningArtifactPath) {
    throw new Error("missing_planning_artifact_path_for_pending_review");
  }

  const carryArtifactPath = normalizedPlanningArtifactPath
    || trim(priorStickyState.planning_artifact_path);

  const signalsFromRaw = parseJson(trim(classificationSignalsRaw), {});
  const signalsFromArg = classificationSignals && typeof classificationSignals === "object" && !Array.isArray(classificationSignals)
    ? classificationSignals
    : {};
  const mergedSignals = mergeClassificationSignals(existingPacket.classification_signals, {
    transition: {
      from: trim(priorStickyState.planning_state),
      to: targetPlanningState,
    },
    ...(signalsFromRaw && typeof signalsFromRaw === "object" && !Array.isArray(signalsFromRaw)
      ? signalsFromRaw
      : {}),
    ...(signalsFromArg && typeof signalsFromArg === "object" && !Array.isArray(signalsFromArg)
      ? signalsFromArg
      : {}),
  });

  updatePersistedPacketState({
    packetPath: trim(latest.packet_path),
    packetState: PACKET_STATE_SUPERSEDED,
    statusReason: `planning_state_transition:${trim(priorStickyState.planning_state)}->${targetPlanningState}`,
  });

  const packet = buildGoalExecutionPathPacket({
    goalIssueNumber: normalizedIssueNumber,
    executionPath: resolvedExecutionPath,
    routingContractVersion: getGoalRoutingContractVersion(existingPacket),
    classificationVersion: trim(existingPacket.classification_version),
    decompositionState: resolvedDecompositionState,
    planningState: targetPlanningState,
    planningArtifactPath: carryArtifactPath,
    classifiedBy: trim(classifiedBy) || "goal.execution_path.transition",
    classificationReason: trim(classificationReason) || `planning_state_transition:${trim(priorStickyState.planning_state)}->${targetPlanningState}`,
    classificationSignals: mergedSignals,
    understandingRisk: existingPacket.understanding_risk,
    rationaleRequired: existingPacket.rationale_required === true,
    factoryId: trim(existingPacket.factory_id) || normalizedFactoryId,
    runId,
    pipeline,
    nodeId,
    targetRepo: trim(targetRepo) || trim(existingPacket.target_repo),
    controlPlaneRepo: trim(controlPlaneRepo) || trim(existingPacket.control_plane_repo),
  });

  const persisted = persistGoalExecutionPathPacket({ repo, packet });

  return {
    goal_issue_number: normalizedIssueNumber,
    execution_path: packet.execution_path,
    decomposition_state: packet.decomposition_state,
    planning_state: packet.planning_state,
    understanding_risk: packet.understanding_risk,
    rationale_required: packet.rationale_required === true,
    ...(carryArtifactPath ? { planning_artifact_path: carryArtifactPath } : {}),
    packet_id: trim(packet.packet_id),
    packet_path: trim(persisted.packet_path),
    packet_type: trim(packet.packet_type),
    schema_version: trim(packet.schema_version),
  };
}
