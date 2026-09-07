import { parseJson, trim } from "./cli-helpers.ts";
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

export const GOAL_HARD_PLAN_PACKET_SCHEMA_VERSION = "goal_hard_plan_packet/v1";
export const GOAL_HARD_PLAN_PACKET_TYPE = "goal_hard_plan_packet";
export const GOAL_HARD_PLAN_VERSION = "v1";

const GOAL_HARD_PLAN_MARKER_PATTERN = /<!--\s*goal-hard-plan:(v\d+)\s+goal=([0-9]+)\s+packet=([a-zA-Z0-9._-]+)\s*-->/i;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeGoalNumber(value = "") {
  const normalized = trim(value);
  return /^\d+$/.test(normalized) ? normalized : "";
}

function normalizePlanSummary(value = "") {
  return trim(value).slice(0, 4000);
}

function normalizeArtifactRefEntry(entry) {
  if (typeof entry === "string") {
    const ref = trim(entry);
    if (!ref) return null;
    return { ref };
  }

  if (!isPlainObject(entry)) return null;

  const normalized = {
    label: trim(entry.label),
    url: trim(entry.url),
    path: trim(entry.path),
    sha256: trim(entry.sha256),
    ref: trim(entry.ref),
    type: trim(entry.type),
  };

  if (!normalized.label && !normalized.url && !normalized.path && !normalized.sha256 && !normalized.ref) {
    return null;
  }

  return normalized;
}

