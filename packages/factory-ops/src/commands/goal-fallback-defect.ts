import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { emitGovernedOtelEvent } from "@recallnet/factory-telemetry";

import { trim } from "../lib/cli-helpers.ts";
import { resolveRunsDir } from "../lib/runs-dir-resolver.ts";

const FALLBACK_DEFECT_SCHEMA = "fallback_defect/v1";

const FALLBACK_CLASSIFICATIONS = new Set([
  "llm_output_malformed",
  "llm_output_empty",
  "pipeline_transport_defect",
  "contract_violation",
  "external_service_failure",
]);


function parseOptionalInteger(value) {
  const raw = trim(value);
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function parseOptionalBoolean(value) {
  const raw = trim(value).toLowerCase();
  if (!raw) return null;
  if (["1", "true", "yes", "y"].includes(raw)) return true;
  if (["0", "false", "no", "n"].includes(raw)) return false;
  return null;
}

function normalizeClassification(value = "") {
  const normalized = trim(value).toLowerCase();
  return FALLBACK_CLASSIFICATIONS.has(normalized) ? normalized : "";
}

function isLikelyExternalFailure(triggerReason = "") {
  const reason = trim(triggerReason).toLowerCase();
  if (!reason) return false;
  return [
    "external",
    "api",
    "github",
    "network",
    "timeout",
    "rate_limit",
    "service",
  ].some((token) => reason.includes(token));
}

function isLikelyContractViolation(triggerReason = "") {
  const reason = trim(triggerReason).toLowerCase();
  if (!reason) return false;
  return ["contract", "schema", "validation"].some((token) => reason.includes(token));
}

function isNormalizeTransportContradiction({
  approved,
  decomposeParseStatus,
  preNormalizeFeatureCount,
  postNormalizeFeatureCount,
  issuesCreated,
} = {}) {
  const parseStatus = trim(decomposeParseStatus).toLowerCase();
  const approvedValue = parseOptionalBoolean(approved);
  const preCount = parseOptionalInteger(preNormalizeFeatureCount);
  const postCount = parseOptionalInteger(postNormalizeFeatureCount);
  const issueCount = parseOptionalInteger(issuesCreated);

  if (approvedValue !== true) return false;
  if (parseStatus !== "valid_json") return false;
  if (postCount !== 0) return false;
  if (issueCount !== null && issueCount !== 0) return false;
  if (preCount !== null) return preCount > 0;

  // If exact pre-normalize count is unavailable, valid_json still implies
  // a non-empty/usable parsed feature payload in inspect-json-pair.
  return true;
}

function deriveClassification({
  classification,
  approved,
  decomposeParseStatus,
  preNormalizeFeatureCount,
  postNormalizeFeatureCount,
  issuesCreated,
  triggerReason,
} = {}) {
  const explicit = normalizeClassification(classification);
  if (explicit) return explicit;

  if (isNormalizeTransportContradiction({
    approved,
    decomposeParseStatus,
    preNormalizeFeatureCount,
    postNormalizeFeatureCount,
    issuesCreated,
  })) {
    return "pipeline_transport_defect";
  }

  if (isLikelyExternalFailure(triggerReason)) return "external_service_failure";

  const parseStatus = trim(decomposeParseStatus).toLowerCase();
  if (parseStatus === "invalid_json" || parseStatus === "non_array_json") {
    return "llm_output_malformed";
  }
  if (parseStatus === "empty_array" || parseStatus === "empty_feature_objects") {
    return "llm_output_empty";
  }

  if (isLikelyContractViolation(triggerReason)) return "contract_violation";

  return "contract_violation";
}

function deriveSeverity(classification = "") {
  if (classification === "pipeline_transport_defect" || classification === "contract_violation") return "high";
  return "medium";
}

function deriveSuggestedAction(classification = "") {
  if (classification === "pipeline_transport_defect" || classification === "contract_violation") return "file_bug";
  if (classification === "external_service_failure") return "monitor";
  return "retry";
}

export function buildFallbackDefectSignal({
  fallbackNode = "",
  pipeline = "",
  runId = "",
  factoryId = "",
  triggerReason = "",
  classification = "",
  severity = "",
  approved = "",
  decomposeParseStatus = "",
  preNormalizeFeatureCount = "",
  postNormalizeFeatureCount = "",
  issuesCreated = "",
  goalIssueNumber = "",
  now = new Date(),
} = {}) {
  const resolvedClassification = deriveClassification({
    classification,
    approved,
    decomposeParseStatus,
    preNormalizeFeatureCount,
    postNormalizeFeatureCount,
    issuesCreated,
    triggerReason,
  });

  const explicitSeverity = trim(severity).toLowerCase();
  const resolvedSeverity = explicitSeverity || deriveSeverity(resolvedClassification);

  const approvedValue = parseOptionalBoolean(approved);
  const parsedPreCount = parseOptionalInteger(preNormalizeFeatureCount);
  const parsedPostCount = parseOptionalInteger(postNormalizeFeatureCount);
  const parsedIssuesCreated = parseOptionalInteger(issuesCreated);
  const contradiction = {
    approved: approvedValue,
    decompose_parse_status: trim(decomposeParseStatus),
    pre_normalize_feature_count: parsedPreCount,
    post_normalize_feature_count: parsedPostCount,
    issues_created: parsedIssuesCreated,
  };

  if (
    contradiction.pre_normalize_feature_count === null
    && contradiction.approved === true
    && contradiction.decompose_parse_status.toLowerCase() === "valid_json"
    && contradiction.post_normalize_feature_count === 0
  ) {
    contradiction.pre_normalize_feature_count = 1;
  }

  const suggestedAction = deriveSuggestedAction(resolvedClassification);
  const normalizedRunId = trim(runId) || "unknown-run";
  const normalizedFallbackNode = trim(fallbackNode) || "unknown_fallback_node";
  const normalizedPipeline = trim(pipeline) || "unknown_pipeline";

  const evidence = {};
  const parsedGoalIssue = parseOptionalInteger(goalIssueNumber);
  if (parsedGoalIssue !== null && parsedGoalIssue > 0) evidence.goal_issue = parsedGoalIssue;

  return {
    schema: FALLBACK_DEFECT_SCHEMA,
    factory_id: trim(factoryId) || trim(process.env.HATCH_FACTORY_ID || process.env.FACTORY_ID || "") || "manual",
    fallback_node: normalizedFallbackNode,
    pipeline: normalizedPipeline,
    run_id: normalizedRunId,
    trigger_reason: trim(triggerReason) || "fallback_triggered",
    contradiction,
    classification: resolvedClassification,
    severity: resolvedSeverity,
    suggested_action: suggestedAction,
    evidence,
    emitted_at: new Date(now).toISOString(),
  };
}

export function persistFallbackDefectSignal({ signal, runId = "", runsDir = ".hatch/runs", factoryId = "", now = new Date() } = {}) {
  if (!signal || typeof signal !== "object") {
    throw new Error("persistFallbackDefectSignal requires a signal object");
  }

  const resolvedRunId = trim(runId) || trim(signal.run_id) || "unknown-run";
  const resolvedRunsDir = resolveRunsDir({ runsDir, factoryId });
  const artifactDir = join(resolvedRunsDir, resolvedRunId, "artifacts", "fallback-defects");
  mkdirSync(artifactDir, { recursive: true });

  const signatureSeed = JSON.stringify({
    schema: signal.schema,
    pipeline: signal.pipeline,
    fallback_node: signal.fallback_node,
    run_id: resolvedRunId,
    trigger_reason: signal.trigger_reason,
    classification: signal.classification,
  });
  const signature = createHash("sha256").update(signatureSeed).digest("hex").slice(0, 16);
  const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
  const artifactPath = join(artifactDir, `fallback-defect-${stamp}-${signature}.json`);

  writeFileSync(artifactPath, `${JSON.stringify(signal, null, 2)}\n`, "utf8");
  return artifactPath;
}

export function emitFallbackDefectTelemetry(signal = {}) {
  emitGovernedOtelEvent({
    event_name: "hatch.fallback_defect",
    severity_text: String(signal?.severity || "medium").toUpperCase() === "HIGH" ? "ERROR" : "WARN",
    correlation: {
      factory_id: trim(signal?.factory_id) || "manual",
      run_id: trim(signal?.run_id) || "unknown-run",
      workflow_id: trim(signal?.pipeline) || "unknown_workflow",
      capability_id: "goal_execution",
      owner: "factory_ops.goal_fallback_defect",
    },
    attributes: {
      schema: trim(signal?.schema),
      classification: trim(signal?.classification),
      severity: trim(signal?.severity),
      pipeline: trim(signal?.pipeline),
      fallback_node: trim(signal?.fallback_node),
      trigger_reason: trim(signal?.trigger_reason),
      suggested_action: trim(signal?.suggested_action),
    },
    body: signal,
  });
}

export function emitAndPersistFallbackDefectSignal({
  fallbackNode = "",
  pipeline = "",
  runId = "",
  triggerReason = "",
  classification = "",
  severity = "",
  approved = "",
  decomposeParseStatus = "",
  preNormalizeFeatureCount = "",
  postNormalizeFeatureCount = "",
  issuesCreated = "",
  goalIssueNumber = "",
  runsDir = ".hatch/runs",
  factoryId = "",
  now = new Date(),
} = {}) {
  const signal = buildFallbackDefectSignal({
    fallbackNode,
    pipeline,
    runId,
    factoryId,
    triggerReason,
    classification,
    severity,
    approved,
    decomposeParseStatus,
    preNormalizeFeatureCount,
    postNormalizeFeatureCount,
    issuesCreated,
    goalIssueNumber,
    now,
  });

  const artifactPath = persistFallbackDefectSignal({
    signal,
    runId: signal.run_id,
    runsDir,
    factoryId,
    now,
  });

  emitFallbackDefectTelemetry(signal);

  return {
    signal,
    artifact_path: artifactPath,
  };
}
