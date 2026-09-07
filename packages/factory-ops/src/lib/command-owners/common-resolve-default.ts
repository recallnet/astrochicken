import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeIssueUrlArray } from "@hatch/factory-core/issue-url-normalization";

import {
  FACTORY_LABEL_KEYS,
  getFactoryLabelNames,
} from "../factory-label-contract.ts";

const DEFAULT_FEATURE_DOMAIN = "goal-decomposition";
const DEFAULT_SCOPE = "In scope: bootstrap deterministic decomposition continuity. Out of scope: full decomposition refinement.";
const DEFAULT_RISK = "Fallback-generated feature may be coarse and require follow-up decomposition refinement.";

const requireFromFactoryOps = createRequire(import.meta.url);
const FACTORY_OPS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(FACTORY_OPS_DIR, "../../../../../");
const CAPABILITY_CODING_SKILL_ENTRY = "@hatch/capability-coding/skills/code_review/SKILL.md";
const CAPABILITY_MERGE_SKILL_ENTRY = "@hatch/capability-merge/skills/merge_conflict_resolver/SKILL.md";
const CAPABILITY_GOAL_DECOMP_SKILL_ENTRY = "@hatch/capability-goal-decomposition/skills/goal_analyzer/current.md";
const CAPABILITY_BRAINSTORMING_SKILL_ENTRY = "@hatch/capability-brainstorming/skills/red_strategist/SKILL.md";
const CAPABILITY_GOAL_DECOMP_TIMEOUT_DEFAULTS_ENTRY = "@hatch/capability-goal-decomposition/timeouts.defaults.json";
const GOAL_DECOMPOSITION_TIMEOUT_STAGES = Object.freeze([
  "issue_draft",
  "issue_repair",
  "issue_judge",
  "issue_revise",
]);
const STRICT_DURATION_PATTERN = /^\d+(ms|s|m|h|d)$/;
const FALLBACK_ISSUE_SPEC_REASON = "writer_output_unavailable";
const FALLBACK_ISSUE_SPEC_PROVENANCE_MARKER = `<!-- taxi:fallback_issue_spec reason=${FALLBACK_ISSUE_SPEC_REASON} -->`;
const FALLBACK_ISSUE_SPEC_SCHEMA_VERSION = "hatch.issue_spec.fallback.v1";
const DEFAULT_FALLBACK_ISSUE_ACCEPTANCE_CRITERIA = Object.freeze([
  "Feature implementation completes with deterministic, testable behavior.",
]);
const DEFAULT_ACCEPTANCE_CRITERIA = Object.freeze([
  "A single executable feature issue is created from fallback decomposition output.",
  "Goal processing continues into downstream issue-writing and triage stages without manual intervention.",
  "Artifact emit/resume/follow-up contract flows retain deterministic input from the fallback scaffold.",
]);
const GOAL_214_ACCEPTANCE_CRITERIA = Object.freeze([
  ...DEFAULT_ACCEPTANCE_CRITERIA,
  "Goal processing continues into write_issues/triage without manual intervention.",
]);
const DEFAULT_ISSUE_LABELS = getFactoryLabelNames("mothership", [
  FACTORY_LABEL_KEYS.FEATURE,
  FACTORY_LABEL_KEYS.READY,
]).join(",");

export function resolveDefault(value = "", fallback = "") {
  const v = String(value || "").trim();
  return v || String(fallback || "").trim();
}

export function resolveCapabilityCodingSkillsPath({ graphExport = "" } = {}) {
  const graphPath = String(graphExport || "").trim();
  if (graphPath) {
    try {
      const resolvedGraphPath = requireFromFactoryOps.resolve(graphPath);
      return join(dirname(dirname(resolvedGraphPath)), "skills");
    } catch {
      // fall through to workspace fallback
    }
  } else {
    try {
      const resolvedSkillPath = requireFromFactoryOps.resolve(CAPABILITY_CODING_SKILL_ENTRY);
      return resolvedSkillPath.replace(/[\\/]code_review[\\/]SKILL\.md$/, "");
    } catch {
      // fall through to workspace fallback
    }
  }
  const workspaceFallback = resolve(FACTORY_OPS_DIR, "../../../../../packages/capability-coding/skills/code_review/SKILL.md");
  if (existsSync(workspaceFallback)) {
    return workspaceFallback.replace(/[\\/]code_review[\\/]SKILL\.md$/, "");
  }
  throw new Error(
    `[capability-coding] unable to resolve ${CAPABILITY_CODING_SKILL_ENTRY} from package exports or workspace fallback`,
  );
}

