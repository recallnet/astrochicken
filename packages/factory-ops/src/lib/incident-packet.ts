import { trim, toPositiveInt } from "./cli-helpers.ts";
import { createIncidentFingerprint } from "./incident-fingerprint.ts";
import {
  buildNamedPacketEnvelope,
  buildPacketTakeoverContract,
  makePacketId,
  persistNamedPacket,
  validatePacketTakeoverContract,
  validateNamedPacketBase,
  validateRegisteredPacketType,
} from "./packet-core.ts";

function normalizeEvidenceObject(value = {}) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { ...value };
  }

  const raw = trim(value);
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { ...parsed };
    }
    return { raw };
  } catch {
    return { raw };
  }
}

function normalizeClassification(value = "") {
  const normalized = trim(value).toLowerCase();
  if (normalized === "platform" || normalized === "local" || normalized === "ambiguous" || normalized === "needs-triage") {
    return normalized;
  }
  return "ambiguous";
}

function normalizeSeverity(value = "") {
  const normalized = trim(value).toLowerCase();
  if (normalized === "blocking" || normalized === "degrading" || normalized === "informational") {
    return normalized;
  }
  return "informational";
}

function normalizeKindId(value = "") {
  const normalized = trim(value).toLowerCase();
  if (!normalized) return "unknown_kind";
  return normalized.replace(/[^a-z0-9:_-]/gi, "-") || "unknown_kind";
}

function normalizeInstanceId(value = "") {
  return trim(value) || "unknown_instance";
}

function normalizeHostId(value = "") {
  return trim(value) || "unknown_host";
}

function normalizeCrashType(value = "") {
  return trim(value).toLowerCase() || "unknown";
}

function normalizeErrorExcerpt(value = "") {
  return trim(value).slice(0, 2000);
}

function normalizeAffectedNode(value = "") {
  return trim(value) || "unknown_node";
}

function normalizeRuntimeVersion(value = "") {
  return trim(value) || "unknown_runtime";
}

function normalizeKindVersion(value = "") {
  return trim(value) || "unknown_kind_version";
}

function normalizeMutationContext(value = {}) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { ...value };
  }
  return {};
}

function resolveFingerprintSeed({
  kindId = "",
  crashType = "",
  affectedNode = "",
  errorExcerpt = "",
  runtimeVersion = "",
  kindVersion = "",
  sourceRepo = "",
  stackHash = "",
  pipeline = "",
  bugType = "",
} = {}) {
  return {
    kind_id: normalizeKindId(kindId),
    crash_type: normalizeCrashType(crashType),
    affected_node: normalizeAffectedNode(affectedNode),
    error_excerpt: normalizeErrorExcerpt(errorExcerpt),
    runtime_version: normalizeRuntimeVersion(runtimeVersion),
    kind_version: normalizeKindVersion(kindVersion),
    source_repo: trim(sourceRepo).toLowerCase(),
    stack_hash: trim(stackHash),
    pipeline: trim(pipeline),
    bug_type: trim(bugType),
  };
}

const HARD_REQUIRED_FIELDS = [
  "schema",
  "fingerprint",
  "instance_id",
  "kind_id",
  "host_id",
  "classification",
  "severity",
  "crash_type",
  "run_id",
  "error_excerpt",
  "affected_node",
  "runtime_version",
  "kind_version",
  "factory_id",
  "source_repo",
  "observed_behavior",
  "expected_behavior",
  "remediation_attempts",
  "signature_hash",
];

const VERSION_WARNING_FIELDS = ["affected_version", "required_upstream_release"];

