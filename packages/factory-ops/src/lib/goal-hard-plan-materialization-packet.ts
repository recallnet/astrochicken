import { trim } from "./cli-helpers.ts";
import {
  buildNamedPacketEnvelope,
  buildPacketTakeoverContract,
  listPersistedFactoryPackets,
  makePacketId,
  persistNamedPacket,
  validateNamedPacketBase,
  validatePacketTakeoverContract,
  validateRegisteredPacketType,
  PACKET_STATE_SUPERSEDED,
} from "./packet-core.ts";

export const GOAL_HARD_PLAN_MATERIALIZATION_PACKET_SCHEMA_VERSION = "goal_hard_plan_materialization_packet/v1";
export const GOAL_HARD_PLAN_MATERIALIZATION_PACKET_TYPE = "goal_hard_plan_materialization_packet";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeNumberList(value = []) {
  return [...new Set(asArray(value)
    .map((entry) => Number.parseInt(String(entry || "").trim(), 10))
    .filter((entry) => Number.isFinite(entry) && entry > 0))]
    .sort((left, right) => left - right);
}

function normalizeStringList(value = []) {
  return [...new Set(asArray(value)
    .map((entry) => trim(entry))
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function normalizeFeatureIssueMap(featureIssueMap = []) {
  return asArray(featureIssueMap)
    .map((entry) => {
      const featureId = trim(entry?.feature_id);
      const issueNumber = Number.parseInt(String(entry?.issue_number || "").trim(), 10);
      const issueUrl = trim(entry?.issue_url);
      const blockedByFeatureIds = normalizeStringList(entry?.blocked_by_feature_ids);
      if (!featureId || !Number.isFinite(issueNumber) || issueNumber <= 0 || !issueUrl) return null;
      return {
        feature_id: featureId,
        issue_number: issueNumber,
        issue_url: issueUrl,
        blocked_by_feature_ids: blockedByFeatureIds,
        source_goal_id: trim(entry?.source_goal_id),
        source_issue_set_id: trim(entry?.source_issue_set_id),
        parent_goal_issue_number: trim(entry?.parent_goal_issue_number),
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      const parentDiff = Number.parseInt(left.parent_goal_issue_number || "0", 10)
        - Number.parseInt(right.parent_goal_issue_number || "0", 10);
      if (parentDiff !== 0) return parentDiff;
      return left.feature_id.localeCompare(right.feature_id);
    });
}

function normalizeFactoryRequestPrerequisiteMaterialization(value = []) {
  return asArray(value)
    .map((entry) => {
      const goalId = trim(entry?.goal_id);
      const goalIssueNumber = trim(entry?.goal_issue_number);
      const issueSetId = trim(entry?.issue_set_id);
      if (!goalId || !goalIssueNumber || !issueSetId) return null;
      return {
        goal_id: goalId,
        goal_issue_number: goalIssueNumber,
        issue_set_id: issueSetId,
        feature_ids: normalizeStringList(entry?.feature_ids),
        created_issue_numbers: normalizeNumberList(entry?.created_issue_numbers),
      };
    })
    .filter(Boolean)
    .sort((left, right) => Number(left.goal_issue_number) - Number(right.goal_issue_number));
}

function normalizeBlockedByEdges(value = []) {
  return asArray(value)
    .map((entry) => {
      const issueNumber = Number.parseInt(String(entry?.issue_number || "").trim(), 10);
      if (!Number.isFinite(issueNumber) || issueNumber <= 0) return null;
      return {
        issue_number: issueNumber,
        blocked_by: normalizeNumberList(entry?.blocked_by),
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.issue_number - right.issue_number);
}

function normalizeGoalIssueMap(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries = Object.entries(value)
    .map(([goalId, issueNumber]) => [trim(goalId), Number.parseInt(String(issueNumber || "").trim(), 10)])
    .filter(([goalId, issueNumber]) => goalId && Number.isFinite(issueNumber) && issueNumber > 0)
    .sort(([left], [right]) => left.localeCompare(right));

  return Object.fromEntries(entries.map(([goalId, issueNumber]) => [goalId, String(issueNumber)]));
}

function normalizeIssueSetMap(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const entries = Object.entries(value)
    .map(([issueSetId, payload]) => {
      const normalizedIssueSetId = trim(issueSetId) || trim(payload?.issue_set_id);
      if (!normalizedIssueSetId) return null;
      return [normalizedIssueSetId, {
        issue_set_id: normalizedIssueSetId,
        title: trim(payload?.title),
        goal_ids: normalizeStringList(payload?.goal_ids),
        goal_issue_numbers: normalizeStringList(payload?.goal_issue_numbers),
        feature_ids: normalizeStringList(payload?.feature_ids),
        created_issue_numbers: normalizeNumberList(payload?.created_issue_numbers),
        created_issue_urls: normalizeStringList(payload?.created_issue_urls),
      }];
    })
    .filter(Boolean)
    .sort(([left], [right]) => left.localeCompare(right));

  return Object.fromEntries(entries);
}

function normalizeGoalFeatureIssueMap(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const entries = Object.entries(value)
    .map(([goalId, rows]) => {
      const normalizedGoalId = trim(goalId);
      if (!normalizedGoalId) return null;

      const normalizedRows = asArray(rows)
        .map((entry) => {
          const featureId = trim(entry?.feature_id);
          const issueNumber = Number.parseInt(String(entry?.issue_number || "").trim(), 10);
          const issueUrl = trim(entry?.issue_url);
          if (!featureId || !Number.isFinite(issueNumber) || issueNumber <= 0 || !issueUrl) return null;
          return {
            feature_id: featureId,
            issue_number: issueNumber,
            issue_url: issueUrl,
            issue_set_id: trim(entry?.issue_set_id),
            parent_goal_issue_number: trim(entry?.parent_goal_issue_number),
          };
        })
        .filter(Boolean)
        .sort((left, right) => {
          const issueDiff = left.issue_number - right.issue_number;
          if (issueDiff !== 0) return issueDiff;
          return left.feature_id.localeCompare(right.feature_id);
        });

      if (normalizedRows.length === 0) return null;
      return [normalizedGoalId, normalizedRows];
    })
    .filter(Boolean)
    .sort(([left], [right]) => left.localeCompare(right));

  return Object.fromEntries(entries);
}

function normalizeFinalInstantiationGoalIssueNumber(value = null) {
  if (value === null || value === undefined || trim(value) === "") return null;
  const parsed = Number.parseInt(String(value).trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function buildGoalHardPlanMaterializationPacket({
  goalIssueNumber = "",
  planPacketId = "",
  planningArtifactPath = "",
  decompositionPacketId = "",
  decompositionPacketPath = "",
  approvedFeatureIds = [],
  approvedFeatures = [],
  createdIssueNumbers = [],
  createdIssueUrls = [],
  featureIssueMap = [],
  blockedByEdges = [],
  goalBlockedByEdges = [],
  goalIssueMap = {},
  issueSetMap = {},
  prerequisiteGoalIssueNumbers = [],
  finalInstantiationGoalIssueNumber = null,
  goalFeatureIssueMap = {},
  featureMaterializationMarkers = [],
  factoryRequestPrerequisiteMaterialization = [],
  materializationState = "completed",
  factoryId = "",
  runId = "",
  pipeline = "",
  nodeId = "",
  targetRepo = "",
  controlPlaneRepo = "",
  packetState = "",
} = {}) {
  const normalizedGoalIssueNumber = trim(goalIssueNumber);
  const normalizedPlanPacketId = trim(planPacketId);
  const normalizedPlanningArtifactPath = trim(planningArtifactPath);
  const normalizedDecompositionPacketId = trim(decompositionPacketId);
  const normalizedDecompositionPacketPath = trim(decompositionPacketPath);
  const normalizedApprovedFeatureIds = normalizeStringList(approvedFeatureIds);
  const normalizedCreatedIssueNumbers = normalizeNumberList(createdIssueNumbers);
  const normalizedCreatedIssueUrls = normalizeStringList(createdIssueUrls);
  const normalizedFeatureIssueMap = normalizeFeatureIssueMap(featureIssueMap);
  const normalizedBlockedByEdges = normalizeBlockedByEdges(blockedByEdges);
  const normalizedGoalBlockedByEdges = normalizeBlockedByEdges(goalBlockedByEdges);
  const normalizedGoalIssueMap = normalizeGoalIssueMap(goalIssueMap);
  const normalizedIssueSetMap = normalizeIssueSetMap(issueSetMap);
  const normalizedPrerequisiteGoalIssueNumbers = normalizeNumberList(prerequisiteGoalIssueNumbers);
  const normalizedFinalInstantiationGoalIssueNumber = normalizeFinalInstantiationGoalIssueNumber(
    finalInstantiationGoalIssueNumber,
  );
  const normalizedGoalFeatureIssueMap = normalizeGoalFeatureIssueMap(goalFeatureIssueMap);
  const normalizedFeatureMaterializationMarkers = normalizeStringList(featureMaterializationMarkers);
  const normalizedFactoryRequestPrerequisiteMaterialization = normalizeFactoryRequestPrerequisiteMaterialization(
    factoryRequestPrerequisiteMaterialization,
  );

  return {
    ...buildNamedPacketEnvelope({
      schemaVersion: GOAL_HARD_PLAN_MATERIALIZATION_PACKET_SCHEMA_VERSION,
      packetType: GOAL_HARD_PLAN_MATERIALIZATION_PACKET_TYPE,
      packetId: makePacketId({
        packetType: GOAL_HARD_PLAN_MATERIALIZATION_PACKET_TYPE,
        identity: {
          goal_issue_number: normalizedGoalIssueNumber,
          plan_packet_id: normalizedPlanPacketId,
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
      handoffOwner: "goal.hard_plan_materialization",
      handoffKind: "goal_hard_plan_materialization",
      resourceRefs: {
        goal_issue_number: normalizedGoalIssueNumber,
        plan_packet_id: normalizedPlanPacketId,
        planning_artifact_path: normalizedPlanningArtifactPath,
        decomposition_packet_id: normalizedDecompositionPacketId,
        decomposition_packet_path: normalizedDecompositionPacketPath,
        target_repo: trim(targetRepo),
      },
      inspectionCommands: [
        "Inspect this packet before re-running approved hard-plan materialization.",
      ],
      executionCommands: [
        "Reuse recorded issue numbers and blockedBy edges when the same plan packet is replayed.",
        "Treat goal_issue_map and goal_blocked_by_edges as the canonical goal dependency wiring.",
      ],
      verifyCommands: [
        "Ensure goal_run resumes from issue execution without re-running goal_intake_decompose.",
      ],
      expectedOutcomes: [
        "Approved hard-plan materialization is exactly-once and traceable.",
      ],
      preserveWork: {
        preserve_work_required: true,
        goal_issue_number: normalizedGoalIssueNumber,
        plan_packet_id: normalizedPlanPacketId,
        created_issue_numbers: normalizedCreatedIssueNumbers,
      },
      operatorPrompt: "Treat this packet as the source of truth for approved hard-plan issue materialization results.",
    }),
    goal_issue_number: normalizedGoalIssueNumber,
    plan_packet_id: normalizedPlanPacketId,
    planning_artifact_path: normalizedPlanningArtifactPath,
    decomposition_packet_id: normalizedDecompositionPacketId,
    decomposition_packet_path: normalizedDecompositionPacketPath,
    materialization_state: trim(materializationState).toLowerCase() || "completed",
    approved_feature_ids: normalizedApprovedFeatureIds,
    approved_features: asArray(approvedFeatures)
      .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry)),
    created_issue_numbers: normalizedCreatedIssueNumbers,
    created_issue_urls: normalizedCreatedIssueUrls,
    feature_issue_map: normalizedFeatureIssueMap,
    blocked_by_edges: normalizedBlockedByEdges,
    goal_blocked_by_edges: normalizedGoalBlockedByEdges,
    goal_issue_map: normalizedGoalIssueMap,
    issue_set_map: normalizedIssueSetMap,
    prerequisite_goal_issue_numbers: normalizedPrerequisiteGoalIssueNumbers,
    final_instantiation_goal_issue_number: normalizedFinalInstantiationGoalIssueNumber,
    goal_feature_issue_map: normalizedGoalFeatureIssueMap,
    feature_materialization_markers: normalizedFeatureMaterializationMarkers,
    factory_request_prerequisite_materialization: normalizedFactoryRequestPrerequisiteMaterialization,
  };
}

export function validateGoalHardPlanMaterializationPacket(packet = {}) {
  const base = validateNamedPacketBase(packet);
  const registration = validateRegisteredPacketType({
    packetType: packet?.packet_type,
    schemaVersion: packet?.schema_version,
  });
  const errors = [...base.errors, ...registration.errors];

  if (!trim(packet?.goal_issue_number)) errors.push("missing_required_field:goal_issue_number");
  if (!trim(packet?.plan_packet_id)) errors.push("missing_required_field:plan_packet_id");
  if (!trim(packet?.planning_artifact_path)) errors.push("missing_required_field:planning_artifact_path");
  if (!trim(packet?.decomposition_packet_id)) errors.push("missing_required_field:decomposition_packet_id");
  if (!trim(packet?.decomposition_packet_path)) errors.push("missing_required_field:decomposition_packet_path");
  if (trim(packet?.materialization_state).toLowerCase() !== "completed") {
    errors.push(`invalid_materialization_state:${trim(packet?.materialization_state) || "(empty)"}`);
  }

  if (!Array.isArray(packet?.approved_features) || packet.approved_features.length === 0) {
    errors.push("missing_required_field:approved_features");
  }
  if (!Array.isArray(packet?.created_issue_numbers) || packet.created_issue_numbers.length === 0) {
    errors.push("missing_required_field:created_issue_numbers");
  }
  if (!Array.isArray(packet?.created_issue_urls) || packet.created_issue_urls.length === 0) {
    errors.push("missing_required_field:created_issue_urls");
  }

  if (Array.isArray(packet?.factory_request_prerequisite_materialization)
      && packet.factory_request_prerequisite_materialization.length > 0) {
    for (const entry of packet.factory_request_prerequisite_materialization) {
      if (!trim(entry?.goal_id)) errors.push("missing_required_field:factory_request_prerequisite_materialization.goal_id");
      if (!trim(entry?.goal_issue_number)) errors.push("missing_required_field:factory_request_prerequisite_materialization.goal_issue_number");
      if (!trim(entry?.issue_set_id)) errors.push("missing_required_field:factory_request_prerequisite_materialization.issue_set_id");
    }
  }

  if (packet?.goal_issue_map && (typeof packet.goal_issue_map !== "object" || Array.isArray(packet.goal_issue_map))) {
    errors.push("invalid_field:goal_issue_map");
  }

  if (packet?.issue_set_map && (typeof packet.issue_set_map !== "object" || Array.isArray(packet.issue_set_map))) {
    errors.push("invalid_field:issue_set_map");
  }

  if (packet?.goal_feature_issue_map && (typeof packet.goal_feature_issue_map !== "object" || Array.isArray(packet.goal_feature_issue_map))) {
    errors.push("invalid_field:goal_feature_issue_map");
  }

  if (packet?.prerequisite_goal_issue_numbers && !Array.isArray(packet.prerequisite_goal_issue_numbers)) {
    errors.push("invalid_field:prerequisite_goal_issue_numbers");
  }

  if (Object.prototype.hasOwnProperty.call(packet || {}, "final_instantiation_goal_issue_number")) {
    const rawFinalIssue = packet.final_instantiation_goal_issue_number;
    const finalIssueMissing = rawFinalIssue === null || rawFinalIssue === undefined || trim(rawFinalIssue) === "";
    const parsedFinalIssue = Number.parseInt(String(rawFinalIssue || "").trim(), 10);
    if (!finalIssueMissing && (!Number.isFinite(parsedFinalIssue) || parsedFinalIssue <= 0)) {
      errors.push("invalid_field:final_instantiation_goal_issue_number");
    }
  }

  if (packet?.feature_materialization_markers && !Array.isArray(packet.feature_materialization_markers)) {
    errors.push("invalid_field:feature_materialization_markers");
  }

  if (packet?.goal_blocked_by_edges && !Array.isArray(packet.goal_blocked_by_edges)) {
    errors.push("invalid_field:goal_blocked_by_edges");
  }

  const handoff = validatePacketTakeoverContract(packet, { required: true });
  errors.push(...handoff.errors);

  return {
    ok: errors.length === 0,
    errors,
  };
}

export function persistGoalHardPlanMaterializationPacket({ repo = "", packet = {} } = {}) {
  const validation = validateGoalHardPlanMaterializationPacket(packet);
  if (!validation.ok) {
    throw new Error(`invalid_goal_hard_plan_materialization_packet:${validation.errors.join(",")}`);
  }
  return persistNamedPacket({ repo, packet });
}

export function listGoalHardPlanMaterializationPackets({
  repo = "",
  factoryId = "",
  goalIssueNumber = "",
  planPacketId = "",
  packetState = "",
} = {}) {
  const packets = listPersistedFactoryPackets({
    repo,
    factoryId,
    packetTypes: [GOAL_HARD_PLAN_MATERIALIZATION_PACKET_TYPE],
    durableOnly: true,
    packetState,
  });

  const normalizedGoalIssueNumber = trim(goalIssueNumber);
  const normalizedPlanPacketId = trim(planPacketId);

  return packets.filter(({ packet }) => {
    if (trim(packet?.packet_state) === PACKET_STATE_SUPERSEDED) return false;
    if (normalizedGoalIssueNumber && trim(packet?.goal_issue_number) !== normalizedGoalIssueNumber) return false;
    if (normalizedPlanPacketId && trim(packet?.plan_packet_id) !== normalizedPlanPacketId) return false;
    return true;
  });
}

export function getLatestGoalHardPlanMaterializationPacket({
  repo = "",
  factoryId = "",
  goalIssueNumber = "",
  planPacketId = "",
  packetState = "",
} = {}) {
  return listGoalHardPlanMaterializationPackets({
    repo,
    factoryId,
    goalIssueNumber,
    planPacketId,
    packetState,
  })[0] || null;
}