export function resolveCapabilityMergeSkillsPath({ graphExport = "" } = {}) {
  const graphPath = String(graphExport || "").trim();
  if (graphPath) {
    try {
      const resolvedGraphPath = requireFromFactoryOps.resolve(graphPath);
      return join(dirname(dirname(resolvedGraphPath)), "skills");
    } catch {
      // fall through to workspace fallback
    }
  } else {
    try {
      const resolvedSkillPath = requireFromFactoryOps.resolve(CAPABILITY_MERGE_SKILL_ENTRY);
      return resolvedSkillPath.replace(/[\\/]merge_conflict_resolver[\\/]SKILL\.md$/, "");
    } catch {
      // fall through to workspace fallback
    }
  }
  const workspaceFallback = resolve(FACTORY_OPS_DIR, "../../../../../packages/capability-merge/skills/merge_conflict_resolver/SKILL.md");
  if (existsSync(workspaceFallback)) {
    return workspaceFallback.replace(/[\\/]merge_conflict_resolver[\\/]SKILL\.md$/, "");
  }
  throw new Error(
    `[capability-merge] unable to resolve ${CAPABILITY_MERGE_SKILL_ENTRY} from package exports or workspace fallback`,
  );
}

export function resolveCapabilityGoalDecompositionSkillsPath({ graphExport = "" } = {}) {
  const graphPath = String(graphExport || "").trim();
  if (graphPath) {
    try {
      const resolvedGraphPath = requireFromFactoryOps.resolve(graphPath);
      return join(dirname(dirname(resolvedGraphPath)), "skills");
    } catch {
      // fall through to workspace fallback
    }
  } else {
    try {
      const resolvedSkillPath = requireFromFactoryOps.resolve(CAPABILITY_GOAL_DECOMP_SKILL_ENTRY);
      return resolvedSkillPath.replace(/[\\/]goal_analyzer[\\/]current\.md$/, "");
    } catch {
      // fall through to workspace fallback
    }
  }
  const workspaceFallback = resolve(FACTORY_OPS_DIR, "../../../../../packages/capability-goal-decomposition/skills/goal_analyzer/current.md");
  if (existsSync(workspaceFallback)) {
    return workspaceFallback.replace(/[\\/]goal_analyzer[\\/]current\.md$/, "");
  }
  throw new Error(
    `[capability-goal-decomposition] unable to resolve ${CAPABILITY_GOAL_DECOMP_SKILL_ENTRY} from package exports or workspace fallback`,
  );
}

export function resolveCapabilityBrainstormingSkillsPath({ graphExport = "" } = {}) {
  const graphPath = String(graphExport || "").trim();
  if (graphPath) {
    try {
      const resolvedGraphPath = requireFromFactoryOps.resolve(graphPath);
      return join(dirname(dirname(resolvedGraphPath)), "skills");
    } catch {
      // fall through to workspace fallback
    }
  } else {
    try {
      const resolvedSkillPath = requireFromFactoryOps.resolve(CAPABILITY_BRAINSTORMING_SKILL_ENTRY);
      return resolvedSkillPath.replace(/[\\/]red_strategist[\\/]SKILL\.md$/, "");
    } catch {
      // fall through to workspace fallback
    }
  }
  const workspaceFallback = resolve(FACTORY_OPS_DIR, "../../../../../packages/capability-brainstorming/skills/red_strategist/SKILL.md");
  if (existsSync(workspaceFallback)) {
    return workspaceFallback.replace(/[\\/]red_strategist[\\/]SKILL\.md$/, "");
  }
  throw new Error(
    `[capability-brainstorming] unable to resolve ${CAPABILITY_BRAINSTORMING_SKILL_ENTRY} from package exports or workspace fallback`,
  );
}

export function resolveFactoryConfigValue({ key = "", fallback = "", configPath = "", env = process.env } = {}) {
  const k = String(key || "").trim();
  const fb = String(fallback || "").trim();
  const path = String(configPath || "").trim();
  if (!k) return fb;

  const envKey = `HATCH_${k.toUpperCase()}`;
  const envValue = String(env?.[envKey] || "").trim();
  if (envValue) return envValue;

  if (!path) return fb;

  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw);
    const value = parsed?.[k];
    if (value === undefined || value === null) return fb;
    const normalized = String(value).trim();
    return normalized || fb;
  } catch {
    return fb;
  }
}

