import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { emitGovernedOtelEvent } from "@recallnet/factory-telemetry";

import { classifySupervisorFailure, deriveIncidentSeverity } from "../../commands/supervisor-failure-classifier.ts";
import { trim, gh, ghJson, parseJson } from "../cli-helpers.ts";
import {
  FACTORY_LABEL_KEYS,
  ensureFactoryLabels,
  getFactoryLabelName,
} from "../factory-label-contract.ts";
import { buildIncidentPacket, validateIncidentPacket } from "../incident-packet.ts";

function sigFor({ artifactType, classification, summary, evidence }) {
  const seed = JSON.stringify({ artifactType, classification, summary, evidence: String(evidence || "").slice(0, 2000) });
  return `sha256:${createHash("sha256").update(seed).digest("hex")}`;
}

const MOTHERSHIP_FACTORY_ID = "mothership";
const ARTIFACTS_LABEL = getFactoryLabelName(MOTHERSHIP_FACTORY_ID, FACTORY_LABEL_KEYS.ARTIFACTS);
const BUG_LABEL = getFactoryLabelName(MOTHERSHIP_FACTORY_ID, FACTORY_LABEL_KEYS.BUG);
const GOAL_LABEL = getFactoryLabelName(MOTHERSHIP_FACTORY_ID, FACTORY_LABEL_KEYS.GOAL);
const READY_LABEL = getFactoryLabelName(MOTHERSHIP_FACTORY_ID, FACTORY_LABEL_KEYS.READY);
const MANAGED_FACTORY_BUG_LABEL = getFactoryLabelName(MOTHERSHIP_FACTORY_ID, FACTORY_LABEL_KEYS.MANAGED_FACTORY_BUG);
const INCIDENT_FINGERPRINT_LABEL = getFactoryLabelName(MOTHERSHIP_FACTORY_ID, FACTORY_LABEL_KEYS.INCIDENT_FINGERPRINT);
const EXAMPLE_TRADING_FACTORY_LABEL = getFactoryLabelName("example-trading", FACTORY_LABEL_KEYS.FACTORY_EXAMPLE_TRADING);

const INCIDENT_METADATA_MARKER_PREFIX = "incident-metadata:";
const INCIDENT_SECTION_HEADING = "## Affected Instances";
const INCIDENT_SEVERITY_RANK = Object.freeze({
  informational: 0,
  degrading: 1,
  blocking: 2,
});
const DEFAULT_INCIDENT_NEEDS_REVIEW_QUEUE_PATH = ".hatch/runs/supervisor/needs-review/incident-emission.ndjson";

function resolveNeedsReviewQueuePath(customPath = "") {
  const normalized = trim(customPath);
  return resolve(normalized || DEFAULT_INCIDENT_NEEDS_REVIEW_QUEUE_PATH);
}

function enqueueIncidentNeedsReview({
  reason = "",
  repo = "",
  bugType = "",
  summary = "",
  runId = "",
  fingerprint = "",
  signature = "",
  sourceRepo = "",
  sourceFactory = "",
  details = {},
  queuePath = "",
} = {}) {
  const resolvedPath = resolveNeedsReviewQueuePath(queuePath);
  const entry = {
    schema_version: "incident.needs_review.v1",
    enqueued_at: new Date().toISOString(),
    reason: trim(reason),
    repo: trim(repo),
    source_repo: trim(sourceRepo),
    source_factory: trim(sourceFactory),
    bug_type: trim(bugType),
    summary: trim(summary),
    run_id: trim(runId),
    fingerprint: trim(fingerprint),
    signature_hash: trim(signature),
    details: details && typeof details === "object" ? details : {},
  };

  try {
    mkdirSync(dirname(resolvedPath), { recursive: true });
    appendFileSync(resolvedPath, `${JSON.stringify(entry)}\n`, "utf8");
    return { ok: true, queue_path: resolvedPath, queue_error: "" };
  } catch (error) {
    return {
      ok: false,
      queue_path: resolvedPath,
      queue_error: `incident_needs_review_enqueue_failed:${String(error?.message || error || "unknown_error")}`,
    };
  }
}

function emitIncidentDedupDecision({
  repo = "",
  sourceRepo = "",
  sourceFactory = "",
  bugType = "",
  fingerprint = "",
  issueNumber = "",
  issueState = "",
  decision = "",
  runId = "",
  pipeline = "",
} = {}) {
  emitGovernedOtelEvent({
    event_name: "factory.supervisor.incident_dedup",
    severity_text: "INFO",
    correlation: {
      factory_id: MOTHERSHIP_FACTORY_ID,
      run_id: trim(runId) || "supervisor-loop",
      workflow_id: trim(pipeline) || "ops",
      capability_id: "supervisor",
      owner: "factory_ops.supervisor_artifact",
    },
    attributes: {
      repo: trim(repo),
      source_repo: trim(sourceRepo),
      source_factory: trim(sourceFactory),
      bug_type: trim(bugType),
      incident_fingerprint: trim(fingerprint),
      issue_number: trim(issueNumber),
      issue_state: trim(issueState),
      dedup_decision: trim(decision),
      pipeline: trim(pipeline),
    },
    body: {},
  });
}

