import {
  applyCanonicalFactoryControlActionSync,
  readCanonicalFactoryControlStateSync,
} from "./canonical-control-state.ts";
import { trim } from "./cli-helpers.ts";
import { createIncidentFingerprint } from "./incident-fingerprint.ts";
import { buildIncidentPacket, persistIncidentPacket } from "./incident-packet.ts";

const LEASE_AMBIGUITY_HANDLED = new Set();

function normalizeCandidate(candidate = {}) {
  return {
    comment_id: Number(candidate?.comment_id || 0),
    holder_id: trim(candidate?.holder_id || ""),
    run_id: trim(candidate?.run_id || ""),
    expires_at: trim(candidate?.expires_at || ""),
    status: trim(candidate?.status || ""),
    payload_invalid: candidate?.payload_invalid === true,
    active: candidate?.active === true,
    released: candidate?.released === true,
    reclaimable: candidate?.reclaimable === true,
    state_reason: trim(candidate?.state_reason || ""),
  };
}

function normalizeCandidates(candidates = []) {
  return (Array.isArray(candidates) ? candidates : [])
    .map((candidate) => normalizeCandidate(candidate))
    .sort((a, b) => a.comment_id - b.comment_id);
}

function resolveActiveCandidates(candidates = []) {
  return candidates.filter((candidate) => candidate.active && !candidate.released && !candidate.payload_invalid);
}

function summarizeActiveCandidates(activeCandidates = []) {
  return activeCandidates
    .map((candidate) => [
      `comment=${candidate.comment_id}`,
      `holder=${candidate.holder_id || "unknown_holder"}`,
      `run=${candidate.run_id || "unknown_run"}`,
      `expires=${candidate.expires_at || "unknown_expiry"}`,
    ].join(" "))
    .join("; ");
}

function toHostFromHolder(holderId = "") {
  return trim(holderId).split(":")[0] || "unknown_host";
}

function isPauseActive(value = {}) {
  return value?.action_state?.pause?.active === true;
}

export function resetLeaseSafetyIncidentCacheForTests() {
  LEASE_AMBIGUITY_HANDLED.clear();
}