export function loadGoalDecompositionTimeoutDefaults() {
  const resolvedPath = resolveGoalDecompositionTimeoutDefaultsPath();

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(resolvedPath, "utf8"));
  } catch (error) {
    throw new Error(
      `[goal-decomposition-timeouts] malformed defaults file ${resolvedPath}: ${String(error?.message || error)}`,
    );
  }

  if (!isPlainObject(parsed)) {
    throw new Error(`[goal-decomposition-timeouts] malformed defaults file ${resolvedPath}: expected JSON object`);
  }

  const defaults = {};
  const allowed = new Set(GOAL_DECOMPOSITION_TIMEOUT_STAGES);
  for (const key of Object.keys(parsed)) {
    if (!allowed.has(key)) {
      throw new Error(
        `[goal-decomposition-timeouts] malformed defaults file ${resolvedPath}: unknown stage "${key}"`,
      );
    }
  }

  for (const stage of GOAL_DECOMPOSITION_TIMEOUT_STAGES) {
    const value = normalizeDurationString(parsed[stage]);
    if (!value || !STRICT_DURATION_PATTERN.test(value)) {
      throw new Error(
        `[goal-decomposition-timeouts] malformed defaults file ${resolvedPath}: ${stage} must match /^\\d+(ms|s|m|h|d)$/`,
      );
    }
    defaults[stage] = value;
  }

  return defaults;
}

export function resolveGoalDecompositionTimeout({ stage = "", factoryConfig = {} } = {}) {
  const normalizedStage = normalizeDurationString(stage);
  const allowed = new Set(GOAL_DECOMPOSITION_TIMEOUT_STAGES);
  if (!allowed.has(normalizedStage)) {
    throw new Error(
      `[goal-decomposition-timeouts] unknown stage "${normalizedStage || stage}"; expected one of ${GOAL_DECOMPOSITION_TIMEOUT_STAGES.join(", ")}`,
    );
  }

  const defaults = loadGoalDecompositionTimeoutDefaults();
  const overrideValue = readGoalDecompositionTimeoutOverride(factoryConfig, normalizedStage);

  if (overrideValue && !STRICT_DURATION_PATTERN.test(overrideValue)) {
    throw new Error(
      `[goal-decomposition-timeouts] capabilities.goal_decomposition.timeouts.${normalizedStage} must match /^\\d+(ms|s|m|h|d)$/`,
    );
  }

  const timeout = overrideValue || defaults[normalizedStage];
  if (!timeout || !STRICT_DURATION_PATTERN.test(timeout)) {
    throw new Error(
      `[goal-decomposition-timeouts] resolved timeout for stage "${normalizedStage}" must match /^\\d+(ms|s|m|h|d)$/`,
    );
  }

  return timeout;
}

export function resolveBoolean(value = "", fallback = false) {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return fallback ? "true" : "false";
  return ["1", "true", "yes", "y", "on"].includes(v) ? "true" : "false";
}

export function normalizeApproved(value = "") {
  const v = String(value || "").trim().toLowerCase();
  if (["1", "true", "yes"].includes(v)) return "true";
  // Fallback: the LLM may return prose before a JSON block (violating "Return JSON only").
  // Try to extract approved from a JSON object embedded anywhere in the string.
  const extracted = extractApprovedFromJsonBlock(String(value || ""));
  if (extracted !== null) return extracted ? "true" : "false";
  return "false";
}

/**
 * Attempt to extract the `approved` boolean from a JSON block embedded in
 * arbitrary text (e.g. prose preamble followed by ```json ... ```).
 * Returns true/false when a parseable object with an `approved` field is found,
 * or null when no such block is detected.
 */
function extractApprovedFromJsonBlock(input = "") {
  // Try each ```json ... ``` fence (or ``` ... ```) found anywhere in the string.
  const fencePattern = /```(?:json)?\s*\n([\s\S]*?)\n```/gi;
  let match;
  while ((match = fencePattern.exec(input)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (isPlainObject(parsed) && "approved" in parsed) {
        const raw = String(parsed.approved ?? "").trim().toLowerCase();
        return ["1", "true", "yes", true].includes(parsed.approved) || raw === "true";
      }
    } catch {
      // keep looking
    }
  }
  // Also try to recover a bare JSON object embedded in arbitrary trailing text.
  for (let start = input.lastIndexOf("{"); start !== -1; start = input.lastIndexOf("{", start - 1)) {
    for (let end = input.indexOf("}", start); end !== -1; end = input.indexOf("}", end + 1)) {
      try {
        const candidate = input.slice(start, end + 1);
        const parsed = JSON.parse(candidate);
        if (isPlainObject(parsed) && "approved" in parsed) {
          const raw = String(parsed.approved ?? "").trim().toLowerCase();
          return ["1", "true", "yes", true].includes(parsed.approved) || raw === "true";
        }
      } catch {
        // keep scanning candidate object boundaries
      }
    }
  }
  return null;
}

export function normalizeDecision(value = "") {
  const v = String(value || "").trim().toLowerCase();
  return v === "approved" ? "approved" : "revise";
}