export function buildIncidentPacket(args = {}) {
  const evidence = normalizeEvidenceObject(args.evidence);
  const sourceFactory = trim(args.source_factory || args.sourceFactory || evidence.source_factory);
  const sourceRepo = trim(args.source_repo || args.sourceRepo || evidence.source_repo);
  const runId = trim(args.run_id || args.runId || evidence.run_id);
  const node = normalizeAffectedNode(args.affected_node || args.affectedNode || args.node || evidence.affected_node || evidence.node);
  const crashType = normalizeCrashType(args.crash_type || args.crashType || evidence.crash_type);
  const errorExcerpt = normalizeErrorExcerpt(args.error_excerpt || args.errorExcerpt || evidence.error_excerpt || evidence.error);
  const classification = normalizeClassification(args.classification || evidence.classification || evidence.ownership_hint);
  const severity = normalizeSeverity(args.severity || evidence.severity);
  const kindId = normalizeKindId(args.kind_id || args.kindId || evidence.kind_id || sourceFactory);
  const runtimeVersion = normalizeRuntimeVersion(
    args.runtime_version
      || args.runtimeVersion
      || evidence.runtime_version
      || evidence.local_factory_release
      || evidence.local_factory_release_after
      || evidence.local_factory_release_before,
  );
  const kindVersion = normalizeKindVersion(
    args.kind_version
      || args.kindVersion
      || evidence.kind_version
      || evidence?.manifest_release?.tag
      || evidence.manifest_release_tag,
  );
  const instanceId = normalizeInstanceId(args.instance_id || args.instanceId || evidence.instance_id || args.factory_id || args.factoryId || evidence.factory_id);
  const hostId = normalizeHostId(args.host_id || args.hostId || evidence.host_id);
  const mutationContext = normalizeMutationContext(args.mutation_context || args.mutationContext || evidence.mutation_context);
  const signatureHash = trim(args.signature_hash || args.signatureHash || evidence.signature_hash);

  const fingerprintSeed = resolveFingerprintSeed({
    kindId,
    crashType,
    affectedNode: node,
    errorExcerpt,
    runtimeVersion,
    kindVersion,
    sourceRepo,
    stackHash: trim(args.stack_hash || args.stackHash || evidence.stack_hash),
    pipeline: trim(args.pipeline || evidence.pipeline),
    bugType: trim(args.bug_type || args.bugType || evidence.bug_type),
  });

  const fingerprint = trim(args.fingerprint || evidence.fingerprint) || createIncidentFingerprint(fingerprintSeed);

  const packetId = makePacketId({
    packetType: "incident_packet",
    identity: {
      source_factory: sourceFactory,
      source_repo: sourceRepo,
      kind_id: kindId,
      fingerprint,
    },
  });

  const packet = {
    ...buildNamedPacketEnvelope({
      schemaVersion: "incident_packet.v1",
      packetType: "incident_packet",
      packetId,
      factoryId: trim(args.factory_id || args.factoryId || evidence.factory_id),
      runId,
      pipeline: trim(args.pipeline || evidence.pipeline),
      nodeId: trim(args.node || evidence.node),
      targetRepo: sourceRepo,
      controlPlaneRepo: trim(args.control_plane_repo || args.controlPlaneRepo || evidence.control_plane_repo),
    }),
    ...buildPacketTakeoverContract({
      handoffOwner: "control_plane",
      handoffKind: "control_plane_incident",
      resourceRefs: {
        source_factory: sourceFactory,
        source_repo: sourceRepo,
        run_id: runId,
        pipeline: trim(args.pipeline || evidence.pipeline),
        node,
        fingerprint,
        kind_id: kindId,
        instance_id: instanceId,
        host_id: hostId,
        crash_type: crashType,
        classification,
        severity,
        goal_issue_number: toPositiveInt(args.goal_issue_number || args.goalIssueNumber || evidence.goal_issue_number),
        wave_issue_number: toPositiveInt(args.wave_issue_number || args.waveIssueNumber || evidence.wave_issue_number),
        milestone_title: trim(args.milestone_title || args.milestoneTitle || evidence.milestone_title),
      },
      inspectionCommands: [
        "Read the incident packet payload and confirm the fingerprint maps to the active control-plane failure signature.",
      ],
      executionCommands: [
        "File or update the owning control-plane issue and preserve the fingerprint + affected-instance evidence in-thread.",
      ],
      verifyCommands: [
        "Confirm the owning control-plane issue references this packet fingerprint, schema, and current remediation status.",
      ],
      expectedOutcomes: [
        "A control-plane owner can identify the source factory, run, crash signature, and next action from this packet alone.",
      ],
      preserveWork: {
        preserve_work_required: false,
      },
      operatorPrompt: "Use this packet as the canonical incident.v2 envelope, dedupe by fingerprint, and either update or reopen the owning control-plane issue.",
    }),
    schema: "incident.v2",
    fingerprint,
    fingerprint_seed: fingerprintSeed,
    metadata: {
      factory_id: trim(args.factory_id || args.factoryId || evidence.factory_id),
      source_factory: sourceFactory,
      source_repo: sourceRepo,
      control_plane_repo: trim(args.control_plane_repo || args.controlPlaneRepo || evidence.control_plane_repo),
    },
    mutation_context: mutationContext,
    instance_id: instanceId,
    kind_id: kindId,
    host_id: hostId,
    classification,
    severity,
    crash_type: crashType,
    error_excerpt: errorExcerpt,
    affected_node: node,
    runtime_version: runtimeVersion,
    kind_version: kindVersion,
    factory_id: trim(args.factory_id || args.factoryId || evidence.factory_id),
    control_plane_repo: trim(args.control_plane_repo || args.controlPlaneRepo || evidence.control_plane_repo),
    source_factory: sourceFactory,
    source_repo: sourceRepo,
    run_id: runId,
    pipeline: trim(args.pipeline || evidence.pipeline),
    goal_issue_number: toPositiveInt(args.goal_issue_number || args.goalIssueNumber || evidence.goal_issue_number),
    wave_issue_number: toPositiveInt(args.wave_issue_number || args.waveIssueNumber || evidence.wave_issue_number),
    milestone_title: trim(args.milestone_title || args.milestoneTitle || evidence.milestone_title),
    node: trim(args.node || evidence.node),
    phase: trim(args.phase || evidence.phase),
    affected_version: trim(args.affected_version || args.affectedVersion || evidence.affected_version),
    required_upstream_release: trim(args.required_upstream_release || args.requiredUpstreamRelease || evidence.required_upstream_release),
    observed_behavior: trim(args.observed_behavior || args.observedBehavior || evidence.observed_behavior),
    expected_behavior: trim(args.expected_behavior || args.expectedBehavior || evidence.expected_behavior),
    remediation_attempts: trim(args.remediation_attempts || args.remediationAttempts || evidence.remediation_attempts),
    ownership_hint: trim(args.ownership_hint || args.ownershipHint || evidence.ownership_hint),
    next_step_hint: trim(args.next_step_hint || args.nextStepHint || evidence.next_step_hint),
    evidence,
    signature_hash: signatureHash,
  };

  return packet;
}

