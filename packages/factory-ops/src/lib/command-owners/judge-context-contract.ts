import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { trim, parseJson } from "../cli-helpers.ts";
import {
  compareScenarioSelectionEntries,
  computeScenarioSignature,
  JUDGE_SCENARIO_BASIS_SCHEMA_VERSION,
  JUDGE_SCENARIO_SELECTION_SCHEMA_VERSION,
  normalizeScenarioPriority,
  resolveJudgeScenarioSelectionBasis,
} from "../judge-scenario-selection.ts";
import {
  buildNamedPacketEnvelope,
  makePacketId,
  validateNamedPacketBase,
  validateRegisteredPacketType,
} from "../packet-core.ts";
import { reusePersistedPacketCreatedAt } from "../persisted-packet-created-at.ts";
import { buildVerdictEnvelope } from "../verdict-envelope.ts";
export {
  JUDGE_SCENARIO_BASIS_SCHEMA_VERSION,
  JUDGE_SCENARIO_SELECTION_SCHEMA_VERSION,
  resolveJudgeScenarioSelectionBasis,
};
export const JUDGE_CONTEXT_SCHEMA_VERSION = "judge_context/v1";
export const JUDGE_CONTEXT_PACKET_TYPE = "judge_context_packet";
export const JUDGE_CONTEXT_PRIMARY_REASON_CODE = "JUDGE_CONTEXT_INVALID";
export const JUDGE_CONTEXT_REQUIRED_KEYS = ["schema_version", "judge_kind", "scope", "objective_id", "judge_rubric", "judge_input_sha256", "scenario_selector", "scenario_basis", "scenario_paths", "scenario_signature_sha256", "judge_evidence_path", "judge_evidence_sha256"];
function toBoolean(value = "") {
  const normalized = trim(value).toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return "true";
  if (["false", "0", "no"].includes(normalized)) return "false";
  return "";
}
function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function sha256Hex(input) {
  return createHash("sha256").update(input).digest("hex");
}
function resolvePath(pathValue = "") {
  const raw = trim(pathValue);
  if (!raw) return "";
  return isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
}
function normalizePath(value = "") {
  return trim(value).replaceAll("\\", "/").replace(/^\.\//, "");
}
function uniqueSorted(values = []) {
  return [...new Set(values.map((value) => trim(value)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
function sortObjectDeep(value) {
  if (Array.isArray(value)) return value.map((entry) => sortObjectDeep(entry));
  if (!isPlainObject(value)) return value;
  const out = {};
  for (const key of Object.keys(value).sort((a, b) => a.localeCompare(b))) {
    out[key] = sortObjectDeep(value[key]);
  }
  return out;
}
function slugify(value = "") {
  return trim(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "judge";
}
function parseJudgeContextRaw(raw = "") {
  const value = trim(raw);
  if (!value) {
    return { ok: false, code: "judge_context_input_missing", context: null };
  }
  const parsedValue = parseJson(value, null);
  if (parsedValue === null) {
    return { ok: false, code: "judge_context_input_invalid_json", context: null };
  }
  if (!Array.isArray(parsedValue) && !isPlainObject(parsedValue)) {
    return { ok: false, code: "judge_context_input_not_object_or_array", context: null };
  }
  return { ok: true, code: "ok", context: sortObjectDeep(parsedValue) };
}
function buildScopeIdentity({
  issueNumber = "",
  goalNumber = "",
  milestoneTitle = "",
  subjectId = "",
  ghRepo = "",
  judgeContextScopeIdentity = "",
} = {}) {
  const scope = {
    issue_number: trim(issueNumber),
    goal_number: trim(goalNumber),
    milestone_title: trim(milestoneTitle),
    subject_id: trim(subjectId),
    gh_repo: trim(ghRepo),
    judge_context_scope_identity: trim(judgeContextScopeIdentity),
  };
  const hasIdentity = Boolean(
    scope.issue_number
    || scope.goal_number
    || scope.milestone_title
    || scope.subject_id
    || scope.judge_context_scope_identity,
  );
  return { scope: sortObjectDeep(scope), hasIdentity };
}

const POST_MERGE_JUDGE_KINDS_REQUIRING_SCENARIOS = new Set([
  "wave_execution_post_merge",
  "goal_execution_post_merge",
]);

function requiresConfiguredPostMergeScenarios({ judgeKind = "", scenarioBasis = {} } = {}) {
  return POST_MERGE_JUDGE_KINDS_REQUIRING_SCENARIOS.has(trim(judgeKind))
    && trim(scenarioBasis?.configured) === "true";
}

function requiresWaveScopeIdentity(judgeKind = "") {
  return trim(judgeKind) === "wave_execution_post_merge";
}

function buildJudgeContextContractFailure(code = "judge_context_build_failed") {
  return {
    judge_context_path: "",
    judge_context_sha256: "",
    judge_context_valid: "false",
    judge_context_error: trim(code) || "judge_context_build_failed",
    judge_scenario_selection_path: "",
    judge_scenario_selection_sha256: "",
    judge_scenario_selection_signature_sha256: "",
  };
}
export function validateJudgeContextContract(value = {}) {
  const context = isPlainObject(value) ? value : {};
  const diagnostics = [];
  const missingKeys = JUDGE_CONTEXT_REQUIRED_KEYS
    .filter((key) => !(key in context))
    .sort((a, b) => a.localeCompare(b));
  for (const key of missingKeys) {
    diagnostics.push({ code: "missing_key", key });
  }
  if (trim(context.schema_version) !== JUDGE_CONTEXT_SCHEMA_VERSION) {
    diagnostics.push({ code: "invalid_schema_version" });
  }
  if (!trim(context.judge_kind)) {
    diagnostics.push({ code: "invalid_judge_kind" });
  }
  if (!trim(context.objective_id)) {
    diagnostics.push({ code: "invalid_objective_id" });
  }
  if (!trim(context.judge_rubric)) {
    diagnostics.push({ code: "invalid_judge_rubric" });
  }
  if (!trim(context.judge_input_sha256)) {
    diagnostics.push({ code: "invalid_judge_input_sha256" });
  }
  if (!isPlainObject(context.scope)) {
    diagnostics.push({ code: "invalid_scope" });
  } else {
    const hasIdentity = Boolean(
      trim(context.scope.issue_number)
      || trim(context.scope.goal_number)
      || trim(context.scope.milestone_title)
      || trim(context.scope.subject_id)
      || trim(context.scope.judge_context_scope_identity),
    );
    if (!hasIdentity) {
      diagnostics.push({ code: "missing_scope_identity" });
    }
  }
  const scenarioSelector = trim(context.scenario_selector);
  const scenarioPaths = Array.isArray(context.scenario_paths)
    ? context.scenario_paths.map((entry) => normalizePath(entry))
    : [];
  if (!Array.isArray(context.scenario_paths)) {
    diagnostics.push({ code: "invalid_scenario_paths" });
  }
  if (!trim(context.scenario_signature_sha256)) {
    diagnostics.push({ code: "invalid_scenario_signature_sha256" });
  }
  if (!isPlainObject(context.scenario_basis)) {
    diagnostics.push({ code: "invalid_scenario_basis" });
  } else {
    if (trim(context.scenario_basis.schema_version) !== JUDGE_SCENARIO_BASIS_SCHEMA_VERSION) {
      diagnostics.push({ code: "invalid_scenario_basis_schema_version" });
    }
    const category = trim(context.scenario_basis.category);
    if (category !== "configured" && category !== "unconfigured") {
      diagnostics.push({ code: "invalid_scenario_basis_category" });
    }
    const selectorPaths = Array.isArray(context.scenario_basis.selector_paths)
      ? context.scenario_basis.selector_paths.map((entry) => normalizePath(entry))
      : [];
    if (JSON.stringify(selectorPaths) !== JSON.stringify(uniqueSorted(selectorPaths))) {
      diagnostics.push({ code: "selector_paths_not_sorted" });
    }
    if (scenarioSelector !== selectorPaths.join(",")) {
      diagnostics.push({ code: "scenario_selector_mismatch" });
    }
    const selectedScenarios = Array.isArray(context.scenario_basis.selected_scenarios)
      ? context.scenario_basis.selected_scenarios
      : [];
    const normalizedSelected = selectedScenarios
      .filter((entry) => isPlainObject(entry))
      .map((entry) => sortObjectDeep({
        scenario_id: trim(entry.scenario_id),
        scenario_path: normalizePath(entry.scenario_path),
        scope: trim(entry.scope),
        domain: trim(entry.domain),
        priority: normalizeScenarioPriority(entry.priority),
        selection_rank: trim(entry.selection_rank),
        source_selectors: uniqueSorted(entry.source_selectors || []),
      }));
    const selectedPaths = normalizedSelected.map((entry) => entry.scenario_path);
    if (JSON.stringify(selectedPaths) !== JSON.stringify(scenarioPaths)) {
      diagnostics.push({ code: "scenario_selected_paths_mismatch" });
    }

    const canonicalSelectedPaths = [...normalizedSelected]
      .sort((a, b) => compareScenarioSelectionEntries(a, b))
      .map((entry) => entry.scenario_path);

    if (JSON.stringify(selectedPaths) !== JSON.stringify(canonicalSelectedPaths)) {
      diagnostics.push({ code: "selected_scenarios_not_ordered" });
    }

    if (JSON.stringify(scenarioPaths) !== JSON.stringify(canonicalSelectedPaths)) {
      diagnostics.push({ code: "scenario_paths_not_sorted" });
    }
    const configured = category === "configured";
    if (configured && selectorPaths.length === 0) {
      diagnostics.push({ code: "invalid_scenario_selector" });
    }
    if (!configured && selectorPaths.length > 0) {
      diagnostics.push({ code: "scenario_selector_unconfigured_mismatch" });
    }
    const expectedSignature = computeScenarioSignature({
      selectorPaths,
      scenarioPaths,
    });
    if (trim(context.scenario_signature_sha256) !== expectedSignature) {
      diagnostics.push({ code: "scenario_signature_mismatch" });
    }
  }
  if (!trim(context.judge_scenario_selection_path)) {
    diagnostics.push({ code: "invalid_judge_scenario_selection_path" });
  }
  if (!trim(context.judge_scenario_selection_sha256)) {
    diagnostics.push({ code: "invalid_judge_scenario_selection_sha256" });
  }
  if (!trim(context.judge_evidence_path)) {
    diagnostics.push({ code: "invalid_judge_evidence_path" });
  }
  if (!trim(context.judge_evidence_sha256)) {
    diagnostics.push({ code: "invalid_judge_evidence_sha256" });
  }
  const packetBase = validateNamedPacketBase(context);
  for (const error of packetBase.errors) diagnostics.push({ code: error });
  const registration = validateRegisteredPacketType({
    packetType: context.packet_type,
    schemaVersion: context.schema_version,
  });
  for (const error of registration.errors) diagnostics.push({ code: error });
  return {
    ok: diagnostics.length === 0,
    diagnostics,
    missing_keys: missingKeys,
  };
}
export function buildJudgeContextContract({
  judgeKind = "",
  judgeContextRaw = "",
  scenarioSelector = "",
  scenarioContext = "",
  scope: scenarioScope = "",
  scenarioRegistryRoot = "",
  objectiveId = "",
  judgeRubric = "",
  judgeEvidencePath = "",
  judgeEvidenceSha256 = "",
  judgeScenarioSelectionPath = "",
  judgeScenarioSelectionSha256 = "",
  subjectId = "",
  issueNumber = "",
  goalNumber = "",
  milestoneTitle = "",
  ghRepo = "",
  judgeContextScopeIdentity = "",
  scenarioSelectionBasis = null,
} = {}) {
  const parsedContext = parseJudgeContextRaw(judgeContextRaw);
  if (!parsedContext.ok || parsedContext.context === null) {
    return {
      ok: false,
      code: parsedContext.code,
      context: null,
      diagnostics: [{ code: parsedContext.code }],
    };
  }
  const scenarioBasis = isPlainObject(scenarioSelectionBasis)
    ? scenarioSelectionBasis
    : resolveJudgeScenarioSelectionBasis({
      scenarioSelector,
      scenarioContext,
      scope: scenarioScope,
      scenarioRegistryRoot,
    });
  if (!scenarioBasis.ok) {
    return {
      ok: false,
      code: scenarioBasis.code,
      context: null,
      diagnostics: [{ code: scenarioBasis.code }],
    };
  }

  if (requiresConfiguredPostMergeScenarios({ judgeKind, scenarioBasis })
    && (!Array.isArray(scenarioBasis.scenario_paths) || scenarioBasis.scenario_paths.length === 0)) {
    return {
      ok: false,
      code: "judge_context_scenarios_missing",
      context: null,
      diagnostics: [{ code: "judge_context_scenarios_missing" }],
    };
  }

  const evidencePathResolved = resolvePath(judgeEvidencePath);
  const evidenceSha = trim(judgeEvidenceSha256);
  if (!evidencePathResolved) {
    return {
      ok: false,
      code: "judge_context_evidence_path_missing",
      context: null,
      diagnostics: [{ code: "judge_context_evidence_path_missing" }],
    };
  }
  if (!evidenceSha) {
    return {
      ok: false,
      code: "judge_context_evidence_sha256_missing",
      context: null,
      diagnostics: [{ code: "judge_context_evidence_sha256_missing" }],
    };
  }
  const selectionPathResolved = resolvePath(judgeScenarioSelectionPath);
  const selectionSha = trim(judgeScenarioSelectionSha256);
  if (!selectionPathResolved) {
    return {
      ok: false,
      code: "judge_context_scenario_selection_path_missing",
      context: null,
      diagnostics: [{ code: "judge_context_scenario_selection_path_missing" }],
    };
  }
  if (!selectionSha) {
    return {
      ok: false,
      code: "judge_context_scenario_selection_sha256_missing",
      context: null,
      diagnostics: [{ code: "judge_context_scenario_selection_sha256_missing" }],
    };
  }
  const { scope, hasIdentity } = buildScopeIdentity({
    issueNumber,
    goalNumber,
    milestoneTitle,
    subjectId,
    ghRepo,
    judgeContextScopeIdentity,
  });
  if (!hasIdentity) {
    return {
      ok: false,
      code: "judge_context_scope_identity_missing",
      context: null,
      diagnostics: [{ code: "judge_context_scope_identity_missing" }],
    };
  }
  if (requiresWaveScopeIdentity(judgeKind) && !trim(scope.judge_context_scope_identity)) {
    return {
      ok: false,
      code: "judge_context_scope_identity_missing",
      context: null,
      diagnostics: [{ code: "judge_context_scope_identity_missing" }],
    };
  }
  const normalizedContext = sortObjectDeep(parsedContext.context);
  const selectorPaths = scenarioBasis.selector_paths;
  const scenarioPaths = scenarioBasis.scenario_paths;
  const scenarioSignature = scenarioBasis.scenario_signature_sha256;
  const context = sortObjectDeep({
    ...buildNamedPacketEnvelope({
      schemaVersion: JUDGE_CONTEXT_SCHEMA_VERSION,
      packetType: JUDGE_CONTEXT_PACKET_TYPE,
      packetId: makePacketId({
        packetType: JUDGE_CONTEXT_PACKET_TYPE,
        identity: {
          judge_kind: trim(judgeKind) || "judge",
          scope,
          objective_id: trim(objectiveId) || "intent.unbound",
          judge_input_sha256: sha256Hex(JSON.stringify(normalizedContext)),
          judge_evidence_path: evidencePathResolved,
          judge_evidence_sha256: evidenceSha,
          scenario_signature_sha256: scenarioSignature,
        },
      }),
    }),
    judge_kind: trim(judgeKind) || "judge",
    scope,
    objective_id: trim(objectiveId) || "intent.unbound",
    judge_rubric: trim(judgeRubric) || "alignment.default",
    judge_input_sha256: sha256Hex(JSON.stringify(normalizedContext)),
    scenario_selector: selectorPaths.join(","),
    scenario_basis: {
      schema_version: JUDGE_SCENARIO_BASIS_SCHEMA_VERSION,
      category: trim(scenarioBasis?.scenario_basis?.category) || "unconfigured",
      ordering: trim(scenarioBasis?.scenario_basis?.ordering) || "priority_then_id_then_path",
      source: trim(scenarioBasis?.scenario_basis?.source) || "node.scenarios",
      selector_paths: selectorPaths,
      selector_sources: uniqueSorted(scenarioBasis.selector_sources || ["node.scenarios"]),
      registry_root: scenarioBasis.registry_root,
      missing_selector_paths: scenarioBasis.missing_selector_paths,
      scenario_count: String(scenarioPaths.length),
      scenario_ids: uniqueSorted(scenarioBasis.scenario_ids || []),
      selected_scenarios: Array.isArray(scenarioBasis.selected_scenarios)
        ? scenarioBasis.selected_scenarios.map((entry) => sortObjectDeep(entry))
        : [],
    },
    scenario_paths: scenarioPaths,
    scenario_signature_sha256: scenarioSignature,
    judge_scenario_selection_path: selectionPathResolved,
    judge_scenario_selection_sha256: selectionSha,
    judge_evidence_path: evidencePathResolved,
    judge_evidence_sha256: evidenceSha,
  });
  const validation = validateJudgeContextContract(context);
  if (!validation.ok) {
    return {
      ok: false,
      code: validation.missing_keys.length > 0
        ? "judge_context_missing_required_fields"
        : "judge_context_validation_failed",
      context,
      diagnostics: validation.diagnostics,
    };
  }
  return {
    ok: true,
    code: "ok",
    context,
    diagnostics: [],
  };
}
export function buildAndPersistJudgeContextContract({
  judgeKind = "",
  judgeContextRaw = "",
  scenarioSelector = "",
  scenarioContext = "",
  scope: scenarioScope = "",
  scenarioRegistryRoot = "",
  objectiveId = "",
  judgeRubric = "",
  judgeEvidencePath = "",
  judgeEvidenceSha256 = "",
  subjectId = "",
  issueNumber = "",
  goalNumber = "",
  milestoneTitle = "",
  ghRepo = "",
  judgeContextScopeIdentity = "",
  worktreeDir = "",
} = {}) {
  const parsedContext = parseJudgeContextRaw(judgeContextRaw);
  if (!parsedContext.ok || parsedContext.context === null) {
    return buildJudgeContextContractFailure(parsedContext.code);
  }
  const normalizedContext = sortObjectDeep(parsedContext.context);
  const judgeInputSha = sha256Hex(JSON.stringify(normalizedContext));
  const kind = trim(judgeKind) || "judge";
  const scopeId = trim(subjectId)
    || trim(issueNumber)
    || trim(goalNumber)
    || trim(milestoneTitle)
    || trim(judgeContextScopeIdentity)
    || "scope";
  const outputRoot = resolvePath(worktreeDir) || process.cwd();
  const scenarioBasis = resolveJudgeScenarioSelectionBasis({
    scenarioSelector,
    scenarioContext,
    scope: scenarioScope,
    scenarioRegistryRoot,
  });
  if (!scenarioBasis.ok) {
    return buildJudgeContextContractFailure(String(scenarioBasis.code || "judge_context_scenarios_missing"));
  }
  const scenarioSelectionPath = join(
    outputRoot,
    ".hatch",
    "judge",
    "scenario-selection",
    `${slugify(kind)}-${slugify(scopeId)}-${judgeInputSha.slice(0, 12)}.json`,
  );
  mkdirSync(dirname(scenarioSelectionPath), { recursive: true });
  const scenarioSelectionArtifact = sortObjectDeep({
    schema_version: JUDGE_SCENARIO_SELECTION_SCHEMA_VERSION,
    configured: scenarioBasis.configured,
    selector_paths: scenarioBasis.selector_paths,
    selector_sources: scenarioBasis.selector_sources,
    registry_root: scenarioBasis.registry_root,
    scenario_ids: scenarioBasis.scenario_ids,
    scenario_paths: scenarioBasis.scenario_paths,
    selected_scenarios: scenarioBasis.selected_scenarios,
    missing_selector_paths: scenarioBasis.missing_selector_paths,
    scenario_count: scenarioBasis.scenario_count,
    scenario_basis: scenarioBasis.scenario_basis,
    scenario_signature_sha256: scenarioBasis.scenario_signature_sha256,
  });
  const encodedScenarioSelection = `${JSON.stringify(scenarioSelectionArtifact, null, 2)}\n`;
  writeFileSync(scenarioSelectionPath, encodedScenarioSelection, "utf8");
  const scenarioSelectionSha = sha256Hex(encodedScenarioSelection);
  const built = buildJudgeContextContract({
    judgeKind,
    judgeContextRaw,
    scenarioSelector,
    scenarioContext,
    scope: scenarioScope,
    scenarioRegistryRoot,
    objectiveId,
    judgeRubric,
    judgeEvidencePath,
    judgeEvidenceSha256,
    judgeScenarioSelectionPath: scenarioSelectionPath,
    judgeScenarioSelectionSha256: scenarioSelectionSha,
    subjectId,
    issueNumber,
    goalNumber,
    milestoneTitle,
    ghRepo,
    judgeContextScopeIdentity,
    scenarioSelectionBasis: scenarioBasis,
  });
  if (!built.ok || !built.context) {
    return buildJudgeContextContractFailure(String(built.code || "judge_context_build_failed"));
  }
  const outPath = join(
    outputRoot,
    ".hatch",
    "judge",
    "context",
    `${slugify(kind)}-${slugify(scopeId)}-${judgeInputSha.slice(0, 12)}.json`,
  );
  mkdirSync(dirname(outPath), { recursive: true });
  const persistedContext = reusePersistedPacketCreatedAt({
    packet: built.context,
    packetPath: outPath,
    expectedPacketType: JUDGE_CONTEXT_PACKET_TYPE,
  });
  const encoded = `${JSON.stringify(persistedContext, null, 2)}\n`;
  writeFileSync(outPath, encoded, "utf8");
  return {
    judge_context_path: outPath,
    judge_context_sha256: sha256Hex(encoded),
    judge_context_valid: "true",
    judge_context_error: "",
    judge_scenario_selection_path: scenarioSelectionPath,
    judge_scenario_selection_sha256: scenarioSelectionSha,
    judge_scenario_selection_signature_sha256: scenarioBasis.scenario_signature_sha256,
  };
}
function readFileSha256(pathValue = "") {
  const resolved = resolvePath(pathValue);
  if (!resolved || !existsSync(resolved)) {
    return { ok: false, sha256: "", path: resolved };
  }
  const bytes = readFileSync(resolved);
  return { ok: true, sha256: sha256Hex(bytes), path: resolved };
}
function loadJudgeContextArtifact(pathValue = "") {
  const resolved = resolvePath(pathValue);
  if (!resolved) {
    return { ok: false, code: "judge_context_path_missing", path: "", context: null };
  }
  if (!existsSync(resolved)) {
    return { ok: false, code: "judge_context_not_found", path: resolved, context: null };
  }
  const parsedValue = parseJson(readFileSync(resolved, "utf8"), null);
  if (!isPlainObject(parsedValue)) {
    return { ok: false, code: "judge_context_invalid_json", path: resolved, context: null };
  }
  return { ok: true, code: "ok", path: resolved, context: parsedValue };
}
function loadJudgeScenarioSelectionArtifact(pathValue = "") {
  const resolved = resolvePath(pathValue);
  if (!resolved) {
    return { ok: false, code: "judge_scenario_selection_path_missing", path: "", artifact: null };
  }
  if (!existsSync(resolved)) {
    return { ok: false, code: "judge_scenario_selection_not_found", path: resolved, artifact: null };
  }
  const parsedValue = parseJson(readFileSync(resolved, "utf8"), null);
  if (!isPlainObject(parsedValue)) {
    return { ok: false, code: "judge_scenario_selection_invalid_json", path: resolved, artifact: null };
  }
  return { ok: true, code: "ok", path: resolved, artifact: parsedValue };
}
function normalizeFailureCode(code = "", fallback = "judge_context_validation_failed") {
  const normalized = trim(code);
  return normalized || fallback;
}
function buildJudgeContextValidationPass({
  pathValue = "",
  sha256 = "",
  scenarioSelectionPath = "",
  scenarioSelectionSha256 = "",
  scenarioSelectionSignatureSha256 = "",
} = {}) {
  return {
    judge_context_gate_pass: "true",
    judge_context_gate_code: "ok",
    judge_context_error: "",
    judge_context_path: pathValue,
    judge_context_sha256: sha256,
    judge_scenario_selection_path: scenarioSelectionPath,
    judge_scenario_selection_sha256: scenarioSelectionSha256,
    judge_scenario_selection_signature_sha256: scenarioSelectionSignatureSha256,
    judge_route_code: "",
    disposition: "approve",
    confidence: "high",
    recommended_transition: "judge_ready",
    reason_codes: ["JUDGE_CONTEXT_VALID"],
    notes: "",
    verdict: buildVerdictEnvelope({
      verdictKind: "post_merge_judge",
      disposition: "approve",
      confidence: "high",
      recommendedTransition: "judge_ready",
      observation: { contract: "judge_context_valid" },
      recommendation: { action: "continue_to_evidence_validation" },
      reasonCodes: ["JUDGE_CONTEXT_VALID"],
      notes: "",
    }),
  };
}
function buildJudgeContextValidationFailure({
  code = "judge_context_validation_failed",
  pathValue = "",
  sha256 = "",
  scenarioSelectionPath = "",
  scenarioSelectionSha256 = "",
  scenarioSelectionSignatureSha256 = "",
} = {}) {
  const reason = normalizeFailureCode(code);
  const note = `${JUDGE_CONTEXT_PRIMARY_REASON_CODE}: ${reason}`;
  return {
    judge_context_gate_pass: "false",
    judge_context_gate_code: reason,
    judge_context_error: reason,
    judge_context_path: pathValue,
    judge_context_sha256: sha256,
    judge_scenario_selection_path: scenarioSelectionPath,
    judge_scenario_selection_sha256: scenarioSelectionSha256,
    judge_scenario_selection_signature_sha256: scenarioSelectionSignatureSha256,
    judge_route_code: reason,
    disposition: "escalate",
    confidence: "high",
    recommended_transition: "repair_judge_context_contract",
    reason_codes: [JUDGE_CONTEXT_PRIMARY_REASON_CODE],
    notes: note,
    verdict: buildVerdictEnvelope({
      verdictKind: "post_merge_judge",
      disposition: "escalate",
      confidence: "high",
      recommendedTransition: "repair_judge_context_contract",
      observation: { contract: "judge_context_invalid", code: reason },
      recommendation: { action: "build_judge_context_recovery_packet" },
      reasonCodes: [JUDGE_CONTEXT_PRIMARY_REASON_CODE],
      notes: note,
    }),
  };
}
export function validateJudgeContextCompleteness({
  judgeContextPath = "",
  judgeContextSha256 = "",
  judgeContextValid = "",
  judgeContextError = "",
  judgeKind = "",
  judgeContextRaw = "",
  scenarioSelector = "",
  scenarioContext = "",
  scope: scenarioScope = "",
  scenarioRegistryRoot = "",
  objectiveId = "",
  judgeRubric = "",
  judgeEvidencePath = "",
  judgeEvidenceSha256 = "",
  judgeContextScopeIdentity = "",
} = {}) {
  if (toBoolean(judgeContextValid) === "false") {
    return buildJudgeContextValidationFailure({
      code: judgeContextError || "judge_context_build_failed",
      pathValue: "",
      sha256: "",
    });
  }
  const loaded = loadJudgeContextArtifact(judgeContextPath);
  if (!loaded.ok || !loaded.context) {
    return buildJudgeContextValidationFailure({
      code: loaded.code,
      pathValue: loaded.path,
      sha256: "",
    });
  }
  const expectedSha = trim(judgeContextSha256);
  if (!expectedSha) {
    return buildJudgeContextValidationFailure({
      code: "judge_context_sha256_missing",
      pathValue: loaded.path,
      sha256: "",
    });
  }
  const actualSha = readFileSha256(loaded.path);
  if (!actualSha.ok || !trim(actualSha.sha256)) {
    return buildJudgeContextValidationFailure({
      code: "judge_context_sha256_unavailable",
      pathValue: loaded.path,
      sha256: "",
    });
  }
  if (trim(actualSha.sha256) !== expectedSha) {
    return buildJudgeContextValidationFailure({
      code: "judge_context_sha256_mismatch",
      pathValue: loaded.path,
      sha256: trim(actualSha.sha256),
    });
  }
  const structural = validateJudgeContextContract(loaded.context);
  if (!structural.ok) {
    const hasMissing = Array.isArray(structural.missing_keys) && structural.missing_keys.length > 0;
    return buildJudgeContextValidationFailure({
      code: hasMissing ? "judge_context_missing_required_fields" : "judge_context_validation_failed",
      pathValue: loaded.path,
      sha256: trim(actualSha.sha256),
    });
  }
  const expectedKind = trim(judgeKind);
  if (expectedKind && trim(loaded.context.judge_kind) !== expectedKind) {
    return buildJudgeContextValidationFailure({
      code: "judge_context_kind_mismatch",
      pathValue: loaded.path,
      sha256: trim(actualSha.sha256),
    });
  }
  const effectiveKind = expectedKind || trim(loaded.context.judge_kind);
  if (requiresWaveScopeIdentity(effectiveKind)
    && !trim(loaded.context?.scope?.judge_context_scope_identity)) {
    return buildJudgeContextValidationFailure({
      code: "judge_context_scope_identity_missing",
      pathValue: loaded.path,
      sha256: trim(actualSha.sha256),
      scenarioSelectionPath: trim(loaded.context.judge_scenario_selection_path),
      scenarioSelectionSha256: trim(loaded.context.judge_scenario_selection_sha256),
      scenarioSelectionSignatureSha256: trim(loaded.context.scenario_signature_sha256),
    });
  }
  const parsedInputContext = parseJudgeContextRaw(judgeContextRaw);
  if (!parsedInputContext.ok || parsedInputContext.context === null) {
    return buildJudgeContextValidationFailure({
      code: parsedInputContext.code,
      pathValue: loaded.path,
      sha256: trim(actualSha.sha256),
    });
  }
  const expectedInputSha = sha256Hex(JSON.stringify(sortObjectDeep(parsedInputContext.context)));
  if (trim(loaded.context.judge_input_sha256) !== expectedInputSha) {
    return buildJudgeContextValidationFailure({
      code: "judge_context_input_sha256_mismatch",
      pathValue: loaded.path,
      sha256: trim(actualSha.sha256),
    });
  }
  const scenarioBasis = resolveJudgeScenarioSelectionBasis({
    scenarioSelector: scenarioSelector || loaded.context.scenario_selector,
    scenarioContext,
    scope: scenarioScope,
    scenarioRegistryRoot: scenarioRegistryRoot || loaded.context?.scenario_basis?.registry_root,
  });
  if (!scenarioBasis.ok) {
    return buildJudgeContextValidationFailure({
      code: scenarioBasis.code,
      pathValue: loaded.path,
      sha256: trim(actualSha.sha256),
      scenarioSelectionPath: trim(loaded.context.judge_scenario_selection_path),
      scenarioSelectionSha256: trim(loaded.context.judge_scenario_selection_sha256),
      scenarioSelectionSignatureSha256: trim(loaded.context.scenario_signature_sha256),
    });
  }

  if (requiresConfiguredPostMergeScenarios({ judgeKind: effectiveKind, scenarioBasis })
    && (!Array.isArray(scenarioBasis.scenario_paths) || scenarioBasis.scenario_paths.length === 0)) {
    return buildJudgeContextValidationFailure({
      code: "judge_context_scenarios_missing",
      pathValue: loaded.path,
      sha256: trim(actualSha.sha256),
      scenarioSelectionPath: trim(loaded.context.judge_scenario_selection_path),
      scenarioSelectionSha256: trim(loaded.context.judge_scenario_selection_sha256),
      scenarioSelectionSignatureSha256: trim(loaded.context.scenario_signature_sha256),
    });
  }

  const expectedSelectorPaths = uniqueSorted(scenarioBasis.selector_paths);
  const actualSelectorPaths = uniqueSorted(
    Array.isArray(loaded.context?.scenario_basis?.selector_paths)
      ? loaded.context.scenario_basis.selector_paths
      : [],
  );
  if (JSON.stringify(actualSelectorPaths) !== JSON.stringify(expectedSelectorPaths)) {
    return buildJudgeContextValidationFailure({
      code: "judge_context_selector_paths_mismatch",
      pathValue: loaded.path,
      sha256: trim(actualSha.sha256),
      scenarioSelectionPath: trim(loaded.context.judge_scenario_selection_path),
      scenarioSelectionSha256: trim(loaded.context.judge_scenario_selection_sha256),
      scenarioSelectionSignatureSha256: trim(loaded.context.scenario_signature_sha256),
    });
  }
  const expectedSelector = expectedSelectorPaths.join(",");
  if (trim(loaded.context.scenario_selector) !== expectedSelector) {
    return buildJudgeContextValidationFailure({
      code: "judge_context_scenario_selector_mismatch",
      pathValue: loaded.path,
      sha256: trim(actualSha.sha256),
      scenarioSelectionPath: trim(loaded.context.judge_scenario_selection_path),
      scenarioSelectionSha256: trim(loaded.context.judge_scenario_selection_sha256),
      scenarioSelectionSignatureSha256: trim(loaded.context.scenario_signature_sha256),
    });
  }
  const expectedRegistryRoot = normalizePath(scenarioBasis.registry_root);
  const actualRegistryRoot = normalizePath(loaded.context?.scenario_basis?.registry_root || "");
  if (!actualRegistryRoot || actualRegistryRoot !== expectedRegistryRoot) {
    return buildJudgeContextValidationFailure({
      code: "judge_context_registry_root_mismatch",
      pathValue: loaded.path,
      sha256: trim(actualSha.sha256),
      scenarioSelectionPath: trim(loaded.context.judge_scenario_selection_path),
      scenarioSelectionSha256: trim(loaded.context.judge_scenario_selection_sha256),
      scenarioSelectionSignatureSha256: trim(loaded.context.scenario_signature_sha256),
    });
  }
  const expectedPaths = uniqueSorted(scenarioBasis.scenario_paths);
  const actualPaths = uniqueSorted(Array.isArray(loaded.context.scenario_paths) ? loaded.context.scenario_paths : []);
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
    return buildJudgeContextValidationFailure({
      code: "judge_context_scenario_paths_mismatch",
      pathValue: loaded.path,
      sha256: trim(actualSha.sha256),
      scenarioSelectionPath: trim(loaded.context.judge_scenario_selection_path),
      scenarioSelectionSha256: trim(loaded.context.judge_scenario_selection_sha256),
      scenarioSelectionSignatureSha256: trim(loaded.context.scenario_signature_sha256),
    });
  }
  const expectedSelected = (Array.isArray(scenarioBasis.selected_scenarios) ? scenarioBasis.selected_scenarios : [])
    .map((entry) => sortObjectDeep(entry));
  const actualSelected = (Array.isArray(loaded.context?.scenario_basis?.selected_scenarios)
    ? loaded.context.scenario_basis.selected_scenarios
    : [])
    .map((entry) => sortObjectDeep(entry));
  if (JSON.stringify(actualSelected) !== JSON.stringify(expectedSelected)) {
    return buildJudgeContextValidationFailure({
      code: "judge_context_selected_scenarios_mismatch",
      pathValue: loaded.path,
      sha256: trim(actualSha.sha256),
      scenarioSelectionPath: trim(loaded.context.judge_scenario_selection_path),
      scenarioSelectionSha256: trim(loaded.context.judge_scenario_selection_sha256),
      scenarioSelectionSignatureSha256: trim(loaded.context.scenario_signature_sha256),
    });
  }
  const expectedSignature = scenarioBasis.scenario_signature_sha256;
  if (trim(loaded.context.scenario_signature_sha256) !== expectedSignature) {
    return buildJudgeContextValidationFailure({
      code: "judge_context_scenario_signature_mismatch",
      pathValue: loaded.path,
      sha256: trim(actualSha.sha256),
      scenarioSelectionPath: trim(loaded.context.judge_scenario_selection_path),
      scenarioSelectionSha256: trim(loaded.context.judge_scenario_selection_sha256),
      scenarioSelectionSignatureSha256: trim(loaded.context.scenario_signature_sha256),
    });
  }
  const scenarioSelectionPath = resolvePath(loaded.context.judge_scenario_selection_path);
  if (!scenarioSelectionPath) {
    return buildJudgeContextValidationFailure({
      code: "judge_context_scenario_selection_path_missing",
      pathValue: loaded.path,
      sha256: trim(actualSha.sha256),
      scenarioSelectionPath: "",
      scenarioSelectionSha256: trim(loaded.context.judge_scenario_selection_sha256),
      scenarioSelectionSignatureSha256: trim(loaded.context.scenario_signature_sha256),
    });
  }
  const scenarioSelectionExpectedSha = trim(loaded.context.judge_scenario_selection_sha256);
  if (!scenarioSelectionExpectedSha) {
    return buildJudgeContextValidationFailure({
      code: "judge_context_scenario_selection_sha256_missing",
      pathValue: loaded.path,
      sha256: trim(actualSha.sha256),
      scenarioSelectionPath,
      scenarioSelectionSha256: "",
      scenarioSelectionSignatureSha256: trim(loaded.context.scenario_signature_sha256),
    });
  }
  const loadedSelection = loadJudgeScenarioSelectionArtifact(scenarioSelectionPath);
  if (!loadedSelection.ok || !loadedSelection.artifact) {
    return buildJudgeContextValidationFailure({
      code: loadedSelection.code,
      pathValue: loaded.path,
      sha256: trim(actualSha.sha256),
      scenarioSelectionPath: loadedSelection.path,
      scenarioSelectionSha256: scenarioSelectionExpectedSha,
      scenarioSelectionSignatureSha256: trim(loaded.context.scenario_signature_sha256),
    });
  }
  const actualSelectionSha = readFileSha256(loadedSelection.path);
  if (!actualSelectionSha.ok || !trim(actualSelectionSha.sha256)) {
    return buildJudgeContextValidationFailure({
      code: "judge_context_scenario_selection_sha256_unavailable",
      pathValue: loaded.path,
      sha256: trim(actualSha.sha256),
      scenarioSelectionPath: loadedSelection.path,
      scenarioSelectionSha256: scenarioSelectionExpectedSha,
      scenarioSelectionSignatureSha256: trim(loaded.context.scenario_signature_sha256),
    });
  }
  if (trim(actualSelectionSha.sha256) !== scenarioSelectionExpectedSha) {
    return buildJudgeContextValidationFailure({
      code: "judge_context_scenario_selection_sha256_mismatch",
      pathValue: loaded.path,
      sha256: trim(actualSha.sha256),
      scenarioSelectionPath: loadedSelection.path,
      scenarioSelectionSha256: trim(actualSelectionSha.sha256),
      scenarioSelectionSignatureSha256: trim(loaded.context.scenario_signature_sha256),
    });
  }
  const selectionSignature = trim(loadedSelection.artifact.scenario_signature_sha256);
  if (selectionSignature !== expectedSignature) {
    return buildJudgeContextValidationFailure({
      code: "judge_context_scenario_selection_signature_mismatch",
      pathValue: loaded.path,
      sha256: trim(actualSha.sha256),
      scenarioSelectionPath: loadedSelection.path,
      scenarioSelectionSha256: trim(actualSelectionSha.sha256),
      scenarioSelectionSignatureSha256: selectionSignature,
    });
  }
  const selectionPaths = uniqueSorted(Array.isArray(loadedSelection.artifact.scenario_paths) ? loadedSelection.artifact.scenario_paths : []);
  if (JSON.stringify(selectionPaths) !== JSON.stringify(expectedPaths)) {
    return buildJudgeContextValidationFailure({
      code: "judge_context_scenario_selection_paths_mismatch",
      pathValue: loaded.path,
      sha256: trim(actualSha.sha256),
      scenarioSelectionPath: loadedSelection.path,
      scenarioSelectionSha256: trim(actualSelectionSha.sha256),
      scenarioSelectionSignatureSha256: selectionSignature,
    });
  }
  const expectedEvidencePath = resolvePath(judgeEvidencePath);
  if (!expectedEvidencePath || trim(loaded.context.judge_evidence_path) !== expectedEvidencePath) {
    return buildJudgeContextValidationFailure({
      code: "judge_context_evidence_path_mismatch",
      pathValue: loaded.path,
      sha256: trim(actualSha.sha256),
      scenarioSelectionPath: loadedSelection.path,
      scenarioSelectionSha256: trim(actualSelectionSha.sha256),
      scenarioSelectionSignatureSha256: selectionSignature,
    });
  }
  const expectedEvidenceSha = trim(judgeEvidenceSha256);
  if (!expectedEvidenceSha || trim(loaded.context.judge_evidence_sha256) !== expectedEvidenceSha) {
    return buildJudgeContextValidationFailure({
      code: "judge_context_evidence_sha256_mismatch",
      pathValue: loaded.path,
      sha256: trim(actualSha.sha256),
      scenarioSelectionPath: loadedSelection.path,
      scenarioSelectionSha256: trim(actualSelectionSha.sha256),
      scenarioSelectionSignatureSha256: selectionSignature,
    });
  }
  const expectedObjective = trim(objectiveId);
  if (expectedObjective && trim(loaded.context.objective_id) !== expectedObjective) {
    return buildJudgeContextValidationFailure({
      code: "judge_context_objective_id_mismatch",
      pathValue: loaded.path,
      sha256: trim(actualSha.sha256),
      scenarioSelectionPath: loadedSelection.path,
      scenarioSelectionSha256: trim(actualSelectionSha.sha256),
      scenarioSelectionSignatureSha256: selectionSignature,
    });
  }
  const expectedRubric = trim(judgeRubric);
  if (expectedRubric && trim(loaded.context.judge_rubric) !== expectedRubric) {
    return buildJudgeContextValidationFailure({
      code: "judge_context_judge_rubric_mismatch",
      pathValue: loaded.path,
      sha256: trim(actualSha.sha256),
      scenarioSelectionPath: loadedSelection.path,
      scenarioSelectionSha256: trim(actualSelectionSha.sha256),
      scenarioSelectionSignatureSha256: selectionSignature,
    });
  }
  const expectedScopeIdentity = trim(judgeContextScopeIdentity);
  if (expectedScopeIdentity
    && trim(loaded.context?.scope?.judge_context_scope_identity) !== expectedScopeIdentity) {
    return buildJudgeContextValidationFailure({
      code: "judge_context_scope_identity_mismatch",
      pathValue: loaded.path,
      sha256: trim(actualSha.sha256),
      scenarioSelectionPath: loadedSelection.path,
      scenarioSelectionSha256: trim(actualSelectionSha.sha256),
      scenarioSelectionSignatureSha256: selectionSignature,
    });
  }
  return buildJudgeContextValidationPass({
    pathValue: loaded.path,
    sha256: trim(actualSha.sha256),
    scenarioSelectionPath: loadedSelection.path,
    scenarioSelectionSha256: trim(actualSelectionSha.sha256),
    scenarioSelectionSignatureSha256: selectionSignature,
  });
}