export function validateIssueSpecDraft(issueSpecRaw = "", featureRaw = "") {
  const parsed = parseIssueSpec(issueSpecRaw);
  if (parsed) {
    return JSON.stringify({
      ok: true,
      error: "",
      retry_prompt: "",
      issue_spec: JSON.stringify(parsed),
      issue_spec_b64: Buffer.from(JSON.stringify(parsed), "utf8").toString("base64"),
    });
  }

  const feature = parseFeature(featureRaw);
  const featureSummary = {
    id: normalizeStrictString(feature.id),
    name: normalizeStrictString(feature.name),
    summary: normalizeStrictString(feature.summary),
    scope: normalizeStrictString(feature.scope),
  };
  return JSON.stringify({
    ok: false,
    error: "issue spec must be JSON with non-empty issue_title and issue_body",
    retry_prompt: [
      "Your previous issue spec failed deterministic validation.",
      "Return JSON only with non-empty keys issue_title, issue_body, and issue_labels.",
      "Do not wrap the JSON in prose or markdown fences.",
      "Do not omit issue_body.",
      "Feature context:",
      JSON.stringify(featureSummary, null, 2),
    ].join("\n"),
    issue_spec: "",
    issue_spec_b64: "",
  });
}

export function incrementCounter(value = "0") {
  const raw = String(value || "0").trim();
  const n = Number.parseInt(raw, 10);
  return String((Number.isFinite(n) ? n : 0) + 1);
}

export function buildRetrySignal({ decomposeParseStatus = "", decomposeParseError = "", decomposeAttempts = "" } = {}) {
  const attemptParsed = Number.parseInt(String(decomposeAttempts || "").trim(), 10);
  const attempt = Number.isFinite(attemptParsed) && attemptParsed > 0 ? attemptParsed : 1;
  const status = String(decomposeParseStatus || "").trim() || "unknown";
  const error = String(decomposeParseError || "").trim() || "none";
  return [
    `RETRY FEEDBACK (attempt ${attempt}): Previous decompose output was rejected.`,
    `Status: ${status}. Error: ${error}.`,
    "You MUST return a non-empty JSON array of feature objects.",
    "Do not return []. Do not return null. Do not return a plain JSON object — only an array.",
  ].join("\n");
}

export function countJsonItems(raw = "") {
  try {
    const parsed = JSON.parse(String(raw || "[]"));
    return String(Array.isArray(parsed) ? parsed.length : 0);
  } catch {
    return "0";
  }
}

export function countFeatureObjects(raw = "") {
  const parsed = parseFeatureArray(resolveJsonInput(raw, ""));
  if (!parsed.ok || !Array.isArray(parsed.value)) return "0";
  const objectCount = parsed.value.filter((item) => isPlainObject(item)).length;
  return String(objectCount);
}

export function inspectJson(raw = "", filePath = "") {
  const s = resolveJsonInput(raw, filePath);
  const inspected = inspectFeatureCandidate(s);
  return JSON.stringify({
    decompose_parse_status: inspected.status,
    decompose_parse_error: inspected.error,
    decompose_proposed_excerpt: inspected.excerpt,
  });
}

export function fallbackJson(raw = "", filePath = "", options = {}) {
  const s = resolveJsonInput(raw, filePath);
  const goalNumber = normalizeScalar(options?.goalNumber);
  const goalTitle = normalizeScalar(options?.goalTitle);
  const parsed = parseFeatureArray(s);
  const candidates = parsed.ok ? parsed.value : [];
  const normalized = normalizeFeatureList(candidates, { goalNumber, goalTitle });
  return JSON.stringify(normalized);
}

export function inspectJsonPair(primaryRaw = "", secondaryRaw = "") {
  const chosen = selectUsableFeatureCandidate(primaryRaw, secondaryRaw);
  if (chosen.ok) {
    return JSON.stringify({
      decompose_parse_status: "valid_json",
      decompose_parse_error: "",
      decompose_proposed_excerpt: chosen.raw.slice(0, 400),
      decompose_parse_source: chosen.source,
    });
  }

  const { primary, secondary } = chosen;
  const diag = primary.hasInput ? primary : secondary;
  const source = primary.hasInput ? "primary" : "secondary";
  return JSON.stringify({
    decompose_parse_status: diag.status,
    decompose_parse_error: diag.error,
    decompose_proposed_excerpt: diag.excerpt,
    decompose_parse_source: source,
  });
}

export function fallbackJsonPair(primaryRaw = "", secondaryRaw = "") {
  const chosen = selectUsableFeatureCandidate(primaryRaw, secondaryRaw);
  return chosen.ok ? chosen.raw : "[]";
}

