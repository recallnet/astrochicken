import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  mirrorCanonicalPacketPublishedSync,
  mirrorCanonicalPacketStateUpdatedSync,
} from "./canonical-packet-projection.ts";
import { trim, toCommandList, toPlainObject } from "./cli-helpers.ts";

function sanitizeSegment(value = "", fallback = "unknown") {
  const normalized = trim(value).replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normalized) return fallback;
  return normalized
    .split("/")
    .map((segment) => segment.replace(/[^a-zA-Z0-9._-]/g, "_") || fallback)
    .join("/");
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function inferRunsDirFromPacketPath(packetPath = "", runId = "") {
  const normalizedPath = trim(packetPath);
  const normalizedRunId = trim(runId);
  if (!normalizedPath || !normalizedRunId) return "";
  const marker = `/` + join(normalizedRunId, "packets").replace(/\\/g, "/");
  const normalizedFullPath = normalizedPath.replace(/\\/g, "/");
  const markerIndex = normalizedFullPath.lastIndexOf(marker);
  if (markerIndex <= 0) return "";
  return normalizedFullPath.slice(0, markerIndex);
}

export const PACKET_STATE_OPEN = "open";
export const PACKET_STATE_RESOLVED = "resolved";
export const PACKET_STATE_SUPERSEDED = "superseded";
export const PACKET_STATE_ESCALATED = "escalated";
export const PACKET_STATES = Object.freeze([
  PACKET_STATE_OPEN,
  PACKET_STATE_RESOLVED,
  PACKET_STATE_SUPERSEDED,
  PACKET_STATE_ESCALATED,
]);

export function buildNamedPacketEnvelope({
  schemaVersion = "",
  packetType = "",
  packetId = "",
  createdAt = "",
  packetState = PACKET_STATE_OPEN,
  factoryId = "",
  runId = "",
  pipeline = "",
  nodeId = "",
  targetRepo = "",
  controlPlaneRepo = "",
} = {}) {
  return {
    schema_version: trim(schemaVersion),
    packet_type: trim(packetType),
    packet_id: trim(packetId),
    created_at: trim(createdAt || new Date().toISOString()),
    packet_state: trim(packetState || PACKET_STATE_OPEN),
    factory_id: trim(factoryId),
    run_id: trim(runId),
    pipeline: trim(pipeline),
    node_id: trim(nodeId),
    target_repo: trim(targetRepo),
    control_plane_repo: trim(controlPlaneRepo),
  };
}

export function makePacketId({ packetType = "", identity = {} } = {}) {
  const seed = JSON.stringify({
    packet_type: trim(packetType),
    identity: identity && typeof identity === "object" ? identity : {},
  });
  const digest = createHash("sha256").update(seed).digest("hex").slice(0, 20);
  return `${sanitizeSegment(packetType || "packet")}_${digest}`;
}

export function validateNamedPacketBase(packet = {}) {
  const required = [
    "schema_version",
    "packet_type",
    "packet_id",
    "created_at",
  ];
  const missing = required.filter((field) => !trim(packet?.[field]));
  const state = trim(packet?.packet_state || PACKET_STATE_OPEN);
  const errors = missing.map((field) => `missing_required_field:${field}`);
  if (state && !PACKET_STATES.includes(state)) {
    errors.push(`invalid_packet_state:${state}`);
  }
  return {
    ok: errors.length === 0,
    errors,
  };
}

export function buildPacketRef(packet = {}, packetPath = "") {
  return {
    packet_type: trim(packet?.packet_type),
    schema_version: trim(packet?.schema_version),
    packet_id: trim(packet?.packet_id),
    packet_state: trim(packet?.packet_state || PACKET_STATE_OPEN),
    packet_path: trim(packetPath),
    factory_id: trim(packet?.factory_id),
    run_id: trim(packet?.run_id),
    pipeline: trim(packet?.pipeline),
    node_id: trim(packet?.node_id),
  };
}

export function buildPacketTakeoverContract({
  handoffOwner = "",
  handoffKind = "",
  resourceRefs = {},
  inspectionCommands = [],
  executionCommands = [],
  verifyCommands = [],
  expectedOutcomes = [],
  preserveWork = {},
  operatorPrompt = "",
} = {}) {
  return {
    handoff_owner: trim(handoffOwner),
    handoff_kind: trim(handoffKind),
    resource_refs: toPlainObject(resourceRefs),
    inspection_commands: toCommandList(inspectionCommands),
    execution_commands: toCommandList(executionCommands),
    verify_commands: toCommandList(verifyCommands),
    expected_outcomes: toCommandList(expectedOutcomes),
    preserve_work: toPlainObject(preserveWork),
    operator_prompt: trim(operatorPrompt),
  };
}