export function enforceLeaseSafetyForSnapshot({
  repo = "",
  packetRepo = process.cwd(),
  controlStateRootDir = process.cwd(),
  factoryId = "",
  leaseName = "",
  runId = "",
  holderId = "",
  instanceId = "",
  hostId = "",
  runtimeVersion = "",
  snapshot = {},
  persistIncidentPacketFn = persistIncidentPacket,
  applyExternalFactoryControlActionFn = applyCanonicalFactoryControlActionSync,
  readExternalFactoryControlStateFn = readCanonicalFactoryControlStateSync,
} = {}) {
  const normalizedFactoryId = trim(factoryId);
  const normalizedLeaseName = trim(leaseName);
  const normalizedRunId = trim(runId);
  const normalizedHolderId = trim(holderId);
  const normalizedInstanceId = trim(instanceId || normalizedFactoryId) || "unknown_instance";
  const normalizedHostId = trim(hostId || toHostFromHolder(normalizedHolderId)) || "unknown_host";
  const normalizedRuntimeVersion = trim(runtimeVersion || snapshot?.lease?.runtime_version || "unknown_runtime");
  const normalizedRepo = trim(repo);

  const candidates = normalizeCandidates(snapshot?.candidates || []);
  const activeCandidates = resolveActiveCandidates(candidates);
  const ambiguous = Boolean(snapshot?.ambiguous) || activeCandidates.length > 1;

  const result = {
    ambiguous,
    candidate_count: candidates.length,
    active_candidate_count: activeCandidates.length,
    candidates,
    incident_fingerprint: "",
    incident_packet_id: "",
    incident_packet_path: "",
    incident_packet_persisted: false,
    incident_packet_persist_error: "",
    control_pause_attempted: false,
    control_pause_applied: false,
    control_pause_error: "",
    deduped: false,
  };

  if (!ambiguous) {
    return result;
  }

  const activeEvidence = activeCandidates.map((candidate) => ({
    comment_id: candidate.comment_id,
    holder_id: candidate.holder_id,
    run_id: candidate.run_id,
    expires_at: candidate.expires_at,
  }));

  const incidentFingerprint = createIncidentFingerprint({
    kind_id: normalizedFactoryId || "unknown_factory",
    crash_type: "lease_split_brain",
    affected_node: normalizedLeaseName || "distributed_lease",
    source_repo: normalizedRepo.toLowerCase(),
    lease_name: normalizedLeaseName,
    instance_id: normalizedInstanceId,
    candidates: activeEvidence,
  });

  result.incident_fingerprint = incidentFingerprint;
  const dedupeKey = `${normalizedFactoryId}:${normalizedLeaseName}:${incidentFingerprint}`;
  const shouldPersistIncident = !LEASE_AMBIGUITY_HANDLED.has(dedupeKey);
  result.deduped = !shouldPersistIncident;

  if (!shouldPersistIncident) {
    return result;
  }

  LEASE_AMBIGUITY_HANDLED.add(dedupeKey);

  const errorExcerpt = summarizeActiveCandidates(activeCandidates)
    || "ambiguous lease ownership detected";

  const packet = buildIncidentPacket({
    factory_id: normalizedFactoryId,
    source_factory: normalizedFactoryId,
    source_repo: normalizedRepo,
    control_plane_repo: normalizedRepo,
    run_id: normalizedRunId,
    pipeline: normalizedLeaseName || "distributed_lease",
    node: "factory_lease_acquire",
    phase: "lease_ambiguous",
    instance_id: normalizedInstanceId,
    kind_id: normalizedFactoryId,
    host_id: normalizedHostId,
    classification: "platform",
    severity: "blocking",
    crash_type: "lease_split_brain",
    affected_node: normalizedLeaseName || "distributed_lease",
    error_excerpt: errorExcerpt,
    runtime_version: normalizedRuntimeVersion,
    kind_version: normalizedRuntimeVersion,
    observed_behavior: "Multiple active lease owners were detected for the same factory lease key.",
    expected_behavior: "Exactly one active lease owner must exist for each (factory_id, lease_name).",
    remediation_attempts: "Lease acquisition failed closed and escalated to incident + pause workflow.",
    ownership_hint: "control_plane",
    next_step_hint: "Operator must resolve duplicate lease comments before resuming the factory instance.",
    fingerprint: incidentFingerprint,
    signature_hash: incidentFingerprint,
    evidence: {
      lease_name: normalizedLeaseName,
      holder_id: normalizedHolderId,
      run_id: normalizedRunId,
      instance_id: normalizedInstanceId,
      host_id: normalizedHostId,
      active_candidates: activeEvidence,
      candidates,
      reason: "lease_ambiguous",
    },
  });

  try {
    const persisted = persistIncidentPacketFn({
      repo: packetRepo,
      packet,
    });
    result.incident_packet_persisted = true;
    result.incident_packet_id = trim(packet?.packet_id || "");
    result.incident_packet_path = trim(persisted?.packet_path || "");
  } catch (error) {
    result.incident_packet_persist_error = trim(error?.message || error || "incident_packet_persist_failed");
  }

  try {
    const currentState = readExternalFactoryControlStateFn({
      factoryId: normalizedFactoryId,
      rootDir: controlStateRootDir,
    });

    if (isPauseActive(currentState)) {
      result.control_pause_applied = true;
      return result;
    }

    result.control_pause_attempted = true;
    const pauseOut = applyExternalFactoryControlActionFn({
      action: "pause",
      factoryId: normalizedFactoryId,
      reason: "lease_split_brain",
      actor: "lease-safety",
      rootDir: controlStateRootDir,
    });

    result.control_pause_applied = Boolean(
      pauseOut?.ok
      && (pauseOut?.state_action === "pause" || pauseOut?.state?.action_state?.pause?.active === true),
    );
    if (!result.control_pause_applied) {
      result.control_pause_error = trim(pauseOut?.error || "lease_split_brain_pause_not_applied");
    }
  } catch (error) {
    result.control_pause_error = trim(error?.message || error || "lease_split_brain_pause_failed");
  }

  return result;
}