function buildBody({ repo, artifactType, classification, summary, evidence, runId, pipeline, goalIngest, signature }) {
  return [
    goalIngest ? "Machine-generated supervisor artifact." : "Machine-generated supervisor telemetry.",
    "",
    `Summary: ${summary}`,
    "",
    "```json",
    JSON.stringify({
      schema_version: "artifact.v1",
      goal_ingest: goalIngest ? "true" : "false",
      factory_id: "mothership/factory_supervisor",
      artifact_type: artifactType,
      kind: artifactType,
      classification: String(classification || ""),
      source_repo: repo,
      run_id: String(runId || "supervisor-loop"),
      pipeline: String(pipeline || ""),
      summary,
      evidence,
      signature_hash: signature,
    }, null, 2),
    "```",
    `Artifact-Signature: ${signature}`,
  ].join("\n");
}

export function emitSupervisorArtifact({
  repo,
  artifactType,
  classification = "",
  summary,
  evidence,
  runId = "",
  pipeline = "",
  goalIngest = false,
} = {}) {
  if (!repo || !artifactType || !summary) return { ok: false, issue_url: "", error: "missing_artifact_fields" };

  const normalizedClassification = String(classification || "").trim();
  const signature = sigFor({ artifactType, classification: normalizedClassification, summary, evidence });
  const normalizedPipeline = pipeline || "ops";

  if (!goalIngest) {
    emitGovernedOtelEvent({
      event_name: "factory.supervisor.telemetry",
      severity_text: "INFO",
      correlation: {
        factory_id: "mothership/factory_supervisor",
        run_id: String(runId || "supervisor-loop"),
        workflow_id: String(normalizedPipeline || "ops"),
        capability_id: "supervisor",
        owner: "factory_ops.supervisor_artifact",
      },
      attributes: {
        source_repo: repo,
        artifact_type: artifactType,
        classification: normalizedClassification,
        summary,
        pipeline: String(normalizedPipeline || ""),
        signature_hash: signature,
      },
      body: {
        evidence,
      },
    });
    return { ok: true, issue_url: "", error: "" };
  }

  ensureFactoryLabels({
    repo,
    factoryId: MOTHERSHIP_FACTORY_ID,
    keys: [FACTORY_LABEL_KEYS.ARTIFACTS],
    ghExec: gh,
  });

  const title = `[artifact] factory-supervisor: ${artifactType} (${normalizedPipeline})`;
  const body = buildBody({ repo, artifactType, classification: normalizedClassification, summary, evidence, runId, pipeline: normalizedPipeline, goalIngest: true, signature });

  const existing = ghJson([
    "issue", "list", "--repo", repo, "--state", "open", "--label", ARTIFACTS_LABEL, "--limit", "200",
    "--json", "number,title,body,url",
  ], []).find((i) => String(i?.title || "") === title && String(i?.body || "").includes(`Artifact-Signature: ${signature}`));

  if (existing?.url) {
    return { ok: true, issue_url: String(existing.url), error: "" };
  }

  const existingGoal = ghJson([
    "issue", "list", "--repo", repo, "--state", "open", "--label", GOAL_LABEL, "--limit", "200",
    "--json", "number,title,body,url",
  ], []).find((i) => String(i?.body || "").includes(`Artifact-Signature: ${signature}`));

  if (existingGoal?.url) {
    return { ok: true, issue_url: "", error: "existing_open_goal_for_signature" };
  }

  const out = gh(["issue", "create", "--repo", repo, "--title", title, "--body", body, "--label", ARTIFACTS_LABEL]);
  if (!out.ok) return { ok: false, issue_url: "", error: (out.stderr || out.stdout || "artifact create failed").trim() };
  return { ok: true, issue_url: String(out.stdout || "").trim(), error: "" };
}

