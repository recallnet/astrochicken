import { trim } from "./cli-helpers.ts";
import {
  buildNamedPacketEnvelope,
  buildPacketTakeoverContract,
  listPersistedFactoryPackets,
  makePacketId,
  persistNamedPacket,
  validatePacketTakeoverContract,
  validateNamedPacketBase,
  validateRegisteredPacketType,
  PACKET_STATE_SUPERSEDED,
} from "./packet-core.ts";

export const GOAL_DECOMPOSITION_PACKET_SCHEMA_VERSION = "goal_decomposition_packet/v1";
export const GOAL_DECOMPOSITION_PACKET_TYPE = "goal_decomposition_packet";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJsonArray(raw = "") {
  const value = trim(raw);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeIssueUrlArray(issueUrlsRaw = "") {
  return [...new Set(parseJsonArray(issueUrlsRaw).map((entry) => trim(entry)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function normalizeApprovedFeatures(approvedFeaturesRaw = "") {
  const parsed = parseJsonArray(approvedFeaturesRaw);
  return parsed
    .filter((entry) => isPlainObject(entry))
    .map((entry) => ({
      name: trim(entry.name),
      summary: trim(entry.summary),
      scope: trim(entry.scope),
      domain: trim(entry.domain),
      acceptance_criteria: Array.isArray(entry.acceptance_criteria)
        ? entry.acceptance_criteria.map((criterion) => trim(criterion)).filter(Boolean)
        : [],
    }));
}

function extractIssueNumberFromUrl(url = "") {
  const match = trim(url).match(/\/issues\/(\d+)(?:\/|$)/);
  return match ? match[1] : "";
}

function featureSignature(feature = {}) {
  return JSON.stringify({
    name: trim(feature.name),
    summary: trim(feature.summary),
    scope: trim(feature.scope),
    domain: trim(feature.domain),
    acceptance_criteria: Array.isArray(feature.acceptance_criteria)
      ? feature.acceptance_criteria.map((entry) => trim(entry)).filter(Boolean)
      : [],
  });
}

function normalizeGoalIssue(goalIssueRaw = "") {
  const value = trim(goalIssueRaw);
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function buildGoalDecompositionPacket({
  goalIssueRaw = "",
  goalIssueNumber = "",
  goalIssueTitle = "",
  goalIssueUrl = "",
  goalContextRaw = "",
  approvedFeaturesRaw = "",
  issueUrlsRaw = "",
  factoryId = "",
  runId = "",
  pipeline = "",
  nodeId = "",
  targetRepo = "",
  controlPlaneRepo = "",
  packetState = "",
} = {}) {
  const goalIssue = normalizeGoalIssue(goalIssueRaw);
  const approvedFeatures = normalizeApprovedFeatures(approvedFeaturesRaw);
  const issueUrls = normalizeIssueUrlArray(issueUrlsRaw);
  const issueNumbers = issueUrls
    .map((url) => extractIssueNumberFromUrl(url))
    .filter(Boolean)
    .sort((a, b) => Number(a) - Number(b));
  const normalizedGoalIssueNumber = trim(goalIssueNumber || goalIssue.number);
  const normalizedGoalIssueTitle = trim(goalIssueTitle || goalIssue.title);
  const normalizedGoalIssueUrl = trim(goalIssueUrl || goalIssue.url);
  const normalizedGoalContextRaw = trim(goalContextRaw);

  return {
    ...buildNamedPacketEnvelope({
      schemaVersion: GOAL_DECOMPOSITION_PACKET_SCHEMA_VERSION,
      packetType: GOAL_DECOMPOSITION_PACKET_TYPE,
      packetId: makePacketId({
        packetType: GOAL_DECOMPOSITION_PACKET_TYPE,
        identity: {
          factory_id: trim(factoryId),
          goal_issue_number: normalizedGoalIssueNumber,
          feature_signatures: approvedFeatures.map((feature) => featureSignature(feature)),
          created_issue_numbers: issueNumbers,
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
      handoffOwner: "goal.decomposition_dedupe",
      handoffKind: "goal_decomposition_dedupe",
      resourceRefs: {
        goal_issue_number: normalizedGoalIssueNumber,
        goal_issue_url: normalizedGoalIssueUrl,
        created_issue_numbers: issueNumbers,
        target_repo: trim(targetRepo),
      },
      inspectionCommands: [
        "Compare the current goal issue against this packet before decomposing the goal again.",
      ],
      executionCommands: [
        "If the packet still matches the goal scope, reuse the existing created issues instead of creating duplicates.",
      ],
      verifyCommands: [
        "Confirm the goal maps to the already-created issue set or record a new packet when the decomposition truly changed.",
      ],
      expectedOutcomes: [
        "A later goal run can determine whether decomposition already happened without reconstructing the state from issue comments alone.",
      ],
      preserveWork: {
        preserve_work_required: true,
        created_issue_numbers: issueNumbers,
      },
      operatorPrompt: "Start from the goal issue and this ledger packet. If the approved feature signatures still match, treat the goal as already decomposed and reuse the recorded child issues instead of creating duplicates.",
    }),
    goal_issue_number: normalizedGoalIssueNumber,
    goal_issue_title: normalizedGoalIssueTitle,
    goal_issue_url: normalizedGoalIssueUrl,
    goal_context_excerpt: normalizedGoalContextRaw ? normalizedGoalContextRaw.slice(0, 2400) : "",
    approved_features: approvedFeatures,
    feature_signatures: approvedFeatures.map((feature) => featureSignature(feature)),
    created_issue_urls: issueUrls,
    created_issue_numbers: issueNumbers,
  };
}

export function validateGoalDecompositionPacket(packet = {}) {
  const base = validateNamedPacketBase(packet);
  const registration = validateRegisteredPacketType({
    packetType: packet?.packet_type,
    schemaVersion: packet?.schema_version,
  });
  const errors = [...base.errors, ...registration.errors];
  if (!trim(packet?.goal_issue_number)) errors.push("missing_required_field:goal_issue_number");
  if (!Array.isArray(packet?.approved_features) || packet.approved_features.length === 0) {
    errors.push("missing_required_field:approved_features");
  }
  if (!Array.isArray(packet?.created_issue_urls) || packet.created_issue_urls.length === 0) {
    errors.push("missing_required_field:created_issue_urls");
  }
  const handoff = validatePacketTakeoverContract(packet, { required: true });
  errors.push(...handoff.errors);
  return {
    ok: errors.length === 0,
    errors,
  };
}

export function persistGoalDecompositionPacket({ repo = "", packet = {} } = {}) {
  const validation = validateGoalDecompositionPacket(packet);
  if (!validation.ok) {
    throw new Error(`invalid_goal_decomposition_packet:${validation.errors.join(",")}`);
  }
  return persistNamedPacket({ repo, packet });
}

export function listGoalDecompositionPackets({
  repo = "",
  factoryId = "",
  goalIssueNumber = "",
  packetState = "",
} = {}) {
  const packets = listPersistedFactoryPackets({
    repo,
    factoryId,
    packetTypes: [GOAL_DECOMPOSITION_PACKET_TYPE],
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

export function hasActiveGoalDecompositionPacket({
  repo = "",
  factoryId = "",
  goalIssueNumber = "",
} = {}) {
  return listGoalDecompositionPackets({ repo, factoryId, goalIssueNumber }).length > 0;
}
