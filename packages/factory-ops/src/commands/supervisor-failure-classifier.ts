import { trim } from "../lib/cli-helpers.ts";

const PLATFORM_PATH_PATTERNS = [
  /(^|\/)(packages\/factory-ops|apps\/hatch|packages\/factory-telemetry)(\/|$)/i,
  /(^|\/)factories\/mothership\/graphs\//i,
  /(^|\/)factories\/mothership\/skills\//i,
];

const LOCAL_PATH_PATTERNS = [
  /(^|\/)factories\/[^/]+\/graphs\//i,
  /(^|\/)factories\/[^/]+\/skills\//i,
  /(^|\/)factories\/[^/]+\/scripts\//i,
  /kind\.json/i,
  /instance\.json/i,
];

const OWNERSHIP_PLATFORM_PATTERNS = [
  /control[_ -]?plane/i,
  /platform/i,
  /upstream/i,
];

const OWNERSHIP_LOCAL_PATTERNS = [
  /local/i,
  /managed[_ -]?factory/i,
  /local[_ -]?factory/i,
];

const BLOCKING_CRASH_TYPES = new Set([
  "merge_marker_in_executable",
  "module_not_found",
  "module_export_contract_mismatch",
  "runtime_module_error",
]);

const BLOCKING_BUG_TYPES = new Set([
  "main-branch-test-failure",
  "factory-cli-runtime-crash",
]);

function asObject(value = {}) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  return {};
}

function normalizeCrashType(value = "") {
  const normalized = trim(value).toLowerCase();
  return normalized || "unknown";
}

function normalizeClassification(value = "") {
  const normalized = trim(value).toLowerCase();
  if (normalized === "platform" || normalized === "local" || normalized === "needs-triage") return normalized;
  if (normalized === "needs_triage") return "needs-triage";
  return "";
}

function hasPatternMatch(value = "", patterns = []) {
  const text = trim(value);
  if (!text) return false;
  return patterns.some((pattern) => pattern.test(text));
}

function hasAnyPatternMatch(values = [], patterns = []) {
  return values.some((value) => hasPatternMatch(value, patterns));
}

function inferCrashType({ bugType = "", crashType = "", evidence = {} } = {}) {
  const normalizedCrashType = normalizeCrashType(crashType || evidence.crash_type);
  if (normalizedCrashType !== "unknown") return normalizedCrashType;

  const bug = trim(bugType).toLowerCase();
  if (bug === "factory-cli-runtime-crash") return "runtime_module_error";
  if (bug === "main-branch-test-failure") return "build_or_test_failure";
  if (bug === "stalled-wave-execution") return "stalled_execution";
  if (bug === "wave-judge-failure") return "judge_failure";
  if (bug === "managed-daemon-circuit-breaker") return "daemon_circuit_breaker";
  return "unknown";
}

function inferClassificationFromOwnership(ownershipHint = "") {
  if (hasPatternMatch(ownershipHint, OWNERSHIP_PLATFORM_PATTERNS)) return "platform";
  if (hasPatternMatch(ownershipHint, OWNERSHIP_LOCAL_PATTERNS)) return "local";
  return "";
}

function inferClassificationFromPaths({
  graphId = "",
  handlerPackage = "",
  filePath = "",
  affectedNode = "",
} = {}) {
  const values = [graphId, handlerPackage, filePath, affectedNode]
    .map((value) => trim(value))
    .filter(Boolean);

  if (hasAnyPatternMatch(values, PLATFORM_PATH_PATTERNS)) return "platform";
  if (hasAnyPatternMatch(values, LOCAL_PATH_PATTERNS)) return "local";
  return "";
}

export function classifySupervisorFailure({
  bugType = "",
  evidence = {},
  sourceRepo = "",
  controlPlaneRepo = "",
  sourceFactory = "",
  factoryId = "",
  classificationHint = "",
  crashTypeHint = "",
} = {}) {
  const evidenceObject = asObject(evidence);

  const hintedClassification = normalizeClassification(classificationHint || evidenceObject.classification);
  const inferredCrashType = inferCrashType({ bugType, crashType: crashTypeHint, evidence: evidenceObject });

  if (hintedClassification) {
    return {
      classification: hintedClassification,
      crash_type: inferredCrashType,
      rationale: "explicit_hint",
    };
  }

  const ownershipHint = trim(evidenceObject.ownership_hint || "");
  const ownershipClassification = inferClassificationFromOwnership(ownershipHint);
  if (ownershipClassification) {
    return {
      classification: ownershipClassification,
      crash_type: inferredCrashType,
      rationale: "ownership_hint",
    };
  }

  const pathClassification = inferClassificationFromPaths({
    graphId: evidenceObject.graph_id || evidenceObject.pipeline,
    handlerPackage: evidenceObject.handler_package || evidenceObject.handler,
    filePath: evidenceObject.file_path || evidenceObject.file,
    affectedNode: evidenceObject.affected_node || evidenceObject.node,
  });
  if (pathClassification) {
    return {
      classification: pathClassification,
      crash_type: inferredCrashType,
      rationale: "path_signal",
    };
  }

  const normalizedSourceRepo = trim(sourceRepo || evidenceObject.source_repo).toLowerCase();
  const normalizedControlPlaneRepo = trim(controlPlaneRepo || evidenceObject.control_plane_repo).toLowerCase();

  if (normalizedSourceRepo && normalizedControlPlaneRepo && normalizedSourceRepo === normalizedControlPlaneRepo) {
    return {
      classification: "platform",
      crash_type: inferredCrashType,
      rationale: "control_plane_repo_match",
    };
  }

  if (normalizedSourceRepo && normalizedControlPlaneRepo && normalizedSourceRepo !== normalizedControlPlaneRepo) {
    return {
      classification: "local",
      crash_type: inferredCrashType,
      rationale: "managed_target_repo",
    };
  }

  if (trim(sourceFactory) && trim(factoryId) && trim(sourceFactory) !== trim(factoryId)) {
    return {
      classification: "local",
      crash_type: inferredCrashType,
      rationale: "source_factory_differs",
    };
  }

  return {
    classification: "needs-triage",
    crash_type: inferredCrashType,
    rationale: "insufficient_deterministic_signals",
  };
}

export function deriveIncidentSeverity({ classification = "", crashType = "", bugType = "" } = {}) {
  const normalizedClassification = normalizeClassification(classification) || "needs-triage";
  const normalizedCrashType = normalizeCrashType(crashType);
  const normalizedBugType = trim(bugType).toLowerCase();

  if (BLOCKING_CRASH_TYPES.has(normalizedCrashType) || BLOCKING_BUG_TYPES.has(normalizedBugType)) {
    return "blocking";
  }
  if (normalizedClassification === "platform") {
    return "degrading";
  }
  return "informational";
}