function parsePositiveIssueNumber(value) {
  const n = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function extractWaveGiveupSourceIssueNumber({ summary = "", evidence = {} } = {}) {
  const fromEvidence = parsePositiveIssueNumber(evidence?.issue_number);
  if (fromEvidence > 0) return fromEvidence;
  const summaryMatch = String(summary || "").match(/Issue\s*#(\d+)\s+gave\s+up/i);
  return summaryMatch ? parsePositiveIssueNumber(summaryMatch[1]) : 0;
}

function shouldSuppressWaveGiveupReopen({ repo = "", bugType = "", summary = "", evidence = {}, ghJsonFn = ghJson } = {}) {
  if (!String(bugType || "").startsWith("wave-issue-giveup-")) return false;
  const sourceIssueNumber = extractWaveGiveupSourceIssueNumber({ summary, evidence });
  if (sourceIssueNumber <= 0) return false;
  const issue = ghJsonFn([
    "issue", "view", String(sourceIssueNumber), "--repo", String(repo || ""), "--json", "state",
  ], {});
  return String(issue?.state || "").trim().toUpperCase() === "CLOSED";
}

function normalizeLabelList(labels = []) {
  return Array.from(new Set((Array.isArray(labels) ? labels : [])
    .map((label) => trim(label))
    .filter(Boolean)));
}

function shouldApplyReplayLabManagedLabels({ repo = "", sourceRepo = "" } = {}) {
  return trim(repo).toLowerCase() === "recallnet/astrochicken"
    && trim(sourceRepo).toLowerCase() === "example-org/example-trading";
}

function resolveBugLabels({ repo = "", sourceRepo = "", labels = [], incidentPacket = {} } = {}) {
  const resolved = [BUG_LABEL, GOAL_LABEL, READY_LABEL, INCIDENT_FINGERPRINT_LABEL, ...normalizeLabelList(labels)];
  if (shouldApplyReplayLabManagedLabels({ repo, sourceRepo })) {
    resolved.push(MANAGED_FACTORY_BUG_LABEL, EXAMPLE_TRADING_FACTORY_LABEL);
  }

  const kindLabel = trim(incidentPacket?.kind_id || "").toLowerCase();
  if (kindLabel && kindLabel !== "unknown_kind") {
    resolved.push(`kind:${kindLabel}`);
  }

  if (kindLabel && trim(incidentPacket?.source_repo || "").toLowerCase() !== trim(repo).toLowerCase()) {
    resolved.push(MANAGED_FACTORY_BUG_LABEL);
  }

  return Array.from(new Set(resolved));
}

function ensureBugLabels({ repo = "", labels = [], ghExec = gh } = {}) {
  const normalizedRepo = trim(repo);
  for (const label of normalizeLabelList(labels)) {
    const description = label === BUG_LABEL
      ? "Factory bug — fast-track fix required"
      : `Factory label: ${label}`;
    const color = label === BUG_LABEL ? "d73a4a" : "5319e7";
    ghExec(["label", "create", label, "--repo", normalizedRepo, "--description", description, "--color", color]);
  }
}

function asEvidenceObject(evidence = {}) {
  if (evidence && typeof evidence === "object" && !Array.isArray(evidence)) {
    return evidence;
  }
  const parsed = parseJson(String(evidence || ""), {});
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

function normalizeSeverity(value = "") {
  const normalized = trim(value).toLowerCase();
  return Object.prototype.hasOwnProperty.call(INCIDENT_SEVERITY_RANK, normalized)
    ? normalized
    : "informational";
}

function normalizeClassification(value = "") {
  const normalized = trim(value).toLowerCase();
  if (normalized === "platform" || normalized === "local" || normalized === "ambiguous" || normalized === "needs-triage") {
    return normalized;
  }
  return "ambiguous";
}

function normalizeIncidentClassification(value = "") {
  const normalized = trim(value).toLowerCase();
  if (normalized === "platform" || normalized === "local" || normalized === "needs-triage") return normalized;
  if (normalized === "needs_triage") return "needs-triage";
  return "needs-triage";
}

function coerceAffectedInstance(entry = {}) {
  const normalized = {
    instance_id: trim(entry.instance_id || ""),
    kind_id: trim(entry.kind_id || ""),
    host_id: trim(entry.host_id || ""),
    source_repo: trim(entry.source_repo || ""),
    run_id: trim(entry.run_id || ""),
    severity: normalizeSeverity(entry.severity || ""),
    classification: normalizeClassification(entry.classification || ""),
  };
  return normalized;
}

function sortAffectedInstances(instances = []) {
  return [...instances]
    .map((entry) => coerceAffectedInstance(entry))
    .filter((entry) => Boolean(entry.instance_id))
    .sort((left, right) => {
      const byInstance = left.instance_id.localeCompare(right.instance_id);
      if (byInstance !== 0) return byInstance;
      const byRun = left.run_id.localeCompare(right.run_id);
      if (byRun !== 0) return byRun;
      return left.source_repo.localeCompare(right.source_repo);
    });
}

function readIncidentMetadataMarker(body = "") {
  const match = String(body || "").match(/<!--\s*incident-metadata:\s*([\s\S]*?)\s*-->/i);
  if (!match) return {};
  try {
    const parsed = JSON.parse(String(match[1] || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function renderIncidentMetadataMarker(metadata = {}) {
  return `<!-- ${INCIDENT_METADATA_MARKER_PREFIX} ${JSON.stringify(metadata)} -->`;
}

function renderAffectedInstancesSection(instances = []) {
  const normalized = sortAffectedInstances(instances);
  const lines = [INCIDENT_SECTION_HEADING];
  if (normalized.length === 0) {
    lines.push("- _None recorded yet._");
    return lines.join("\n");
  }
  for (const entry of normalized) {
    lines.push(`- \`${entry.instance_id}\` (kind=${entry.kind_id || "unknown"}, host=${entry.host_id || "unknown"}, run=${entry.run_id || "unknown"}, severity=${entry.severity}, classification=${entry.classification})`);
  }
  return lines.join("\n");
}

function upsertIncidentFingerprintLine(body = "", fingerprint = "") {
  const normalizedBody = String(body || "").trimEnd();
  const line = `Incident-Fingerprint: ${fingerprint}`;
  if (/^Incident-Fingerprint:\s*sha256:[0-9a-f]+$/im.test(normalizedBody)) {
    return normalizedBody.replace(/^Incident-Fingerprint:\s*sha256:[0-9a-f]+$/im, line);
  }
  return `${normalizedBody}\n\n${line}`.trim();
}

function upsertIncidentMetadataMarker(body = "", metadata = {}) {
  const marker = renderIncidentMetadataMarker(metadata);
  if (/<!--\s*incident-metadata:[\s\S]*?-->/i.test(body)) {
    return String(body || "").replace(/<!--\s*incident-metadata:[\s\S]*?-->/i, marker);
  }
  return `${String(body || "").trimEnd()}\n${marker}`.trim();
}

function upsertAffectedInstancesSection(body = "", instances = []) {
  const section = renderAffectedInstancesSection(instances);
  const pattern = /## Affected Instances[\s\S]*?(?=\n## |\n<!--\s*incident-metadata:|$)/i;
  if (pattern.test(body)) {
    return String(body || "").replace(pattern, `${section}\n`);
  }
  return `${String(body || "").trimEnd()}\n\n${section}`.trim();
}

function withIncidentMetadataInBody({ body = "", fingerprint = "", metadata = {} } = {}) {
  let nextBody = String(body || "");
  nextBody = upsertIncidentFingerprintLine(nextBody, fingerprint);
  nextBody = upsertIncidentMetadataMarker(nextBody, metadata);
  nextBody = upsertAffectedInstancesSection(nextBody, metadata.affected_instances || []);
  return `${nextBody.trimEnd()}\n`;
}

function extractIncidentFingerprintFromIssueBody(body = "") {
  const fingerprintLine = String(body || "").match(/Incident-Fingerprint:\s*(sha256:[a-f0-9]+)/i);
  if (fingerprintLine) return trim(fingerprintLine[1]);
  const metadata = readIncidentMetadataMarker(body);
  if (trim(metadata?.fingerprint)) return trim(metadata.fingerprint);
  const packetMatch = String(body || "").match(/"fingerprint"\s*:\s*"(sha256:[^"]+)"/i);
  return packetMatch ? trim(packetMatch[1]) : "";
}

function maxSeverity(left = "", right = "") {
  const a = normalizeSeverity(left);
  const b = normalizeSeverity(right);
  return (INCIDENT_SEVERITY_RANK[b] > INCIDENT_SEVERITY_RANK[a]) ? b : a;
}

function mergeIncidentMetadata({ existing = {}, incidentPacket = {}, sourceFactory = "", sourceRepo = "" } = {}) {
  const existingInstances = Array.isArray(existing.affected_instances) ? existing.affected_instances : [];
  const candidate = coerceAffectedInstance({
    instance_id: incidentPacket.instance_id,
    kind_id: incidentPacket.kind_id,
    host_id: incidentPacket.host_id,
    source_repo: incidentPacket.source_repo || sourceRepo,
    run_id: incidentPacket.run_id,
    severity: incidentPacket.severity,
    classification: incidentPacket.classification,
  });

  const mergedMap = new Map();
  for (const entry of sortAffectedInstances(existingInstances)) {
    mergedMap.set(entry.instance_id, entry);
  }
  if (candidate.instance_id) {
    const previous = mergedMap.get(candidate.instance_id);
    if (!previous) {
      mergedMap.set(candidate.instance_id, candidate);
    } else {
      mergedMap.set(candidate.instance_id, {
        ...previous,
        ...candidate,
        severity: maxSeverity(previous.severity, candidate.severity),
      });
    }
  }

  const mergedClassification = normalizeClassification(
    trim(existing.classification) && trim(existing.classification) !== "ambiguous"
      ? existing.classification
      : incidentPacket.classification,
  );

  return {
    schema: "incident.v2",
    fingerprint: trim(incidentPacket.fingerprint || existing.fingerprint),
    severity: maxSeverity(existing.severity, incidentPacket.severity),
    classification: mergedClassification,
    kind_id: trim(incidentPacket.kind_id || existing.kind_id),
    source_factory: trim(sourceFactory || existing.source_factory),
    source_repo: trim(sourceRepo || incidentPacket.source_repo || existing.source_repo),
    affected_instances: sortAffectedInstances([...mergedMap.values()]),
  };
}

function buildReopenComment({ runId = "", evidence = {}, sourceRepo = "" } = {}) {
  const payload = asEvidenceObject(evidence);
  const packet = {
    run_id: trim(payload.run_id || runId || ""),
    node: trim(payload.node || ""),
    error: trim(payload.error || payload.error_excerpt || ""),
    classification: trim(payload.classification || payload.ownership_hint || ""),
    source_repo: trim(payload.source_repo || sourceRepo || ""),
  };
  const compact = Object.fromEntries(Object.entries(packet).filter(([, value]) => Boolean(trim(value))));
  return [
    `Re-detected by supervisor (run: ${trim(runId) || "tick"}). Reopening with latest evidence.`,
    "",
    "```json",
    JSON.stringify(compact, null, 2),
    "```",
  ].join("\n");
}

function buildIncidentDedupComment({ incidentPacket = {}, sourceFactory = "", sourceRepo = "", reopened = false } = {}) {
  const payload = {
    schema: "incident.v2",
    fingerprint: trim(incidentPacket.fingerprint),
    instance_id: trim(incidentPacket.instance_id),
    kind_id: trim(incidentPacket.kind_id),
    host_id: trim(incidentPacket.host_id),
    source_factory: trim(sourceFactory || incidentPacket.source_factory),
    source_repo: trim(sourceRepo || incidentPacket.source_repo),
    run_id: trim(incidentPacket.run_id),
    classification: trim(incidentPacket.classification),
    severity: trim(incidentPacket.severity),
    crash_type: trim(incidentPacket.crash_type),
    affected_node: trim(incidentPacket.affected_node),
    runtime_version: trim(incidentPacket.runtime_version),
    kind_version: trim(incidentPacket.kind_version),
  };

  return [
    reopened
      ? "Incident fingerprint matched a previously closed issue; reopening and appending latest affected-instance evidence."
      : "Incident fingerprint matched an existing issue; appending latest affected-instance evidence.",
    "",
    "```json",
    JSON.stringify(payload, null, 2),
    "```",
  ].join("\n");
}

export function resolveBugSignature({
  bugType = "",
  summary = "",
  evidence = {},
  signatureHash = "",
} = {}) {
  const override = trim(signatureHash);
  if (override) return override;

  const evidenceObject = asEvidenceObject(evidence);
  const normalizedBugType = trim(bugType);
  const recurrenceKey = trim(evidenceObject?.recurrence_key);
  if (normalizedBugType === "factory_design_defect" && recurrenceKey) {
    return sigFor({
      artifactType: normalizedBugType,
      summary: recurrenceKey,
      evidence: JSON.stringify({ recurrence_key: recurrenceKey }),
    });
  }

  return sigFor({ artifactType: normalizedBugType, summary, evidence });
}

// File a bug issue with dedup. Bugs are fast-tracked by the supervisor (dispatched before normal goals).
// Searches both open AND recently-closed issues for dedup to prevent create→close→create loops.
export function emitBugIssue({
  repo,
  bugType,
  summary,
  evidence,
  labels = [],
  runId = "",
  pipeline = "",
  signatureHash = "",
  factoryId = "mothership/factory_supervisor",
  sourceFactory = "",
  sourceRepo = "",
  classification = "",
  severity = "",
  crashType = "",
  runtimeVersion = "",
  kindVersion = "",
  kindId = "",
  instanceId = "",
  hostId = "",
  fingerprint = "",
  mutationContext = {},
  needsReviewQueuePath = "",
  ghExec = gh,
  ghJsonFn = ghJson,
  ensureBugLabelsFn = ensureBugLabels,
} = {}) {
  if (!repo || !bugType || !summary) return { ok: false, issue_url: "", error: "missing_bug_fields" };

  const normalizedRepo = trim(repo);
  const evidenceObject = asEvidenceObject(evidence);
  const normalizedFactoryId = trim(factoryId) || "mothership/factory_supervisor";
  const normalizedSourceFactory = trim(sourceFactory || evidenceObject.source_factory);
  const normalizedSourceRepo = trim(sourceRepo || evidenceObject.source_repo) || normalizedRepo;
  const normalizedRunId = String(runId || "supervisor-loop");
  const signature = resolveBugSignature({ bugType, summary, evidence, signatureHash });
  const normalizedPipeline = pipeline || "ops";

  const factoryIdentity = evidenceObject.factory_identity && typeof evidenceObject.factory_identity === "object"
    ? evidenceObject.factory_identity
    : {};

  const sourceSnapshot = evidenceObject.supervisor_state_snapshot && typeof evidenceObject.supervisor_state_snapshot === "object"
    ? evidenceObject.supervisor_state_snapshot
    : evidenceObject.snapshot && typeof evidenceObject.snapshot === "object"
      ? evidenceObject.snapshot
      : {};

  const classifier = classifySupervisorFailure({
    bugType,
    evidence: evidenceObject,
    sourceRepo: normalizedSourceRepo,
    controlPlaneRepo: normalizedRepo,
    sourceFactory: normalizedSourceFactory,
    factoryId: normalizedFactoryId,
    classificationHint: classification || evidenceObject.classification,
    crashTypeHint: crashType || evidenceObject.crash_type,
  });

  const resolvedClassification = normalizeIncidentClassification(
    classification || classifier.classification || evidenceObject.classification || evidenceObject.ownership_hint,
  );
  if (!trim(resolvedClassification)) {
    const queue = enqueueIncidentNeedsReview({
      reason: "incident_classification_unresolved",
      repo: normalizedRepo,
      bugType,
      summary,
      runId: normalizedRunId,
      fingerprint,
      signature,
      sourceRepo: normalizedSourceRepo,
      sourceFactory: normalizedSourceFactory,
      details: {
        classifier,
        evidence_keys: Object.keys(evidenceObject || {}),
      },
      queuePath: needsReviewQueuePath,
    });
    return {
      ok: false,
      issue_url: "",
      error: "incident_classification_unresolved",
      queue_path: queue.queue_path,
      queue_error: queue.queue_error,
    };
  }

  const resolvedCrashType = trim(
    crashType || classifier.crash_type || evidenceObject.crash_type,
  ).toLowerCase();
  if (!resolvedCrashType || resolvedCrashType === "unknown") {
    const queue = enqueueIncidentNeedsReview({
      reason: "incident_crash_type_unresolved",
      repo: normalizedRepo,
      bugType,
      summary,
      runId: normalizedRunId,
      fingerprint,
      signature,
      sourceRepo: normalizedSourceRepo,
      sourceFactory: normalizedSourceFactory,
      details: {
        classifier,
      },
      queuePath: needsReviewQueuePath,
    });
    return {
      ok: false,
      issue_url: "",
      error: "incident_crash_type_unresolved",
      queue_path: queue.queue_path,
      queue_error: queue.queue_error,
    };
  }

  const resolvedSeverity = normalizeSeverity(
    severity || deriveIncidentSeverity({ classification: resolvedClassification, crashType: resolvedCrashType, bugType }),
  );

  const resolvedKindId =
    kindId
    || evidenceObject.kind_id
    || trim(factoryIdentity.kind_id)
    || normalizedSourceFactory
    || "unknown_kind";

  const resolvedInstanceId =
    instanceId
    || evidenceObject.instance_id
    || trim(factoryIdentity.instance_id)
    || normalizedFactoryId;

  const resolvedHostId =
    hostId
    || evidenceObject.host_id
    || trim(factoryIdentity.host_id)
    || "unknown_host";

  const resolvedRuntimeVersion =
    runtimeVersion
    || evidenceObject.runtime_version
    || evidenceObject.local_factory_release
    || trim(sourceSnapshot.runtime_version)
    || "unknown_runtime";

  const resolvedKindVersion =
    kindVersion
    || evidenceObject.kind_version
    || evidenceObject.manifest_release_tag
    || trim(sourceSnapshot.kind_version)
    || "unknown_kind_version";

  const incidentPacket = buildIncidentPacket({
    factory_id: normalizedFactoryId,
    control_plane_repo: normalizedRepo,
    source_factory: normalizedSourceFactory,
    source_repo: normalizedSourceRepo,
    run_id: normalizedRunId,
    pipeline: normalizedPipeline,
    bug_type: bugType,
    classification: resolvedClassification,
    severity: resolvedSeverity,
    crash_type: resolvedCrashType,
    runtime_version: resolvedRuntimeVersion,
    kind_version: resolvedKindVersion,
    kind_id: resolvedKindId,
    instance_id: resolvedInstanceId,
    host_id: resolvedHostId,
    fingerprint,
    mutation_context: mutationContext || evidenceObject.mutation_context || {},
    affected_node: evidenceObject.affected_node || evidenceObject.node || sourceSnapshot.affected_node || "",
    error_excerpt: evidenceObject.error_excerpt || evidenceObject.error || sourceSnapshot.error_excerpt || "",
    evidence,
    signature_hash: signature,
  });
  const packetValidation = validateIncidentPacket(incidentPacket);
  if (!packetValidation.ok) {
    return {
      ok: false,
      issue_url: "",
      error: "incident_packet_contract_failed",
      details: packetValidation.errors,
      validation_warnings: packetValidation.validation_warnings,
    };
  }

  const resolvedBugLabels = resolveBugLabels({ repo: normalizedRepo, sourceRepo: normalizedSourceRepo, labels, incidentPacket });

  // Also emit as OTEL event for dashboarding.
  emitGovernedOtelEvent({
    event_name: "factory.supervisor.bug",
    severity_text: "ERROR",
    correlation: {
      factory_id: normalizedFactoryId,
      run_id: normalizedRunId,
      workflow_id: String(normalizedPipeline || "ops"),
      capability_id: "supervisor",
      owner: "factory_ops.supervisor_artifact",
    },
    attributes: {
      source_repo: normalizedSourceRepo,
      bug_type: bugType,
      summary,
      pipeline: String(normalizedPipeline || ""),
      signature_hash: signature,
      incident_fingerprint: incidentPacket.fingerprint,
      incident_classification: incidentPacket.classification,
      incident_severity: incidentPacket.severity,
      incident_crash_type: incidentPacket.crash_type,
      incident_kind_id: incidentPacket.kind_id,
      incident_instance_id: incidentPacket.instance_id,
      incident_host_id: incidentPacket.host_id,
      source_factory: normalizedSourceFactory,
    },
    body: { evidence },
  });

  ensureBugLabelsFn({ repo: normalizedRepo, labels: resolvedBugLabels, ghExec });

  const payload = {
    schema: "incident.v2",
    fingerprint: incidentPacket.fingerprint,
    instance_id: incidentPacket.instance_id,
    kind_id: incidentPacket.kind_id,
    host_id: incidentPacket.host_id,
    classification: incidentPacket.classification,
    severity: incidentPacket.severity,
    crash_type: incidentPacket.crash_type,
    run_id: incidentPacket.run_id,
    error_excerpt: incidentPacket.error_excerpt,
    affected_node: incidentPacket.affected_node,
    runtime_version: incidentPacket.runtime_version,
    kind_version: incidentPacket.kind_version,
    factory_id: normalizedFactoryId,
    bug_type: bugType,
    source_repo: normalizedSourceRepo,
    pipeline: normalizedPipeline,
    summary,
    evidence,
    signature_hash: signature,
  };
  if (normalizedSourceFactory) payload.source_factory = normalizedSourceFactory;

  const title = `[bug] ${bugType}: ${summary.slice(0, 120)}`;
  const initialMetadata = mergeIncidentMetadata({
    existing: {},
    incidentPacket,
    sourceFactory: normalizedSourceFactory,
    sourceRepo: normalizedSourceRepo,
  });

  const baseBody = [
    "Machine-detected factory bug. Fast-tracked for immediate fix.",
    "",
    `**Type:** ${bugType}`,
    `**Pipeline:** ${normalizedPipeline}`,
    `**Summary:** ${summary}`,
    `**Source Repo:** ${normalizedSourceRepo}`,
    normalizedSourceFactory ? `**Source Factory:** ${normalizedSourceFactory}` : "",
    "",
    "```json",
    JSON.stringify(payload, null, 2),
    "```",
    "## Incident Packet",
    "```json",
    JSON.stringify(incidentPacket, null, 2),
    "```",
    `Bug-Signature: ${signature}`,
  ].filter(Boolean).join("\n");

  const body = withIncidentMetadataInBody({
    body: baseBody,
    fingerprint: incidentPacket.fingerprint,
    metadata: initialMetadata,
  });

  // Dedup: search BOTH open AND closed issues (prevents create→close→create loops).
  const knownBugsRaw = ghJsonFn([
    "issue", "list", "--repo", normalizedRepo, "--state", "all", "--label", "bug", "--limit", "200",
    "--json", "number,title,body,url,state",
  ], null);

  if (!Array.isArray(knownBugsRaw)) {
    const queue = enqueueIncidentNeedsReview({
      reason: "incident_dedup_lookup_failed",
      repo: normalizedRepo,
      bugType,
      summary,
      runId: normalizedRunId,
      fingerprint: incidentPacket.fingerprint,
      signature,
      sourceRepo: normalizedSourceRepo,
      sourceFactory: normalizedSourceFactory,
      details: {
        lookup: "issue_list_state_all_label_bug",
      },
      queuePath: needsReviewQueuePath,
    });
    return {
      ok: false,
      issue_url: "",
      error: "incident_dedup_lookup_failed",
      queue_path: queue.queue_path,
      queue_error: queue.queue_error,
    };
  }

  const knownBugs = knownBugsRaw;
  const fingerprintMatch = knownBugs.find((issue) => extractIncidentFingerprintFromIssueBody(issue?.body || "") === incidentPacket.fingerprint);
  const signatureMatch = knownBugs.find((issue) => String(issue?.body || "").includes(`Bug-Signature: ${signature}`));
  const existing = fingerprintMatch || signatureMatch;

  if (existing?.url) {
    emitIncidentDedupDecision({
      repo: normalizedRepo,
      sourceRepo: normalizedSourceRepo,
      sourceFactory: normalizedSourceFactory,
      bugType,
      fingerprint: incidentPacket.fingerprint,
      issueNumber: String(existing.number || ""),
      issueState: String(existing.state || ""),
      decision: "matched_existing_issue",
      runId: normalizedRunId,
      pipeline: normalizedPipeline,
    });
    const isClosed = String(existing.state || "").toUpperCase() === "CLOSED";
    if (isClosed) {
      const suppressReopen = shouldSuppressWaveGiveupReopen({ repo: normalizedRepo, bugType, summary, evidence, ghJsonFn });
      if (suppressReopen) {
        emitIncidentDedupDecision({
          repo: normalizedRepo,
          sourceRepo: normalizedSourceRepo,
          sourceFactory: normalizedSourceFactory,
          bugType,
          fingerprint: incidentPacket.fingerprint,
          issueNumber: String(existing.number || ""),
          issueState: "CLOSED",
          decision: "suppress_reopen_source_issue_closed",
          runId: normalizedRunId,
          pipeline: normalizedPipeline,
        });
        return { ok: true, issue_url: String(existing.url), error: "suppressed_reopen_source_issue_closed" };
      }
      ghExec(["issue", "reopen", String(existing.number), "--repo", normalizedRepo]);
      emitIncidentDedupDecision({
        repo: normalizedRepo,
        sourceRepo: normalizedSourceRepo,
        sourceFactory: normalizedSourceFactory,
        bugType,
        fingerprint: incidentPacket.fingerprint,
        issueNumber: String(existing.number || ""),
        issueState: "CLOSED",
        decision: "reopen_existing_issue",
        runId: normalizedRunId,
        pipeline: normalizedPipeline,
      });
    }

    const existingMetadata = readIncidentMetadataMarker(existing.body || "");
    const mergedMetadata = mergeIncidentMetadata({
      existing: existingMetadata,
      incidentPacket,
      sourceFactory: normalizedSourceFactory,
      sourceRepo: normalizedSourceRepo,
    });
    const updatedBody = withIncidentMetadataInBody({
      body: String(existing.body || ""),
      fingerprint: incidentPacket.fingerprint,
      metadata: mergedMetadata,
    });

    ghExec([
      "issue",
      "edit",
      String(existing.number),
      "--repo",
      normalizedRepo,
      "--body",
      updatedBody,
      ...resolvedBugLabels.flatMap((label) => ["--add-label", label]),
    ]);

    if (isClosed) {
      ghExec([
        "issue",
        "comment",
        String(existing.number),
        "--repo",
        normalizedRepo,
        "--body",
        [
          buildReopenComment({ runId: normalizedRunId, evidence, sourceRepo: normalizedSourceRepo }),
          "",
          buildIncidentDedupComment({ incidentPacket, sourceFactory: normalizedSourceFactory, sourceRepo: normalizedSourceRepo, reopened: true }),
        ].join("\n"),
      ]);
    } else {
      ghExec([
        "issue",
        "comment",
        String(existing.number),
        "--repo",
        normalizedRepo,
        "--body",
        buildIncidentDedupComment({ incidentPacket, sourceFactory: normalizedSourceFactory, sourceRepo: normalizedSourceRepo, reopened: false }),
      ]);
    }

    emitIncidentDedupDecision({
      repo: normalizedRepo,
      sourceRepo: normalizedSourceRepo,
      sourceFactory: normalizedSourceFactory,
      bugType,
      fingerprint: incidentPacket.fingerprint,
      issueNumber: String(existing.number || ""),
      issueState: String(existing.state || ""),
      decision: isClosed ? "updated_reopened_issue" : "updated_open_issue",
      runId: normalizedRunId,
      pipeline: normalizedPipeline,
    });

    return {
      ok: true,
      issue_url: String(existing.url),
      error: "",
      deduped: true,
      fingerprint: incidentPacket.fingerprint,
      validation_warnings: packetValidation.validation_warnings,
    };
  }

  // Title-level dedup for wave-judge-failure: keep one canonical issue per milestone summary,
  // even if evidence payloads drift (e.g., judge notes empty vs redacted text).
  if (bugType === "wave-judge-failure") {
    const sameTitle = knownBugs
      .filter((issue) => String(issue?.title || "") === title)
      .sort((a, b) => Number(b?.number || 0) - Number(a?.number || 0))[0];
    if (sameTitle?.url) {
      if (String(sameTitle.state || "").toUpperCase() === "CLOSED") {
        ghExec(["issue", "reopen", String(sameTitle.number), "--repo", normalizedRepo]);
      }
      const existingMetadata = readIncidentMetadataMarker(sameTitle.body || "");
      const mergedMetadata = mergeIncidentMetadata({
        existing: existingMetadata,
        incidentPacket,
        sourceFactory: normalizedSourceFactory,
        sourceRepo: normalizedSourceRepo,
      });
      const updatedBody = withIncidentMetadataInBody({
        body: String(sameTitle.body || ""),
        fingerprint: incidentPacket.fingerprint,
        metadata: mergedMetadata,
      });

      ghExec([
        "issue",
        "edit",
        String(sameTitle.number),
        "--repo",
        normalizedRepo,
        "--body",
        updatedBody,
        ...resolvedBugLabels.flatMap((label) => ["--add-label", label]),
      ]);
      ghExec([
        "issue",
        "comment",
        String(sameTitle.number),
        "--repo",
        normalizedRepo,
        "--body",
        buildIncidentDedupComment({ incidentPacket, sourceFactory: normalizedSourceFactory, sourceRepo: normalizedSourceRepo, reopened: String(sameTitle.state || "").toUpperCase() === "CLOSED" }),
      ]);
      return {
        ok: true,
        issue_url: String(sameTitle.url),
        error: "",
        deduped: true,
        fingerprint: incidentPacket.fingerprint,
        validation_warnings: packetValidation.validation_warnings,
      };
    }
  }

  const out = ghExec(["issue", "create", "--repo", normalizedRepo, "--title", title, "--body", body, ...resolvedBugLabels.flatMap((label) => ["--label", label])]);
  if (!out.ok) return { ok: false, issue_url: "", error: (out.stderr || out.stdout || "bug create failed").trim() };
  emitIncidentDedupDecision({
    repo: normalizedRepo,
    sourceRepo: normalizedSourceRepo,
    sourceFactory: normalizedSourceFactory,
    bugType,
    fingerprint: incidentPacket.fingerprint,
    issueState: "OPEN",
    decision: "created_new_issue",
    runId: normalizedRunId,
    pipeline: normalizedPipeline,
  });
  return {
    ok: true,
    issue_url: String(out.stdout || "").trim(),
    error: "",
    deduped: false,
    fingerprint: incidentPacket.fingerprint,
    validation_warnings: packetValidation.validation_warnings,
  };
}