export function validatePacketTakeoverContract(packet = {}, { required = false } = {}) {
  const errors = [];

  if (!required) {
    return { ok: true, errors };
  }

  if (!trim(packet?.handoff_owner)) errors.push("missing_required_field:handoff_owner");
  if (!trim(packet?.handoff_kind)) errors.push("missing_required_field:handoff_kind");
  if (!trim(packet?.operator_prompt)) errors.push("missing_required_field:operator_prompt");
  if (!Array.isArray(packet?.inspection_commands)) errors.push("missing_required_field:inspection_commands");
  if (!Array.isArray(packet?.execution_commands)) errors.push("missing_required_field:execution_commands");
  if (!Array.isArray(packet?.verify_commands)) errors.push("missing_required_field:verify_commands");
  if (!Array.isArray(packet?.expected_outcomes) || packet.expected_outcomes.length === 0) {
    errors.push("missing_required_field:expected_outcomes");
  }
  if (!packet?.resource_refs || typeof packet.resource_refs !== "object" || Array.isArray(packet.resource_refs)) {
    errors.push("missing_required_field:resource_refs");
  }
  if (!packet?.preserve_work || typeof packet.preserve_work !== "object" || Array.isArray(packet.preserve_work)) {
    errors.push("missing_required_field:preserve_work");
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

export function resolvePacketStoragePath({
  repo = "",
  packetType = "",
  packetId = "",
  factoryId = "",
  runId = "",
} = {}) {
  const resolvedRepo = trim(repo) ? resolve(repo) : "";
  if (!resolvedRepo) {
    throw new Error("missing_repo_for_packet_storage");
  }

  const family = sanitizeSegment(packetType || "packet");
  const id = sanitizeSegment(packetId || "packet", "packet");
  const normalizedRunId = sanitizeSegment(runId, "");
  const normalizedFactoryId = sanitizeSegment(factoryId, "");

  let outDir = "";
  let storageClass = "";
  if (normalizedRunId && normalizedFactoryId) {
    outDir = join(resolvedRepo, ".hatch", normalizedFactoryId, "runs", normalizedRunId, "packets", family);
    storageClass = "factory_run_packet";
  } else if (normalizedFactoryId) {
    outDir = join(resolvedRepo, ".hatch", normalizedFactoryId, "packets", family);
    storageClass = "factory_packet";
  } else if (normalizedRunId) {
    outDir = join(resolvedRepo, ".hatch", "runs", normalizedRunId, "packets", family);
    storageClass = "run_packet";
  } else {
    outDir = join(resolvedRepo, ".hatch", "packets", family);
    storageClass = "repo_packet";
  }

  ensureDir(outDir);
  return {
    packet_dir: outDir,
    packet_path: join(outDir, `${id}.json`),
    storage_class: storageClass,
  };
}

export function persistNamedPacket({
  repo = "",
  packet = {},
} = {}) {
  const baseValidation = validateNamedPacketBase(packet);
  if (!baseValidation.ok) {
    throw new Error(`invalid_named_packet:${baseValidation.errors.join(",")}`);
  }

  const durableValidation = validateDurablePacketPayload(packet);
  if (!durableValidation.ok) {
    throw new Error(`invalid_durable_packet_payload:${durableValidation.errors.join(",")}`);
  }

  const resolved = resolvePacketStoragePath({
    repo,
    packetType: packet.packet_type,
    packetId: packet.packet_id,
    factoryId: packet.factory_id,
    runId: packet.run_id,
  });
  ensureDir(dirname(resolved.packet_path));
  writeFileSync(resolved.packet_path, `${JSON.stringify(packet, null, 2)}\n`, "utf8");
  // @context:integration !critical Packet writes stay file-backed for now, but
  // execution-critical reads have cut over to the canonical Postgres packet
  // projection. Mirror the publish event synchronously before returning so
  // status/snapshot surfaces cannot race a stale file edit.
  mirrorCanonicalPacketPublishedSync({
    runsDir: inferRunsDirFromPacketPath(resolved.packet_path, packet.run_id),
    context: {
      factory_id: packet.factory_id,
      repo,
    },
    packet,
    packetPath: resolved.packet_path,
    storageClass: resolved.storage_class,
    family: findPacketRegistryEntry(packet.packet_type)?.family || "",
    durable: findPacketRegistryEntry(packet.packet_type)?.durable === true,
  });
  return {
    packet_ref: buildPacketRef(packet, resolved.packet_path),
    packet_path: resolved.packet_path,
    packet_dir: resolved.packet_dir,
    storage_class: resolved.storage_class,
  };
}

export const PACKET_REGISTRY = Object.freeze([
  Object.freeze({
    packet_type: "merge_conflict_packet",
    family: "merge_conflict_packet",
    schema_version: "merge_conflict_packet/v1",
    durable: true,
    storage_class: "run_artifact",
    consumer: "supervisor.merge_conflict_resolver",
    validator: "validateMergeConflictPacket",
    takeover_contract: "merge_conflict_recovery",
  }),
  Object.freeze({
    packet_type: "incident_packet",
    family: "incident_packet",
    schema_version: "incident_packet.v1",
    durable: true,
    storage_class: "issue_artifact",
    consumer: "control_plane.incident_triage",
    validator: "validateIncidentPacket",
    takeover_contract: "control_plane_incident",
  }),
  Object.freeze({
    packet_type: "human_blocker",
    family: "human_blocker",
    schema_version: "human_blocker.v1",
    durable: true,
    storage_class: "issue_artifact",
    consumer: "supervisor.human_blocker_review",
    validator: "validateHumanBlockerPacket",
    takeover_contract: "human_blocker_review",
  }),
  Object.freeze({
    packet_type: "control_plane_blocker_review",
    family: "remediation_packet",
    schema_version: "remediation_packet/v1",
    durable: false,
    ephemeral_justification: "Supervisor-only snapshot triage hint; ownership remains in the current tick and does not require cross-tick packet replay yet.",
    storage_class: "state_snapshot",
    consumer: "supervisor.blocker_review",
    validator: "validateRemediationPacket",
  }),
  Object.freeze({
    packet_type: "orphan_feature_triage",
    family: "remediation_packet",
    schema_version: "remediation_packet/v1",
    durable: false,
    ephemeral_justification: "Transient classification suggestion generated from live issue metadata; regenerated each snapshot tick.",
    storage_class: "state_snapshot",
    consumer: "supervisor.state_snapshot",
    validator: "validateRemediationPacket",
  }),
  Object.freeze({
    packet_type: "relabel_merge_followup",
    family: "remediation_packet",
    schema_version: "remediation_packet/v1",
    durable: false,
    ephemeral_justification: "Label-normalization recommendation derived from current labels and title heuristics; safe to recompute.",
    storage_class: "state_snapshot",
    consumer: "supervisor.state_snapshot",
    validator: "validateRemediationPacket",
  }),
  Object.freeze({
    packet_type: "merge_followup_triage",
    family: "remediation_packet",
    schema_version: "remediation_packet/v1",
    durable: false,
    ephemeral_justification: "Short-lived triage suggestion for open merge-followup issues; intended for immediate supervisor review in the same snapshot cycle.",
    storage_class: "state_snapshot",
    consumer: "supervisor.state_snapshot",
    validator: "validateRemediationPacket",
  }),
  Object.freeze({
    packet_type: "unlabeled_issue_classification",
    family: "remediation_packet",
    schema_version: "remediation_packet/v1",
    durable: false,
    ephemeral_justification: "Current-state labeling prompt synthesized from live issue fields; regenerated deterministically each tick.",
    storage_class: "state_snapshot",
    consumer: "supervisor.state_snapshot",
    validator: "validateRemediationPacket",
  }),
  Object.freeze({
    packet_type: "stale_bug_recheck",
    family: "remediation_packet",
    schema_version: "remediation_packet/v1",
    durable: false,
    ephemeral_justification: "Time-window recheck reminder for stale bugs; relies on current bug age and can be recalculated without durable handoff.",
    storage_class: "state_snapshot",
    consumer: "supervisor.state_snapshot",
    validator: "validateRemediationPacket",
  }),
  Object.freeze({
    packet_type: "human_blocker_recheck",
    family: "remediation_packet",
    schema_version: "remediation_packet/v1",
    durable: false,
    ephemeral_justification: "Immediate re-evaluation hint for open human blockers; durable ownership already lives in human_blocker packets.",
    storage_class: "state_snapshot",
    consumer: "supervisor.state_snapshot",
    validator: "validateRemediationPacket",
  }),
  Object.freeze({
    packet_type: "close_stale_wave_giveup_bug",
    family: "remediation_packet",
    schema_version: "remediation_packet/v1",
    durable: false,
    ephemeral_justification: "Cleanup recommendation for stale reopen-loop bugs based on current issue state; safe to regenerate each tick.",
    storage_class: "state_snapshot",
    consumer: "supervisor.state_snapshot",
    validator: "validateRemediationPacket",
  }),
  Object.freeze({
    packet_type: "run_liveness_recovery",
    family: "remediation_packet",
    schema_version: "remediation_packet/v1",
    durable: false,
    ephemeral_justification: "Liveness sweep recommendation derived from recent runtime heartbeat state; recomputed every supervisor snapshot.",
    storage_class: "state_snapshot",
    consumer: "supervisor.state_snapshot",
    validator: "validateRemediationPacket",
  }),
  Object.freeze({
    packet_type: "local_cli_runtime_crash",
    family: "remediation_packet",
    schema_version: "remediation_packet/v1",
    durable: false,
    ephemeral_justification: "Local-factory immediate-fix instruction that should be acted on in the same coding session, not handed off across ticks.",
    storage_class: "state_snapshot",
    consumer: "supervisor.state_snapshot",
    validator: "validateRemediationPacket",
  }),
  Object.freeze({
    packet_type: "remote_cli_runtime_crash",
    family: "remediation_packet",
    schema_version: "remediation_packet/v1",
    durable: true,
    storage_class: "factory_run_packet",
    consumer: "supervisor.state_snapshot",
    validator: "validateRemediationPacket",
    takeover_contract: "supervisor_recovery",
  }),
  Object.freeze({
    packet_type: "review_harness_degradation",
    family: "remediation_packet",
    schema_version: "remediation_packet/v1",
    durable: false,
    ephemeral_justification: "Snapshot-time review-harness warning generated from recent verdict telemetry and recalculated each tick.",
    storage_class: "state_snapshot",
    consumer: "supervisor.state_snapshot",
    validator: "validateRemediationPacket",
  }),
  Object.freeze({
    packet_type: "stalled_wave_recovery",
    family: "remediation_packet",
    schema_version: "remediation_packet/v1",
    durable: false,
    ephemeral_justification: "Snapshot-time stalled-wave recommendation synthesized from recent run telemetry and regenerated each tick.",
    storage_class: "state_snapshot",
    consumer: "supervisor.state_snapshot",
    validator: "validateRemediationPacket",
  }),
  Object.freeze({
    packet_type: "unscheduled_wave_requeue",
    family: "remediation_packet",
    schema_version: "remediation_packet/v1",
    durable: false,
    ephemeral_justification: "Wave-marker requeue suggestion derived from current milestone/marker state and intended for immediate supervisor action.",
    storage_class: "state_snapshot",
    consumer: "supervisor.state_snapshot",
    validator: "validateRemediationPacket",
  }),
  Object.freeze({
    packet_type: "contract_drift_wave_cleanup",
    family: "remediation_packet",
    schema_version: "remediation_packet/v1",
    durable: false,
    ephemeral_justification: "Contract-drift cleanup recommendation computed from current run/hash comparison and refreshed each snapshot.",
    storage_class: "state_snapshot",
    consumer: "supervisor.contract_drift_review",
    validator: "validateRemediationPacket",
  }),
  Object.freeze({
    packet_type: "judge_context_contract_recovery",
    family: "remediation_packet",
    schema_version: "remediation_packet/v1",
    durable: true,
    storage_class: "factory_run_packet",
    consumer: "supervisor.judge_contract_recovery",
    validator: "validateRemediationPacket",
    takeover_contract: "supervisor_recovery",
  }),
  Object.freeze({
    packet_type: "judge_evidence_contract_recovery",
    family: "remediation_packet",
    schema_version: "remediation_packet/v1",
    durable: true,
    storage_class: "factory_run_packet",
    consumer: "supervisor.judge_contract_recovery",
    validator: "validateRemediationPacket",
    takeover_contract: "supervisor_recovery",
  }),
  Object.freeze({
    packet_type: "canonical_checkout_recovery",
    family: "remediation_packet",
    schema_version: "remediation_packet/v1",
    durable: true,
    storage_class: "factory_packet",
    consumer: "supervisor.canonical_checkout_recovery",
    validator: "validateRemediationPacket",
    takeover_contract: "supervisor_recovery",
  }),
  Object.freeze({
    packet_type: "reviewer_context_packet",
    family: "reviewer_context_packet",
    schema_version: "reviewer_context/v1",
    durable: true,
    storage_class: "artifact",
    consumer: "reviewer",
    validator: "validateReviewerContextContract",
  }),
  Object.freeze({
    packet_type: "judge_context_packet",
    family: "judge_context_packet",
    schema_version: "judge_context/v1",
    durable: true,
    storage_class: "artifact",
    consumer: "judge",
    validator: "validateJudgeContextContract",
  }),
  Object.freeze({
    packet_type: "judge_evidence_packet",
    family: "judge_evidence_packet",
    schema_version: "judge_evidence/v1",
    durable: true,
    storage_class: "artifact",
    consumer: "judge",
    validator: "validateJudgeEvidenceContract",
  }),
  Object.freeze({
    packet_type: "goal_decomposition_packet",
    family: "goal_decomposition_packet",
    schema_version: "goal_decomposition_packet/v1",
    durable: true,
    storage_class: "factory_packet",
    consumer: "goal.decomposition_dedupe",
    validator: "validateGoalDecompositionPacket",
    takeover_contract: "goal_decomposition_dedupe",
  }),
  Object.freeze({
    packet_type: "goal_execution_path_packet",
    family: "goal_execution_path_packet",
    schema_version: "goal_execution_path_packet/v1",
    durable: true,
    storage_class: "factory_packet",
    consumer: "goal.execution_path_router",
    validator: "validateGoalExecutionPathPacket",
    takeover_contract: "goal_execution_path",
  }),
  Object.freeze({
    packet_type: "goal_hard_plan_packet",
    family: "goal_hard_plan_packet",
    schema_version: "goal_hard_plan_packet/v1",
    durable: true,
    storage_class: "factory_packet",
    consumer: "goal.hard_plan_review",
    validator: "validateGoalHardPlanPacket",
    takeover_contract: "goal_hard_plan",
  }),
  Object.freeze({
    packet_type: "goal_hard_plan_materialization_packet",
    family: "goal_hard_plan_materialization_packet",
    schema_version: "goal_hard_plan_materialization_packet/v1",
    durable: true,
    storage_class: "factory_packet",
    consumer: "goal.hard_plan_materialization",
    validator: "validateGoalHardPlanMaterializationPacket",
    takeover_contract: "goal_hard_plan_materialization",
  }),
]);

export const DURABLE_PACKET_TYPES = new Set(
  PACKET_REGISTRY
    .filter((entry) => entry.durable === true)
    .map((entry) => entry.packet_type),
);

export const TAKEOVER_PACKET_TYPES = new Set(
  PACKET_REGISTRY
    .filter((entry) => trim(entry.takeover_contract || ""))
    .map((entry) => entry.packet_type),
);

export function isDurablePacketType(packetType = "") {
  return DURABLE_PACKET_TYPES.has(trim(packetType));
}

export function isTakeoverPacketType(packetType = "") {
  return TAKEOVER_PACKET_TYPES.has(trim(packetType));
}

const PACKET_REGISTRY_BY_TYPE = new Map(
  PACKET_REGISTRY.map((entry) => [entry.packet_type, entry]),
);

export function findPacketRegistryEntry(packetType = "") {
  return PACKET_REGISTRY_BY_TYPE.get(trim(packetType)) || null;
}

export function validateRegisteredPacketType({
  packetType = "",
  schemaVersion = "",
} = {}) {
  const errors = [];
  const entry = findPacketRegistryEntry(packetType);
  if (!entry) {
    errors.push(`unregistered_packet_type:${trim(packetType) || "(empty)"}`);
    return { ok: false, errors, entry: null };
  }
  if (trim(schemaVersion) && trim(schemaVersion) !== entry.schema_version) {
    errors.push(`schema_version_mismatch:${trim(schemaVersion)}!=${entry.schema_version}`);
  }
  return {
    ok: errors.length === 0,
    errors,
    entry,
  };
}

export function validateDurablePacketPayload(packet = {}) {
  const errors = [];
  const entry = findPacketRegistryEntry(packet?.packet_type);
  if (!entry) {
    return {
      ok: true,
      errors,
      entry: null,
    };
  }

  if (trim(packet?.schema_version) && trim(packet?.schema_version) !== entry.schema_version) {
    errors.push(`schema_version_mismatch:${trim(packet?.schema_version)}!=${entry.schema_version}`);
  }

  if (entry.durable === true) {
    for (const requiredField of ["packet_id", "created_at", "packet_state"]) {
      if (!trim(packet?.[requiredField])) {
        errors.push(`missing_required_field:${requiredField}`);
      }
    }
  }

  if (trim(entry.takeover_contract || "")) {
    if (!trim(packet?.handoff_owner)) errors.push("missing_required_field:handoff_owner");
    if (!trim(packet?.handoff_kind)) errors.push("missing_required_field:handoff_kind");
  }

  // Reject durable packets where resource_refs exists but every value is empty.
  // These are false-positive packets with no diagnostic data that inflate action
  // item counts and block supervisor dispatch.
  if (entry.durable === true && packet?.resource_refs && typeof packet.resource_refs === "object") {
    const refs = packet.resource_refs;
    const hasAnyValue = Object.values(refs).some((v) => {
      if (typeof v === "string") return v.trim().length > 0;
      if (Array.isArray(v)) return v.length > 0;
      if (typeof v === "number") return true;
      return Boolean(v);
    });
    if (!hasAnyValue) {
      errors.push("empty_resource_refs:all_values_empty");
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    entry,
  };
}

export function readPacketFromPath(packetPath = "") {
  const resolvedPath = trim(packetPath);
  if (!resolvedPath || !existsSync(resolvedPath)) return null;
  try {
    const packet = JSON.parse(readFileSync(resolvedPath, "utf8"));
    return packet && typeof packet === "object" ? packet : null;
  } catch {
    return null;
  }
}

export function updatePersistedPacketState({
  packetPath = "",
  packetState = "",
  statusReason = "",
  nowIso = new Date().toISOString(),
} = {}) {
  const resolvedPath = trim(packetPath);
  const nextState = trim(packetState);
  if (!resolvedPath || !existsSync(resolvedPath)) return null;
  if (!nextState) throw new Error("missing_packet_state");
  if (!PACKET_STATES.includes(nextState)) throw new Error(`invalid_packet_state:${nextState}`);

  const packet = readPacketFromPath(resolvedPath);
  if (!packet) throw new Error(`packet_read_failed:${resolvedPath}`);

  const updated = {
    ...packet,
    packet_state: nextState,
    updated_at: trim(nowIso),
  };
  if (trim(statusReason)) updated.status_reason = trim(statusReason);

  const validation = validateNamedPacketBase(updated);
  if (!validation.ok) {
    throw new Error(`invalid_named_packet:${validation.errors.join(",")}`);
  }

  const durableValidation = validateDurablePacketPayload(updated);
  if (!durableValidation.ok) {
    throw new Error(`invalid_durable_packet_payload:${durableValidation.errors.join(",")}`);
  }

  writeFileSync(resolvedPath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
  const registryEntry = findPacketRegistryEntry(updated.packet_type);
  // @context:regression !critical State transitions must hit the canonical
  // packet projection synchronously. If this mirror lags behind the file write,
  // operator surfaces can incorrectly reopen or hide packets based on timing.
  mirrorCanonicalPacketStateUpdatedSync({
    runsDir: inferRunsDirFromPacketPath(resolvedPath, updated.run_id),
    context: {
      factory_id: updated.factory_id,
      repo: updated.repo || updated.target_repo || "",
    },
    packet: updated,
    packetPath: resolvedPath,
    storageClass: registryEntry?.storage_class || "",
    family: registryEntry?.family || "",
    durable: registryEntry?.durable === true,
    statusReason,
  });
  return updated;
}

function parseJson(raw, fallback = null) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function readRunState(runsDir = "", runId = "") {
  const normalizedRunsDir = trim(runsDir);
  const normalizedRunId = trim(runId);
  if (!normalizedRunsDir || !normalizedRunId) return null;
  const statePath = join(normalizedRunsDir, normalizedRunId, "state.json");
  if (!existsSync(statePath)) return null;
  try {
    return parseJson(readFileSync(statePath, "utf8"), null);
  } catch {
    return null;
  }
}

function gitRead(args = []) {
  const run = spawnSync("git", args, { encoding: "utf8" });
  return {
    ok: run.status === 0,
    stdout: String(run.stdout || ""),
    stderr: String(run.stderr || ""),
  };
}

function hasUnmergedPaths(repoPath = "") {
  const normalizedRepoPath = trim(repoPath);
  if (!normalizedRepoPath || !existsSync(normalizedRepoPath)) return false;
  const result = gitRead(["-C", normalizedRepoPath, "diff", "--name-only", "--diff-filter=U"]);
  if (!result.ok) return false;
  return trim(result.stdout).length > 0;
}

function isBranchAncestorOfMain({ repoPath = "", branch = "" } = {}) {
  const normalizedRepoPath = trim(repoPath);
  const normalizedBranch = trim(branch);
  if (!normalizedRepoPath || !normalizedBranch || !existsSync(normalizedRepoPath)) return false;
  const result = spawnSync("git", ["-C", normalizedRepoPath, "merge-base", "--is-ancestor", normalizedBranch, "main"], { encoding: "utf8" });
  return result.status === 0;
}

function readMergeStatus(state = {}) {
  const context = state?.context && typeof state.context === "object" ? state.context : {};
  return trim(
    context?.wave_merge_status
    || context?.merge_status
    || state?.merge_status
    || "",
  ).toLowerCase();
}

function readPushStatus(state = {}) {
  const context = state?.context && typeof state.context === "object" ? state.context : {};
  return trim(
    context?.push_status
    || state?.push_status
    || "",
  ).toLowerCase();
}

function readRunStatus(state = {}) {
  return trim(state?.status || "").toLowerCase();
}

export function getPersistedPacketSupersedeReason(entry = {}, { runsDir = "" } = {}) {
  const family = trim(entry?.registry_entry?.family || "");
  if (family !== "merge_conflict_packet") return "";

  const packet = entry?.packet && typeof entry.packet === "object" ? entry.packet : {};
  const branch = trim(packet?.branch || packet?.resource_refs?.branch || "");
  const worktreeDir = trim(packet?.worktree_dir || packet?.resource_refs?.worktree_dir || "");
  const repoPath = trim(packet?.repo || packet?.resource_refs?.repo || "");
  const runId = trim(packet?.run_id || entry?.run_id || "");
  const state = readRunState(runsDir, runId);
  const mergeStatus = readMergeStatus(state);
  const pushStatus = readPushStatus(state);
  const runStatus = readRunStatus(state);
  const conflictProbePath = worktreeDir || repoPath;
  const terminalRun = runStatus === "completed" || runStatus === "failed";

  if (hasUnmergedPaths(conflictProbePath)) return "";
  if (worktreeDir && !existsSync(worktreeDir) && terminalRun) {
    return "merge_conflict_packet_obsolete:missing_conflict_worktree_after_terminal_run";
  }
  if (pushStatus === "pushed") return "merge_conflict_packet_obsolete:push_already_completed";
  if (mergeStatus === "merged" || mergeStatus === "already_merged") {
    return `merge_conflict_packet_obsolete:run_state_${mergeStatus}`;
  }
  if (isBranchAncestorOfMain({ repoPath, branch })) {
    return "merge_conflict_packet_obsolete:branch_already_on_main";
  }
  return "";
}

export function reconcilePersistedPacketEntry(entry = {}, { runsDir = "", nowIso = new Date().toISOString() } = {}) {
  const statusReason = getPersistedPacketSupersedeReason(entry, { runsDir });
  if (!statusReason) return entry;

  updatePersistedPacketState({
    packetPath: entry.packet_path,
    packetState: PACKET_STATE_SUPERSEDED,
    statusReason,
    nowIso,
  });
  return null;
}

export function listPersistedPackets({
  runsDir = "",
  packetTypes = [],
  families = [],
  durableOnly = false,
  packetState = "",
  nowMs = Date.now(),
  windowMs = 0,
  reconcile = true,
} = {}) {
  const normalizedTypes = new Set((Array.isArray(packetTypes) ? packetTypes : []).map((value) => trim(value)).filter(Boolean));
  const normalizedFamilies = new Set((Array.isArray(families) ? families : []).map((value) => trim(value)).filter(Boolean));
  const desiredState = trim(packetState);
  const packets = [];
  let runEntries = [];
  try {
    runEntries = readdirSync(runsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  } catch {
    return packets;
  }

  for (const runEntry of runEntries) {
    const runId = runEntry.name;
    const packetRoot = join(runsDir, runId, "packets");
    let familyEntries = [];
    try {
      familyEntries = readdirSync(packetRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    } catch {
      continue;
    }
    for (const familyEntry of familyEntries) {
      const familyDir = join(packetRoot, familyEntry.name);
      let packetEntries = [];
      try {
        packetEntries = readdirSync(familyDir, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
      } catch {
        continue;
      }
      for (const packetEntry of packetEntries) {
        const packetPath = join(familyDir, packetEntry.name);
        const packet = readPacketFromPath(packetPath);
        if (!packet) continue;
        const registryEntry = findPacketRegistryEntry(packet.packet_type);
        if (!registryEntry) continue;
        const entry = {
          packet,
          packet_path: packetPath,
          packet_ref: buildPacketRef(packet, packetPath),
          registry_entry: registryEntry,
          run_id: runId,
        };
        if (reconcile) {
          const reconciled = reconcilePersistedPacketEntry(entry, {
            runsDir,
            nowIso: new Date(nowMs).toISOString(),
          });
          if (!reconciled) continue;
          entry.packet = reconciled.packet;
          entry.packet_ref = reconciled.packet_ref;
        }
        if (durableOnly && registryEntry.durable !== true) continue;
        if (normalizedTypes.size > 0 && !normalizedTypes.has(trim(packet.packet_type))) continue;
        if (normalizedFamilies.size > 0 && !normalizedFamilies.has(trim(registryEntry.family))) continue;
        if (desiredState && trim(entry.packet.packet_state || PACKET_STATE_OPEN) !== desiredState) continue;
        const createdAtMs = Date.parse(String(entry.packet.created_at || ""));
        if (windowMs > 0 && Number.isFinite(createdAtMs) && (nowMs - createdAtMs) > windowMs) continue;
        packets.push(entry);
      }
    }
  }

  packets.sort((left, right) => String(right.packet?.created_at || "").localeCompare(String(left.packet?.created_at || "")));
  return packets;
}

function listPersistedPacketsFromPacketRoot({
  packetRoot = "",
  packetTypes = [],
  families = [],
  durableOnly = false,
  packetState = "",
  nowMs = Date.now(),
  windowMs = 0,
} = {}) {
  const normalizedTypes = new Set((Array.isArray(packetTypes) ? packetTypes : []).map((value) => trim(value)).filter(Boolean));
  const normalizedFamilies = new Set((Array.isArray(families) ? families : []).map((value) => trim(value)).filter(Boolean));
  const desiredState = trim(packetState);
  const packets = [];
  let familyEntries = [];
  try {
    familyEntries = readdirSync(packetRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  } catch {
    return packets;
  }

  for (const familyEntry of familyEntries) {
    const familyDir = join(packetRoot, familyEntry.name);
    let packetEntries = [];
    try {
      packetEntries = readdirSync(familyDir, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
    } catch {
      continue;
    }
    for (const packetEntry of packetEntries) {
      const packetPath = join(familyDir, packetEntry.name);
      const packet = readPacketFromPath(packetPath);
      if (!packet) continue;
      const registryEntry = findPacketRegistryEntry(packet.packet_type);
      if (!registryEntry) continue;
      if (durableOnly && registryEntry.durable !== true) continue;
      if (normalizedTypes.size > 0 && !normalizedTypes.has(trim(packet.packet_type))) continue;
      if (normalizedFamilies.size > 0 && !normalizedFamilies.has(trim(registryEntry.family))) continue;
      if (desiredState && trim(packet.packet_state || PACKET_STATE_OPEN) !== desiredState) continue;
      const createdAtMs = Date.parse(String(packet.created_at || ""));
      if (windowMs > 0 && Number.isFinite(createdAtMs) && (nowMs - createdAtMs) > windowMs) continue;
      packets.push({
        packet,
        packet_path: packetPath,
        packet_ref: buildPacketRef(packet, packetPath),
        registry_entry: registryEntry,
        run_id: trim(packet?.run_id),
      });
    }
  }

  packets.sort((left, right) => String(right.packet?.created_at || "").localeCompare(String(left.packet?.created_at || "")));
  return packets;
}

export function listPersistedFactoryPackets({
  repo = "",
  factoryId = "",
  packetTypes = [],
  families = [],
  durableOnly = false,
  packetState = "",
  nowMs = Date.now(),
  windowMs = 0,
} = {}) {
  const resolvedRepo = trim(repo) ? resolve(repo) : "";
  const normalizedFactoryId = sanitizeSegment(factoryId, "");
  if (!resolvedRepo || !normalizedFactoryId) return [];
  const packetRoot = join(resolvedRepo, ".hatch", normalizedFactoryId, "packets");
  return listPersistedPacketsFromPacketRoot({
    packetRoot,
    packetTypes,
    families,
    durableOnly,
    packetState,
    nowMs,
    windowMs,
  });
}

export function buildPacketRegistrySnapshot() {
  return {
    schema_version: "packet_registry/v1",
    generated_at: "static",
    packet_types: PACKET_REGISTRY.map((entry) => ({
      packet_type: entry.packet_type,
      family: entry.family,
      schema_version: entry.schema_version,
      durable: entry.durable === true,
      storage_class: entry.storage_class,
      consumer: entry.consumer,
      validator: entry.validator,
      takeover_contract: trim(entry.takeover_contract || ""),
      ...(entry.durable === false
        ? { ephemeral_justification: trim(entry.ephemeral_justification || "") }
        : {}),
    })).sort((left, right) => left.packet_type.localeCompare(right.packet_type)),
  };
}