export function fallbackIssueSpec(issueSpecRaw = "", featureRaw = "") {
  const existing = parseIssueSpec(issueSpecRaw);
  if (existing) return JSON.stringify(existing);

  const feature = parseFeature(featureRaw);
  const title = normalizeStrictString(feature.name) || normalizeStrictString(feature.slug) || "Bootstrap feature";
  const summary = normalizeStrictString(feature.summary) || "Deterministic fallback issue spec generated because writer output was unavailable.";
  const scope = normalizeStrictString(feature.scope);
  const acceptance = normalizeStrictStringArray(feature.acceptance_criteria, DEFAULT_FALLBACK_ISSUE_ACCEPTANCE_CRITERIA);
  const risks = normalizeStrictStringArray(feature.risks, []);

  const bodyLines = [
    "## Summary",
    summary,
    "",
  ];
  if (scope) {
    bodyLines.push("## Scope", scope, "");
  }
  bodyLines.push("## Acceptance Criteria", ...acceptance.map((item) => `- ${item}`), "");
  if (risks.length > 0) {
    bodyLines.push("## Risks", ...risks.map((item) => `- ${item}`), "");
  }

  const renderedBody = bodyLines.join("\n").trim();
  const issue_body = renderedBody.includes(FALLBACK_ISSUE_SPEC_PROVENANCE_MARKER)
    ? renderedBody
    : `${renderedBody}\n\n${FALLBACK_ISSUE_SPEC_PROVENANCE_MARKER}`;

  return JSON.stringify({
    issue_title: title,
    issue_body,
    issue_labels: DEFAULT_ISSUE_LABELS,
    issue_spec_source: "fallback",
    issue_spec_fallback_reason: FALLBACK_ISSUE_SPEC_REASON,
    issue_spec_fallback_schema: FALLBACK_ISSUE_SPEC_SCHEMA_VERSION,
  });
}

export function normalizeFeatureIssueSpec(issueSpecRaw = "", featureRaw = "") {
  const normalized = JSON.parse(fallbackIssueSpec(issueSpecRaw, featureRaw));
  const labels = normalizeFeatureIssueLabels(normalized.issue_labels);
  return JSON.stringify({
    ...normalized,
    issue_labels: labels,
  });
}

export function fallbackIssueSpecBundle(issueSpecRaw = "", featureRaw = "") {
  return JSON.stringify(buildIssueSpecBundle(fallbackIssueSpec(issueSpecRaw, featureRaw)));
}

export function normalizeFeatureIssueSpecBundle(issueSpecRaw = "", featureRaw = "") {
  return JSON.stringify(buildIssueSpecBundle(normalizeFeatureIssueSpec(issueSpecRaw, featureRaw)));
}

function parseIssueSpec(raw = "") {
  try {
    const parsed = JSON.parse(stripMarkdownJsonFences(raw));
    if (!isPlainObject(parsed)) return null;
    const issue_title = normalizeStrictString(parsed.issue_title);
    const issue_body = normalizeStrictString(parsed.issue_body);
    const issue_labels = normalizeIssueLabels(parsed.issue_labels);
    if (!issue_title || !issue_body) return null;

    const issue_spec_source = normalizeStrictString(parsed.issue_spec_source);
    const issue_spec_fallback_reason = normalizeStrictString(parsed.issue_spec_fallback_reason);
    const issue_spec_fallback_schema = normalizeStrictString(parsed.issue_spec_fallback_schema);
    const hasFallbackMarker = issue_body.includes(FALLBACK_ISSUE_SPEC_PROVENANCE_MARKER);

    const resolvedIssueSpecSource = issue_spec_source || (hasFallbackMarker ? "fallback" : "");
    const shouldBackfillFallbackMetadata = resolvedIssueSpecSource === "fallback";
    const resolvedIssueSpecFallbackReason = issue_spec_fallback_reason
      || (shouldBackfillFallbackMetadata ? FALLBACK_ISSUE_SPEC_REASON : "");
    const resolvedIssueSpecFallbackSchema = issue_spec_fallback_schema
      || (shouldBackfillFallbackMetadata ? FALLBACK_ISSUE_SPEC_SCHEMA_VERSION : "");

    const normalized = {
      issue_title,
      issue_body,
      issue_labels: issue_labels || DEFAULT_ISSUE_LABELS,
    };

    if (resolvedIssueSpecSource) normalized.issue_spec_source = resolvedIssueSpecSource;
    if (resolvedIssueSpecFallbackReason) normalized.issue_spec_fallback_reason = resolvedIssueSpecFallbackReason;
    if (resolvedIssueSpecFallbackSchema) normalized.issue_spec_fallback_schema = resolvedIssueSpecFallbackSchema;

    return normalized;
  } catch {
    return null;
  }
}