function normalizeArtifactRefs({ artifactRefsRaw = "", artifactRefs } = {}) {
  const fromArgument = Array.isArray(artifactRefs) ? artifactRefs : [];
  const parsed = parseJson(trim(artifactRefsRaw), []);
  const fromRaw = Array.isArray(parsed) ? parsed : [];

  const normalized = [...fromArgument, ...fromRaw]
    .map((entry) => normalizeArtifactRefEntry(entry))
    .filter(Boolean);

  const deduped = new Map();
  for (const entry of normalized) {
    deduped.set(JSON.stringify(entry), entry);
  }

  return [...deduped.values()].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

export function buildGoalHardPlanCommentMarker({ goalNumber = "", packetId = "" } = {}) {
  const normalizedGoalNumber = normalizeGoalNumber(goalNumber);
  const normalizedPacketId = trim(packetId);
  if (!normalizedGoalNumber || !normalizedPacketId) return "";
  return `<!-- goal-hard-plan:${GOAL_HARD_PLAN_VERSION} goal=${normalizedGoalNumber} packet=${normalizedPacketId} -->`;
}

export function parseGoalHardPlanCommentMarker(body = "") {
  const match = String(body || "").match(GOAL_HARD_PLAN_MARKER_PATTERN);
  if (!match) {
    return {
      found: false,
      version: "",
      goal_number: "",
      packet_id: "",
      marker: "",
    };
  }

  const marker = trim(match[0]);
  return {
    found: true,
    version: trim(match[1]),
    goal_number: trim(match[2]),
    packet_id: trim(match[3]),
    marker,
  };
}

function renderArtifactRef(entry = {}) {
  const label = trim(entry.label);
  const url = trim(entry.url);
  const path = trim(entry.path);
  const ref = trim(entry.ref);
  const sha256 = trim(entry.sha256);

  const location = url || path || ref || "(missing-location)";
  const extras = [];
  if (label) extras.push(`label=${label}`);
  if (sha256) extras.push(`sha256=${sha256}`);

  return extras.length > 0
    ? `- ${location} (${extras.join(", ")})`
    : `- ${location}`;
}

export function buildGoalHardPlanIssueComment({
  goalNumber = "",
  packetId = "",
  planSummary = "",
  artifactRefs = [],
  attachedAt = "",
} = {}) {
  const normalizedGoalNumber = normalizeGoalNumber(goalNumber);
  const normalizedPacketId = trim(packetId);
  const normalizedSummary = normalizePlanSummary(planSummary);
  const normalizedArtifactRefs = normalizeArtifactRefs({ artifactRefs });
  const marker = buildGoalHardPlanCommentMarker({
    goalNumber: normalizedGoalNumber,
    packetId: normalizedPacketId,
  });

  return [
    marker,
    "Hard-path planning artifact attached.",
    `goal_number=${normalizedGoalNumber}`,
    `packet_id=${normalizedPacketId}`,
    `plan_version=${GOAL_HARD_PLAN_VERSION}`,
    `attached_at=${trim(attachedAt) || new Date().toISOString()}`,
    `artifact_count=${normalizedArtifactRefs.length}`,
    `plan_summary=${normalizedSummary || "(missing-summary)"}`,
    ...normalizedArtifactRefs.map((entry) => renderArtifactRef(entry)),
  ].join("\n");
}

export function buildGoalHardPlanPacket({
  version = GOAL_HARD_PLAN_VERSION,
  goalNumber = "",
  packetId = "",
  planSummary = "",
  artifactRefsRaw = "",
  artifactRefs,
  commentMarker = "",
  attachedAt = "",
  attachedBy = "",
  goalIssueCommentId = "",
  goalIssueCommentUrl = "",
  factoryId = "",
  runId = "",
  pipeline = "",
  nodeId = "",
  targetRepo = "",
  controlPlaneRepo = "",
  packetState = "",
} = {}) {
  const normalizedVersion = trim(version || GOAL_HARD_PLAN_VERSION);
  const normalizedGoalNumber = normalizeGoalNumber(goalNumber);
  const normalizedPlanSummary = normalizePlanSummary(planSummary);
  const normalizedArtifactRefs = normalizeArtifactRefs({ artifactRefsRaw, artifactRefs });
  const normalizedPacketId = trim(packetId) || makePacketId({
    packetType: GOAL_HARD_PLAN_PACKET_TYPE,
    identity: {
      factory_id: trim(factoryId),
      goal_number: normalizedGoalNumber,
      plan_summary: normalizedPlanSummary,
      artifact_refs: normalizedArtifactRefs,
    },
  });
  const normalizedCommentMarker = trim(commentMarker)
    || buildGoalHardPlanCommentMarker({
      goalNumber: normalizedGoalNumber,
      packetId: normalizedPacketId,
    });

  return {
    ...buildNamedPacketEnvelope({
      schemaVersion: GOAL_HARD_PLAN_PACKET_SCHEMA_VERSION,
      packetType: GOAL_HARD_PLAN_PACKET_TYPE,
      packetId: normalizedPacketId,
      packetState,
      factoryId,
      runId,
      pipeline,
      nodeId,
      targetRepo,
      controlPlaneRepo,
    }),
    ...buildPacketTakeoverContract({
      handoffOwner: "goal.hard_plan_review",
      handoffKind: "goal_hard_plan",
      resourceRefs: {
        goal_number: normalizedGoalNumber,
        packet_id: normalizedPacketId,
        target_repo: trim(targetRepo),
      },
      inspectionCommands: [
        "Read the hard-plan packet and linked artifacts before changing ready/re-entry state.",
      ],
      executionCommands: [
        "Use this packet as the canonical planning artifact contract for post-plan human review and re-entry.",
      ],
      verifyCommands: [
        "Confirm the goal issue comment marker still points at this packet id before resuming execution.",
      ],
      expectedOutcomes: [
        "Hard-path planning artifacts are durable, goal-linked, and discoverable without checked-in temporary files.",
      ],
      preserveWork: {
        preserve_work_required: true,
        goal_number: normalizedGoalNumber,
        packet_id: normalizedPacketId,
      },
      operatorPrompt: "Treat this packet as the source of truth for hard-path planning artifacts until a newer packet supersedes it.",
    }),
    version: normalizedVersion,
    goal_number: normalizedGoalNumber,
    plan_summary: normalizedPlanSummary,
    artifact_refs: normalizedArtifactRefs,
    comment_marker: normalizedCommentMarker,
    comment_anchor: trim(normalizedCommentMarker).replace(/^<!--\s*|\s*-->$/g, ""),
    attached_at: trim(attachedAt || new Date().toISOString()),
    attached_by: trim(attachedBy),
    goal_issue_comment_id: trim(goalIssueCommentId),
    goal_issue_comment_url: trim(goalIssueCommentUrl),
  };
}

export function validateGoalHardPlanPacket(packet = {}) {
  const base = validateNamedPacketBase(packet);
  const registration = validateRegisteredPacketType({
    packetType: packet?.packet_type,
    schemaVersion: packet?.schema_version,
  });
  const errors = [...base.errors, ...registration.errors];

  if (trim(packet?.version) !== GOAL_HARD_PLAN_VERSION) {
    errors.push(`invalid_version:${trim(packet?.version) || "(empty)"}`);
  }

  const goalNumber = normalizeGoalNumber(packet?.goal_number);
  if (!goalNumber) {
    errors.push("missing_required_field:goal_number");
  }

  if (!normalizePlanSummary(packet?.plan_summary)) {
    errors.push("missing_required_field:plan_summary");
  }

  if (!Array.isArray(packet?.artifact_refs) || packet.artifact_refs.length === 0) {
    errors.push("missing_required_field:artifact_refs");
  }

  const marker = parseGoalHardPlanCommentMarker(packet?.comment_marker);
  if (!marker.found) {
    errors.push("missing_required_field:comment_marker");
  } else {
    if (marker.version !== GOAL_HARD_PLAN_VERSION) {
      errors.push(`invalid_comment_marker_version:${marker.version}`);
    }
    if (goalNumber && marker.goal_number !== goalNumber) {
      errors.push(`comment_marker_goal_mismatch:${marker.goal_number}!=${goalNumber}`);
    }
    const packetId = trim(packet?.packet_id);
    if (packetId && marker.packet_id !== packetId) {
      errors.push(`comment_marker_packet_mismatch:${marker.packet_id}!=${packetId}`);
    }
  }

  if (!trim(packet?.attached_at)) {
    errors.push("missing_required_field:attached_at");
  }

  const handoff = validatePacketTakeoverContract(packet, { required: true });
  errors.push(...handoff.errors);

  return {
    ok: errors.length === 0,
    errors,
  };
}

export function serializeToArtifact(packet = {}) {
  const validation = validateGoalHardPlanPacket(packet);
  if (!validation.ok) {
    throw new Error(`invalid_goal_hard_plan_packet:${validation.errors.join(",")}`);
  }
  return `${JSON.stringify(packet, null, 2)}\n`;
}

export function fromArtifact(artifact = "") {
  const parsed = typeof artifact === "string"
    ? parseJson(trim(artifact), null)
    : (isPlainObject(artifact) ? artifact : null);
  if (!parsed || !isPlainObject(parsed)) {
    throw new Error("invalid_goal_hard_plan_artifact:malformed_json");
  }

  const validation = validateGoalHardPlanPacket(parsed);
  if (!validation.ok) {
    throw new Error(`invalid_goal_hard_plan_packet:${validation.errors.join(",")}`);
  }
  return parsed;
}

export function persistGoalHardPlanPacket({ repo = "", packet = {} } = {}) {
  const validation = validateGoalHardPlanPacket(packet);
  if (!validation.ok) {
    throw new Error(`invalid_goal_hard_plan_packet:${validation.errors.join(",")}`);
  }
  return persistNamedPacket({ repo, packet });
}

export function listGoalHardPlanPackets({
  repo = "",
  factoryId = "",
  goalNumber = "",
  packetState = "",
} = {}) {
  const packets = listPersistedFactoryPackets({
    repo,
    factoryId,
    packetTypes: [GOAL_HARD_PLAN_PACKET_TYPE],
    durableOnly: true,
    packetState,
  });
  const normalizedGoalNumber = normalizeGoalNumber(goalNumber);

  return packets.filter(({ packet }) => {
    if (trim(packet?.packet_state) === PACKET_STATE_SUPERSEDED) return false;
    if (!normalizedGoalNumber) return true;
    return normalizeGoalNumber(packet?.goal_number) === normalizedGoalNumber;
  });
}

export function getLatestGoalHardPlanPacket({
  repo = "",
  factoryId = "",
  goalNumber = "",
  packetState = "",
} = {}) {
  return listGoalHardPlanPackets({
    repo,
    factoryId,
    goalNumber,
    packetState,
  })[0] || null;
}

export function hasGoalHardPlanPacket({
  repo = "",
  factoryId = "",
  goalNumber = "",
} = {}) {
  return listGoalHardPlanPackets({
    repo,
    factoryId,
    goalNumber,
  }).length > 0;
}

export function inspectGoalHardPlanAttachment({
  repo = "",
  factoryId = "",
  goalNumber = "",
} = {}) {
  const normalizedGoalNumber = normalizeGoalNumber(goalNumber);
  const latest = getLatestGoalHardPlanPacket({
    repo,
    factoryId,
    goalNumber: normalizedGoalNumber,
  });

  if (!latest) {
    return {
      attached: false,
      goal_number: normalizedGoalNumber,
    };
  }

  const packet = latest.packet || {};
  return {
    attached: true,
    goal_number: normalizeGoalNumber(packet.goal_number),
    packet_id: trim(packet.packet_id),
    packet_state: trim(packet.packet_state),
    packet_path: trim(latest.packet_path),
    plan_summary: normalizePlanSummary(packet.plan_summary),
    artifact_refs: Array.isArray(packet.artifact_refs) ? packet.artifact_refs : [],
    comment_marker: trim(packet.comment_marker),
    comment_anchor: trim(packet.comment_anchor),
    attached_at: trim(packet.attached_at),
    goal_issue_comment_id: trim(packet.goal_issue_comment_id),
    goal_issue_comment_url: trim(packet.goal_issue_comment_url),
  };
}