export function validateIncidentPacket(packet = {}) {
  const base = validateNamedPacketBase(packet);
  const registration = validateRegisteredPacketType({
    packetType: packet?.packet_type,
    schemaVersion: packet?.schema_version,
  });
  const errors = [...base.errors, ...registration.errors];
  const validation_warnings = [];

  for (const field of HARD_REQUIRED_FIELDS) {
    if (!trim(packet?.[field])) {
      errors.push(`missing_required_field:${field}`);
    }
  }

  const classification = normalizeClassification(packet?.classification);
  if (trim(packet?.classification) && classification !== trim(packet?.classification).toLowerCase()) {
    errors.push(`invalid_classification:${trim(packet?.classification)}`);
  }

  const severity = normalizeSeverity(packet?.severity);
  if (trim(packet?.severity) && severity !== trim(packet?.severity).toLowerCase()) {
    errors.push(`invalid_severity:${trim(packet?.severity)}`);
  }

  if (trim(packet?.schema) && trim(packet?.schema) !== "incident.v2") {
    errors.push(`invalid_schema:${trim(packet?.schema)}`);
  }

  for (const field of VERSION_WARNING_FIELDS) {
    if (!trim(packet?.[field])) {
      validation_warnings.push(`missing_recommended_field:${field}`);
    }
  }

  const handoff = validatePacketTakeoverContract(packet, { required: true });
  errors.push(...handoff.errors);

  return {
    ok: errors.length === 0,
    errors,
    validation_warnings,
  };
}

export function persistIncidentPacket({ repo = "", packet = {} } = {}) {
  const validation = validateIncidentPacket(packet);
  if (!validation.ok) {
    throw new Error(`invalid_incident_packet:${validation.errors.join(",")}`);
  }
  return persistNamedPacket({ repo, packet });
}