function parseFeature(raw = "") {
  try {
    const parsed = JSON.parse(stripMarkdownJsonFences(raw));
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function stripMarkdownJsonFences(input = "") {
  const s = String(input || "").trim();
  const fenced = s.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/i);
  if (fenced?.[1]) return fenced[1].trim();
  return s;
}

/** Read JSON content from --raw arg or --file path. */
function resolveJsonInput(raw = "", filePath = "") {
  const value = raw ? String(raw) : (filePath ? readFileSync(filePath, "utf-8") : "");
  return stripMarkdownJsonFences(value);
}

function normalizeStrictString(value = "") {
  if (typeof value !== "string") return "";
  return value.trim();
}

function resolveGoalDecompositionTimeoutDefaultsPath() {
  try {
    return requireFromFactoryOps.resolve(CAPABILITY_GOAL_DECOMP_TIMEOUT_DEFAULTS_ENTRY);
  } catch {
    // fall through to local workspace resolution
  }

  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const workspaceFallback = resolve(moduleDir, "../../../../../packages/capability-goal-decomposition/timeouts.defaults.json");
  if (existsSync(workspaceFallback)) {
    return workspaceFallback;
  }

  throw new Error(
    `[goal-decomposition-timeouts] unable to resolve ${CAPABILITY_GOAL_DECOMP_TIMEOUT_DEFAULTS_ENTRY} from package exports or workspace fallback`,
  );
}

function normalizeDurationString(value = "") {
  if (typeof value !== "string") return "";
  return value.trim();
}

function readGoalDecompositionTimeoutOverride(factoryConfig = {}, stage = "") {
  if (!isPlainObject(factoryConfig)) return "";

  const capabilities = factoryConfig.capabilities;
  if (capabilities === undefined) return "";
  if (!isPlainObject(capabilities)) {
    throw new Error("[goal-decomposition-timeouts] capabilities must be an object when provided");
  }

  const goalDecomposition = capabilities.goal_decomposition;
  if (goalDecomposition === undefined) return "";
  if (!isPlainObject(goalDecomposition)) {
    throw new Error("[goal-decomposition-timeouts] capabilities.goal_decomposition must be an object when provided");
  }

  const timeouts = goalDecomposition.timeouts;
  if (timeouts === undefined) return "";
  if (!isPlainObject(timeouts)) {
    throw new Error("[goal-decomposition-timeouts] capabilities.goal_decomposition.timeouts must be an object when provided");
  }

  const raw = timeouts[stage];
  if (raw === undefined) return "";
  if (typeof raw !== "string") {
    throw new Error(
      `[goal-decomposition-timeouts] capabilities.goal_decomposition.timeouts.${stage} must be a string when provided`,
    );
  }

  return normalizeDurationString(raw);
}

function normalizeScalar(value = "") {
  return String(value || "").trim();
}

function decodeBase64Utf8IfValid(input = "") {
  const raw = String(input || "").replace(/\s+/g, "");
  if (!raw) return "";
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) return "";
  if (raw.length % 4 !== 0) return "";

  try {
    const decoded = Buffer.from(raw, "base64").toString("utf8");
    const roundTrip = Buffer.from(decoded, "utf8").toString("base64");
    return roundTrip === raw ? decoded : "";
  } catch {
    return "";
  }
}

function parseJsonWithBase64Fallback(raw = "") {
  const text = String(raw || "");
  try {
    return { ok: true, value: JSON.parse(text), usedBase64Decode: false };
  } catch {
    const decoded = decodeBase64Utf8IfValid(text);
    if (!decoded) return { ok: false, value: null, usedBase64Decode: false };
    try {
      return {
        ok: true,
        value: JSON.parse(stripMarkdownJsonFences(decoded)),
        usedBase64Decode: true,
      };
    } catch {
      return { ok: false, value: null, usedBase64Decode: true };
    }
  }
}

function unwrapFeaturePayload(value, { allowStringFailure = false } = {}) {
  let parsed = value;

  for (let i = 0; i < 4; i += 1) {
    if (typeof parsed === "string") {
      const reparsed = parseJsonWithBase64Fallback(stripMarkdownJsonFences(parsed));
      if (!reparsed.ok) {
        return {
          ok: allowStringFailure,
          value: parsed,
          stringUnwrapFailed: true,
        };
      }
      parsed = reparsed.value;
      continue;
    }

    if (isPlainObject(parsed)) {
      if (Array.isArray(parsed.features)) {
        parsed = parsed.features;
        continue;
      }
      if (Array.isArray(parsed.approved_features)) {
        parsed = parsed.approved_features;
        continue;
      }
      if (Array.isArray(parsed.proposed_features)) {
        parsed = parsed.proposed_features;
        continue;
      }
    }

    break;
  }

  return { ok: true, value: parsed, stringUnwrapFailed: false };
}

function parseFeatureArray(raw = "") {
  const parsedRoot = parseJsonWithBase64Fallback(String(raw || "[]"));
  if (!parsedRoot.ok) return { ok: false, value: [] };

  const unwrapped = unwrapFeaturePayload(parsedRoot.value);
  if (!unwrapped.ok) return { ok: false, value: [] };
  if (!Array.isArray(unwrapped.value)) return { ok: false, value: [] };
  return { ok: true, value: unwrapped.value };
}

function inspectFeatureCandidate(raw = "") {
  const stripped = stripMarkdownJsonFences(raw);
  const excerpt = stripped.slice(0, 400).replace(/\n/g, "\\n");

  if (!stripped) {
    return {
      hasInput: false,
      usable: false,
      status: "invalid_json",
      error: "decomposition output is empty",
      excerpt,
      parsed: [],
      raw: "",
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(stripped);
  } catch (e) {
    const withDecodeFallback = parseJsonWithBase64Fallback(stripped);
    if (!withDecodeFallback.ok || !withDecodeFallback.usedBase64Decode) {
      return {
        hasInput: true,
        usable: false,
        status: "invalid_json",
        error: String(e?.message || e).slice(0, 200),
        excerpt,
        parsed: [],
        raw: stripped,
      };
    }
    parsed = withDecodeFallback.value;
  }

  const unwrapped = unwrapFeaturePayload(parsed, { allowStringFailure: true });
  if (!unwrapped.ok || unwrapped.stringUnwrapFailed) {
    return {
      hasInput: true,
      usable: false,
      status: "invalid_json",
      error: "decomposition output is a string that cannot be re-parsed as JSON",
      excerpt,
      parsed: [],
      raw: stripped,
    };
  }

  parsed = unwrapped.value;
  if (!Array.isArray(parsed)) {
    return {
      hasInput: true,
      usable: false,
      status: "non_array_json",
      error: "decomposition output must be a JSON array",
      excerpt,
      parsed: [],
      raw: stripped,
    };
  }

  if (parsed.length === 0) {
    return {
      hasInput: true,
      usable: false,
      status: "empty_array",
      error: "decomposition array is empty",
      excerpt,
      parsed,
      raw: stripped,
    };
  }

  if (!parsed.some((item) => isPlainObject(item))) {
    return {
      hasInput: true,
      usable: false,
      status: "empty_feature_objects",
      error: "decomposition array has no feature objects",
      excerpt,
      parsed,
      raw: stripped,
    };
  }

  return {
    hasInput: true,
    usable: true,
    status: "valid_json",
    error: "",
    excerpt,
    parsed,
    raw: stripped,
  };
}

function selectUsableFeatureCandidate(primaryRaw = "", secondaryRaw = "") {
  const primary = inspectFeatureCandidate(primaryRaw);
  if (primary.usable) {
    return {
      ok: true,
      source: "primary",
      raw: JSON.stringify(primary.parsed),
      primary,
      secondary: inspectFeatureCandidate(secondaryRaw),
    };
  }

  const secondary = inspectFeatureCandidate(secondaryRaw);
  if (secondary.usable) {
    return {
      ok: true,
      source: "secondary",
      raw: JSON.stringify(secondary.parsed),
      primary,
      secondary,
    };
  }

  return { ok: false, source: "", raw: "", primary, secondary };
}

function normalizeFeatureList(items = [], { goalNumber = "", goalTitle = "" } = {}) {
  const source = Array.isArray(items) ? items : [];
  const objectItems = source.filter((item) => isPlainObject(item));
  const normalized = objectItems
    .map((item, idx) => normalizeFeatureItem(item, { index: idx, goalNumber, goalTitle }))
    .filter(Boolean);
  if (normalized.length > 0) return normalized;
  return [normalizeFeatureItem({}, { index: 0, goalNumber, goalTitle })];
}

function normalizeFeatureItem(item = {}, { index = 0, goalNumber = "", goalTitle = "" } = {}) {
  const ordinal = Number.isFinite(index) && index >= 0 ? index + 1 : 1;
  const fallbackName = goalTitle
    ? `Bootstrap decomposition for ${goalTitle}`
    : `Bootstrap decomposition feature ${ordinal}${goalNumber ? ` (goal #${goalNumber})` : ""}`;
  const fallbackSummary = goalNumber
    ? `Deterministic fallback scaffold generated for goal #${goalNumber} because decomposition output was malformed or empty.`
    : "Deterministic fallback scaffold generated because decomposition output was malformed or empty.";
  const fallbackSlug = slugify(`goal-${goalNumber || "x"}-bootstrap-feature-${ordinal}`) || `bootstrap-feature-${ordinal}`;

  const base = isPlainObject(item) ? item : {};
  const name = normalizeScalar(base.name) || fallbackName;
  const summary = normalizeScalar(base.summary) || fallbackSummary;

  const acceptance = normalizeStringArray(base.acceptance_criteria, resolveBootstrapAcceptanceCriteria(goalNumber));

  return {
    ...base,
    id: normalizeScalar(base.id) || `F-${ordinal}`,
    name,
    summary,
    scope: normalizeScalar(base.scope) || DEFAULT_SCOPE,
    acceptance_criteria: mergeRequiredAcceptanceCriteria({ goalNumber, acceptance }),
    domain: normalizeScalar(base.domain) || DEFAULT_FEATURE_DOMAIN,
    slug: slugify(normalizeScalar(base.slug) || name) || fallbackSlug,
    dependencies: normalizeStringArray(base.dependencies, []),
    risks: normalizeStringArray(base.risks, [DEFAULT_RISK]),
  };
}

export function resolveBootstrapAcceptanceCriteria(goalNumber = "") {
  return normalizeScalar(goalNumber) === "214"
    ? [...GOAL_214_ACCEPTANCE_CRITERIA]
    : [...DEFAULT_ACCEPTANCE_CRITERIA];
}

function mergeRequiredAcceptanceCriteria({ goalNumber = "", acceptance = [] } = {}) {
  const list = Array.isArray(acceptance)
    ? acceptance.map((entry) => normalizeScalar(entry)).filter(Boolean)
    : [];
  if (normalizeScalar(goalNumber) !== "214") return list;

  const required = resolveBootstrapAcceptanceCriteria("214");
  const requiredSet = new Set(required);
  const extras = [];
  const seenExtra = new Set();

  for (const entry of list) {
    if (requiredSet.has(entry)) continue;
    if (seenExtra.has(entry)) continue;
    extras.push(entry);
    seenExtra.add(entry);
  }

  return [...required, ...extras];
}

function normalizeIssueLabels(value) {
  if (typeof value === "string") {
    const direct = value
      .split(",")
      .map((entry) => normalizeStrictString(entry))
      .filter(Boolean);
    return Array.from(new Set(direct)).join(",");
  }

  if (Array.isArray(value)) {
    const labels = value
      .map((entry) => normalizeStrictString(entry))
      .filter(Boolean);
    return Array.from(new Set(labels)).join(",");
  }

  return "";
}

function normalizeFeatureIssueLabels(value) {
  const labels = normalizeIssueLabels(value)
    .split(",")
    .map((entry) => normalizeStrictString(entry))
    .filter(Boolean);
  const seen = new Set();
  const out = [];
  const excluded = new Set([getFactoryLabelNames("mothership", [FACTORY_LABEL_KEYS.GOAL])[0]]);
  const bugLabel = getFactoryLabelNames("mothership", [FACTORY_LABEL_KEYS.BUG])[0];
  const featureLabel = getFactoryLabelNames("mothership", [FACTORY_LABEL_KEYS.FEATURE])[0];
  for (const label of labels) {
    if (excluded.has(label)) continue;
    if (seen.has(label)) continue;
    out.push(label);
    seen.add(label);
  }
  // bug and feature are mutually exclusive — if the LLM classified this as a
  // bug, do not force-add the feature label. Always ensure ready is present.
  const hasBug = seen.has(bugLabel);
  const requiredKeys = hasBug
    ? [FACTORY_LABEL_KEYS.READY]
    : [FACTORY_LABEL_KEYS.FEATURE, FACTORY_LABEL_KEYS.READY];
  // If both bug and feature were explicitly provided by the LLM, strip feature.
  if (hasBug && seen.has(featureLabel)) {
    const featureIndex = out.indexOf(featureLabel);
    if (featureIndex !== -1) out.splice(featureIndex, 1);
    seen.delete(featureLabel);
  }
  for (const required of getFactoryLabelNames("mothership", requiredKeys)) {
    if (seen.has(required)) continue;
    out.push(required);
    seen.add(required);
  }
  return out.join(",");
}

function buildIssueSpecBundle(issueSpecRaw = "") {
  const issueSpec = String(issueSpecRaw || "");
  return {
    issue_spec: issueSpec,
    issue_spec_b64: Buffer.from(issueSpec, "utf8").toString("base64"),
  };
}

function normalizeStrictStringArray(value, fallback = []) {
  const list = Array.isArray(value)
    ? value.map((entry) => normalizeStrictString(entry)).filter(Boolean)
    : [];
  if (list.length > 0) return list;
  return Array.isArray(fallback) ? fallback.map((entry) => normalizeStrictString(entry)).filter(Boolean) : [];
}

function normalizeStringArray(value, fallback = []) {
  const list = Array.isArray(value)
    ? value.map((entry) => normalizeScalar(entry)).filter(Boolean)
    : [];
  if (list.length > 0) return list;
  return Array.isArray(fallback) ? fallback.map((entry) => normalizeScalar(entry)).filter(Boolean) : [];
}

function slugify(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
