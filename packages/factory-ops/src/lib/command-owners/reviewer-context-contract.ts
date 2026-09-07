// Reuse integration points from #213/#322:
// - review evidence artifact contract (issue_changed_files, snapshot_sha, qa fields)
// - shared-branch issue scoping via snapshot range
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { trim } from "../cli-helpers.ts";
import {
  buildNamedPacketEnvelope,
  makePacketId,
  validateNamedPacketBase,
  validateRegisteredPacketType,
} from "../packet-core.ts";
import { reusePersistedPacketCreatedAt } from "../persisted-packet-created-at.ts";
import { buildVerdictEnvelope } from "../verdict-envelope.ts";

export const REVIEWER_CONTEXT_SCHEMA_VERSION = "reviewer_context/v1";
export const REVIEWER_CONTEXT_PACKET_TYPE = "reviewer_context_packet";
export const REVIEW_CONTEXT_PRIMARY_REASON_CODE = "REVIEW_CONTEXT_INVALID";

const REVIEW_POLICY_SCHEMA_VERSION = "review_policy/v1";
const POLICY_SOURCE_GLOBAL_ID = "global_policy";
const POLICY_SOURCE_REPO_ID = "repo_policy";

export const REVIEWER_CONTEXT_REQUIRED_KEYS = [
  "schema_version",
  "issue_number",
  "issue_excerpt",
  "branch",
  "snapshot_sha",
  "issue_commit_subjects",
  "diff_summary",
  "changed_files",
  "evidence_artifact_path",
  "evidence_artifact_sha256",
  "policy_refs",
  "policy_sources",
  "effective_policy",
];

const DEFAULT_GLOBAL_POLICY_PATH = "packages/factory-skills/skills/code_review/SKILL.md";
const DEFAULT_REPO_POLICY_PATH = "packages/factory-skills/skills/code_review/REPO.md";


function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeIssueExcerpt(value = "") {
  const collapsed = trim(value).replace(/\s+/g, " ");
  return collapsed ? collapsed.slice(0, 1200) : "(missing issue excerpt)";
}

function normalizePathArray(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const item of value) {
    const next = trim(item);
    if (!next || seen.has(next)) continue;
    seen.add(next);
    out.push(next);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function asCountString(value, fallback = "0") {
  const parsed = Number.parseInt(trim(value), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return String(parsed);
}

function sha256Hex(input) {
  return createHash("sha256").update(input).digest("hex");
}

function resolvePath(pathValue = "") {
  const raw = trim(pathValue);
  if (!raw) return "";
  return isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
}

function resolveDefaultReviewEvidencePath({ reviewEvidencePath = "", worktreeDir = "", issueNumber = "" } = {}) {
  const explicit = resolvePath(reviewEvidencePath);
  if (explicit) return explicit;

  const issue = trim(issueNumber);
  if (!issue) return "";

  const worktreeRoot = resolvePath(worktreeDir);
  const fallbackCandidates = [
    worktreeRoot ? join(worktreeRoot, ".hatch", "review", `${issue}.json`) : "",
    resolve(process.cwd(), ".hatch", "review", `${issue}.json`),
  ].filter(Boolean);

  for (const candidate of fallbackCandidates) {
    if (existsSync(candidate)) return candidate;
  }

  return fallbackCandidates[0] || "";
}

function loadJsonFile(pathValue = "") {
  const resolved = resolvePath(pathValue);
  if (!resolved) {
    return { ok: false, code: "missing_review_evidence_path", data: null, path: "" };
  }
  if (!existsSync(resolved)) {
    return { ok: false, code: "review_evidence_not_found", data: null, path: resolved };
  }
  try {
    return {
      ok: true,
      code: "ok",
      data: JSON.parse(readFileSync(resolved, "utf8")),
      path: resolved,
    };
  } catch {
    return { ok: false, code: "review_evidence_invalid_json", data: null, path: resolved };
  }
}

function readFileSha256(pathValue = "") {
  const resolved = resolvePath(pathValue);
  if (!resolved || !existsSync(resolved)) {
    return { ok: false, sha256: "", path: resolved };
  }
  const bytes = readFileSync(resolved);
  return { ok: true, sha256: sha256Hex(bytes), path: resolved };
}

function gitLogSubjects({ worktreeDir = "", range = "" } = {}) {
  const wd = trim(worktreeDir);
  const logRange = trim(range);
  if (!wd || !logRange) return [];
  const out = spawnSync("git", ["-C", wd, "log", "--format=%s", "--reverse", logRange], { encoding: "utf8" });
  if ((out.status ?? 1) !== 0) return [];
  return String(out.stdout || "")
    .split(/\r?\n/)
    .map((line) => trim(line))
    .filter(Boolean);
}

function slugify(value = "") {
  return trim(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "untitled";
}

function parseScalar(rawValue = "") {
  const value = trim(rawValue);
  if (!value) return "";
  if (/^"[\s\S]*"$/.test(value) || /^'[\s\S]*'$/.test(value)) return value.slice(1, -1);
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?[0-9]+(?:\.[0-9]+)?$/.test(value)) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (/^\[[\s\S]*\]$/.test(value)) {
    const body = value.slice(1, -1).trim();
    if (!body) return [];
    return body
      .split(",")
      .map((entry) => parseScalar(entry))
      .filter((entry) => !(typeof entry === "string" && entry === ""));
  }
  return value;
}

function parseFrontmatter(raw = "") {
  if (!raw.startsWith("---")) return { ok: true, frontmatter: {}, body: raw };
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)([\s\S]*)$/);
  if (!match) {
    return { ok: false, code: "policy_frontmatter_unterminated", frontmatter: {}, body: raw };
  }

  const frontmatter = {};
  const lines = String(match[1] || "").split(/\r?\n/);
  for (const lineRaw of lines) {
    const line = trim(lineRaw);
    if (!line || line.startsWith("#")) continue;
    const kv = line.match(/^([A-Za-z0-9_.-]+):\s*(.+)$/);
    if (!kv) {
      return { ok: false, code: "policy_frontmatter_invalid_line", frontmatter: {}, body: raw };
    }
    frontmatter[kv[1]] = parseScalar(kv[2]);
  }

  return { ok: true, frontmatter, body: String(match[2] || "") };
}

function parseMarkdownPolicy(raw = "") {
  const frontmatterParsed = parseFrontmatter(raw);
  if (!frontmatterParsed.ok) {
    return { ok: false, code: frontmatterParsed.code, policy: null, format: "markdown" };
  }

  const sections = {};
  let currentSection = "preamble";
  let buffer = [];

  const flushSection = () => {
    const text = trim(buffer.join("\n"));
    if (text) sections[currentSection] = text;
    buffer = [];
  };

  const lines = String(frontmatterParsed.body || "").split(/\r?\n/);
  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (heading) {
      flushSection();
      currentSection = `h${heading[1].length}.${slugify(heading[2])}`;
      continue;
    }
    buffer.push(line);
  }
  flushSection();

  const policy = sortObjectDeep({
    frontmatter: frontmatterParsed.frontmatter,
    sections,
  });

  const hasFrontmatter = Object.keys(policy.frontmatter || {}).length > 0;
  const hasSections = Object.keys(policy.sections || {}).length > 0;
  if (!hasFrontmatter && !hasSections) {
    return { ok: false, code: "policy_markdown_empty", policy: null, format: "markdown" };
  }

  return { ok: true, code: "ok", policy, format: "markdown" };
}

function parseJsonPolicy(raw = "") {
  try {
    const parsed = JSON.parse(raw);
    if (!isPlainObject(parsed)) {
      return { ok: false, code: "policy_json_not_object", policy: null, format: "json" };
    }
    return { ok: true, code: "ok", policy: sortObjectDeep(parsed), format: "json" };
  } catch {
    return { ok: false, code: "policy_json_invalid", policy: null, format: "json" };
  }
}

function countPolicyKeys(value) {
  if (Array.isArray(value)) {
    return value.reduce((total, item) => total + countPolicyKeys(item), 0);
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) return 0;
    return keys.reduce((total, key) => total + 1 + countPolicyKeys(value[key]), 0);
  }
  return 1;
}

function deepMerge(base, overlay) {
  if (Array.isArray(overlay)) return overlay.map((item) => sortObjectDeep(item));
  if (!isPlainObject(overlay)) return overlay;

  const out = isPlainObject(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(overlay)) {
    if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = deepMerge(out[key], value);
    } else {
      out[key] = deepMerge(undefined, value);
    }
  }
  return out;
}

function sortObjectDeep(value) {
  if (Array.isArray(value)) return value.map((item) => sortObjectDeep(item));
  if (!isPlainObject(value)) return value;
  const out = {};
  for (const key of Object.keys(value).sort((a, b) => a.localeCompare(b))) {
    out[key] = sortObjectDeep(value[key]);
  }
  return out;
}

function loadPolicySource({ id = "", order = 0, pathValue = "" } = {}) {
  const resolved = resolvePath(pathValue);
  if (!resolved) {
    return { ok: false, code: `${id}_policy_path_missing`, source: null, ref: null, policy: null };
  }
  if (!existsSync(resolved)) {
    return { ok: false, code: `${id}_policy_not_found`, source: null, ref: null, policy: null };
  }

  let raw = "";
  try {
    raw = readFileSync(resolved, "utf8");
  } catch {
    return { ok: false, code: `${id}_policy_read_failed`, source: null, ref: null, policy: null };
  }

  const isJsonSource = resolved.toLowerCase().endsWith(".json");
  const parsed = isJsonSource ? parseJsonPolicy(raw) : parseMarkdownPolicy(raw);
  if (!parsed.ok || !parsed.policy) {
    return { ok: false, code: `${id}_${parsed.code || "policy_parse_failed"}`, source: null, ref: null, policy: null };
  }

  const sourceSha = sha256Hex(raw);
  const source = {
    id,
    order,
    path: resolved,
    sha256: sourceSha,
    loaded: true,
    format: parsed.format,
    key_count: String(countPolicyKeys(parsed.policy)),
  };

  const ref = {
    id,
    precedence: order,
    path: resolved,
    sha256: sourceSha,
    loaded: true,
  };

  return {
    ok: true,
    code: "ok",
    source,
    ref,
    policy: parsed.policy,
  };
}

function loadAndMergePolicySources({ repoPolicyPath = "", skillPolicyPath = "" } = {}) {
  const globalSource = loadPolicySource({
    id: POLICY_SOURCE_GLOBAL_ID,
    order: 0,
    pathValue: skillPolicyPath || DEFAULT_GLOBAL_POLICY_PATH,
  });
  if (!globalSource.ok || !globalSource.source || !globalSource.ref || !globalSource.policy) {
    return { ok: false, code: String(globalSource.code || "global_policy_load_failed"), policy_refs: [], policy_sources: [], effective_policy: null };
  }

  const repoSource = loadPolicySource({
    id: POLICY_SOURCE_REPO_ID,
    order: 1,
    pathValue: repoPolicyPath || DEFAULT_REPO_POLICY_PATH,
  });
  if (!repoSource.ok || !repoSource.source || !repoSource.ref || !repoSource.policy) {
    return { ok: false, code: String(repoSource.code || "repo_policy_load_failed"), policy_refs: [], policy_sources: [], effective_policy: null };
  }

  const ordered = [globalSource, repoSource].sort((a, b) => a.source.order - b.source.order);
  let merged = {};
  for (const entry of ordered) merged = deepMerge(merged, entry.policy);

  const policy_sources = ordered.map((entry) => entry.source);
  const policy_refs = ordered.map((entry) => entry.ref);
  const effective_policy = {
    schema_version: REVIEW_POLICY_SCHEMA_VERSION,
    merge_order: policy_sources.map((entry) => entry.id),
    values: sortObjectDeep(merged),
  };

  return {
    ok: true,
    code: "ok",
    policy_refs,
    policy_sources,
    effective_policy,
  };
}

export function validateReviewerContextContract(value = {}) {
  const diagnostics = [];
  const context = value && typeof value === "object" ? value : {};

  const missingKeys = REVIEWER_CONTEXT_REQUIRED_KEYS
    .filter((key) => !(key in context))
    .sort((a, b) => a.localeCompare(b));

  for (const key of missingKeys) diagnostics.push({ code: "missing_key", key });

  if (trim(context.schema_version) !== REVIEWER_CONTEXT_SCHEMA_VERSION) {
    diagnostics.push({ code: "invalid_schema_version", expected: REVIEWER_CONTEXT_SCHEMA_VERSION, actual: trim(context.schema_version) });
  }
  if (!Array.isArray(context.issue_commit_subjects)) diagnostics.push({ code: "invalid_issue_commit_subjects" });
  if (!Array.isArray(context.changed_files)) diagnostics.push({ code: "invalid_changed_files" });
  if (!Array.isArray(context.policy_refs)) diagnostics.push({ code: "invalid_policy_refs" });
  if (!Array.isArray(context.policy_sources)) diagnostics.push({ code: "invalid_policy_sources" });
  if (!isPlainObject(context.effective_policy)) diagnostics.push({ code: "invalid_effective_policy" });

  if (Array.isArray(context.policy_refs)) {
    const refs = context.policy_refs;
    const precedence = refs.map((entry) => Number(entry?.precedence ?? Number.NaN));
    const sorted = [...precedence].sort((a, b) => a - b);
    if (JSON.stringify(precedence) !== JSON.stringify(sorted)) diagnostics.push({ code: "invalid_policy_precedence_order" });
    const hasUnloaded = refs.some((entry) => entry?.loaded !== true || !trim(entry?.sha256));
    if (hasUnloaded) diagnostics.push({ code: "policy_ref_not_loaded" });
  }

  if (Array.isArray(context.policy_sources)) {
    const sources = context.policy_sources;
    const orders = sources.map((entry) => Number(entry?.order ?? Number.NaN));
    const sorted = [...orders].sort((a, b) => a - b);
    if (JSON.stringify(orders) !== JSON.stringify(sorted)) diagnostics.push({ code: "invalid_policy_source_order" });
    const ids = sources.map((entry) => trim(entry?.id));
    if (JSON.stringify(ids) !== JSON.stringify([POLICY_SOURCE_GLOBAL_ID, POLICY_SOURCE_REPO_ID])) {
      diagnostics.push({ code: "invalid_policy_source_ids" });
    }
    const hasUnloaded = sources.some((entry) => entry?.loaded !== true || !trim(entry?.sha256) || !trim(entry?.path));
    if (hasUnloaded) diagnostics.push({ code: "policy_source_not_loaded" });
  }

  if (isPlainObject(context.effective_policy)) {
    if (trim(context.effective_policy?.schema_version) !== REVIEW_POLICY_SCHEMA_VERSION) {
      diagnostics.push({ code: "invalid_effective_policy_schema_version" });
    }
    const mergeOrder = Array.isArray(context.effective_policy?.merge_order)
      ? context.effective_policy.merge_order.map((entry) => trim(entry)).filter(Boolean)
      : [];
    if (JSON.stringify(mergeOrder) !== JSON.stringify([POLICY_SOURCE_GLOBAL_ID, POLICY_SOURCE_REPO_ID])) {
      diagnostics.push({ code: "invalid_effective_policy_merge_order" });
    }
    if (!isPlainObject(context.effective_policy?.values)) {
      diagnostics.push({ code: "invalid_effective_policy_values" });
    }
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

function toBooleanString(value = "") {
  const normalized = trim(value).toLowerCase();
  if (!normalized) return "";
  return normalized === "true" || normalized === "1" || normalized === "yes" ? "true" : "false";
}

function normalizeFailureCode(value = "", fallback = "review_context_validation_failed") {
  const normalized = trim(value);
  return normalized || fallback;
}

function loadReviewerContextArtifact(pathValue = "") {
  const resolved = resolvePath(pathValue);
  if (!resolved) return { ok: false, code: "missing_review_context_path", path: "", context: null };
  if (!existsSync(resolved)) return { ok: false, code: "review_context_not_found", path: resolved, context: null };
  try {
    const parsed = JSON.parse(readFileSync(resolved, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, code: "review_context_not_object", path: resolved, context: null };
    }
    return { ok: true, code: "ok", path: resolved, context: parsed };
  } catch {
    return { ok: false, code: "review_context_invalid_json", path: resolved, context: null };
  }
}

function completenessFieldDiagnostics(context = {}) {
  const diagnostics = [];

  const requiredStringKeys = [
    "schema_version",
    "issue_number",
    "issue_excerpt",
    "branch",
    "evidence_artifact_path",
    "evidence_artifact_sha256",
  ];
  for (const key of requiredStringKeys) {
    if (!trim(context?.[key])) diagnostics.push({ code: "missing_required_string", key });
  }

  const requiredArrayKeys = ["issue_commit_subjects", "changed_files", "policy_refs", "policy_sources"];
  for (const key of requiredArrayKeys) {
    if (!Array.isArray(context?.[key])) diagnostics.push({ code: "missing_required_array", key });
  }

  const requiredObjectKeys = ["diff_summary", "effective_policy"];
  for (const key of requiredObjectKeys) {
    if (!isPlainObject(context?.[key])) diagnostics.push({ code: "missing_required_object", key });
  }

  return diagnostics;
}

function validatePolicyRefsLoaded(policyRefs = []) {
  if (!Array.isArray(policyRefs)) return false;
  return policyRefs.every((entry) => entry?.loaded === true && Boolean(trim(entry?.sha256)) && Boolean(trim(entry?.path)));
}

function validatePolicySourcesLoaded(policySources = []) {
  if (!Array.isArray(policySources)) return false;
  return policySources.every((entry) => entry?.loaded === true && Boolean(trim(entry?.sha256)) && Boolean(trim(entry?.path)));
}

function validatePolicySourceFreshness(policySources = []) {
  const ordered = Array.isArray(policySources)
    ? [...policySources].sort((a, b) => Number(a?.order ?? 0) - Number(b?.order ?? 0))
    : [];

  for (const source of ordered) {
    const sourcePath = trim(source?.path);
    const sourceSha = trim(source?.sha256);
    if (!sourcePath || !sourceSha) return { ok: false, code: "review_context_policy_source_invalid" };

    const current = readFileSha256(sourcePath);
    if (!current.ok || !trim(current.sha256)) return { ok: false, code: "review_context_policy_source_missing" };
    if (trim(current.sha256) !== sourceSha) return { ok: false, code: "review_context_policy_source_stale" };
  }

  return { ok: true, code: "ok" };
}

function buildReviewContextValidationPass() {
  return {
    review_context_gate_pass: "true",
    review_context_gate_code: "ok",
    review_context_error: "",
    disposition: "approve",
    confidence: "high",
    recommended_transition: "approved",
    reason_codes: ["REVIEW_CONTEXT_VALID"],
    notes: "",
    verdict: buildVerdictEnvelope({
      verdictKind: "code_review",
      disposition: "approve",
      confidence: "high",
      recommendedTransition: "approved",
      observation: { contract: "review_context_valid" },
      recommendation: { action: "continue_to_review" },
      reasonCodes: ["REVIEW_CONTEXT_VALID"],
      notes: "",
    }),
  };
}


function buildReviewContextValidationFailure(code = "review_context_validation_failed", notes = "") {
  const reason = normalizeFailureCode(code);
  const extra = trim(notes);
  const message = extra
    ? `${REVIEW_CONTEXT_PRIMARY_REASON_CODE}: ${reason} ${extra}`
    : `${REVIEW_CONTEXT_PRIMARY_REASON_CODE}: ${reason}`;
  return {
    review_context_gate_pass: "false",
    review_context_gate_code: reason,
    review_context_error: reason,
    disposition: "reject",
    confidence: "high",
    recommended_transition: "revise",
    reason_codes: [REVIEW_CONTEXT_PRIMARY_REASON_CODE],
    notes: message,
    verdict: buildVerdictEnvelope({
      verdictKind: "code_review",
      disposition: "reject",
      confidence: "high",
      recommendedTransition: "revise",
      observation: { contract: "review_context_invalid", code: reason },
      recommendation: { action: "revise_issue" },
      reasonCodes: [REVIEW_CONTEXT_PRIMARY_REASON_CODE],
      notes: message,
    }),
  };
}

export function validateReviewContextCompleteness({
  reviewContextPath = "",
  reviewContextSha256 = "",
  reviewContextValid = "",
  reviewContextError = "",
} = {}) {
  if (toBooleanString(reviewContextValid) === "false") {
    return buildReviewContextValidationFailure(reviewContextError || "review_context_build_failed");
  }

  const loaded = loadReviewerContextArtifact(reviewContextPath);
  if (!loaded.ok || !loaded.context) {
    return buildReviewContextValidationFailure(loaded.code);
  }

  const expectedSha = trim(reviewContextSha256);
  if (!expectedSha) {
    return buildReviewContextValidationFailure("review_context_sha256_missing");
  }

  const actualSha = readFileSha256(loaded.path);
  if (!actualSha.ok || !trim(actualSha.sha256)) {
    return buildReviewContextValidationFailure("review_context_sha256_unavailable");
  }
  if (trim(actualSha.sha256) !== expectedSha) {
    return buildReviewContextValidationFailure("review_context_sha256_mismatch");
  }

  const schemaValidation = validateReviewerContextContract(loaded.context);
  if (!schemaValidation.ok) {
    const hasMissing = Array.isArray(schemaValidation.missing_keys) && schemaValidation.missing_keys.length > 0;
    return buildReviewContextValidationFailure(hasMissing ? "review_context_missing_required_fields" : "review_context_validation_failed");
  }

  const completeness = completenessFieldDiagnostics(loaded.context);
  if (completeness.length > 0) {
    return buildReviewContextValidationFailure("review_context_missing_required_fields");
  }

  if (!validatePolicyRefsLoaded(loaded.context.policy_refs)) {
    return buildReviewContextValidationFailure("review_context_policy_refs_unloaded");
  }

  if (!validatePolicySourcesLoaded(loaded.context.policy_sources)) {
    return buildReviewContextValidationFailure("review_context_policy_sources_unloaded");
  }

  const freshness = validatePolicySourceFreshness(loaded.context.policy_sources);
  if (!freshness.ok) {
    return buildReviewContextValidationFailure(freshness.code);
  }

  return buildReviewContextValidationPass();
}

export function buildReviewerContextContract({ reviewEvidencePath = "", worktreeDir = "", issueNumber = "", branch = "", repoPolicyPath = "", skillPolicyPath = "" } = {}) {
  const resolvedReviewEvidencePath = resolveDefaultReviewEvidencePath({
    reviewEvidencePath,
    worktreeDir,
    issueNumber,
  });
  const loadedEvidence = loadJsonFile(resolvedReviewEvidencePath);
  if (!loadedEvidence.ok) {
    return {
      ok: false,
      code: loadedEvidence.code,
      context: null,
      diagnostics: [{ code: loadedEvidence.code }],
    };
  }

  const policyBundle = loadAndMergePolicySources({ repoPolicyPath, skillPolicyPath });
  if (!policyBundle.ok || !policyBundle.effective_policy) {
    return {
      ok: false,
      code: String(policyBundle.code || "review_context_policy_load_failed"),
      context: null,
      diagnostics: [{ code: String(policyBundle.code || "review_context_policy_load_failed") }],
    };
  }

  const evidence = loadedEvidence.data && typeof loadedEvidence.data === "object" ? loadedEvidence.data : {};
  const evidenceHash = readFileSha256(loadedEvidence.path);

  const hasIssueScopedChangedFiles = Object.prototype.hasOwnProperty.call(evidence, "issue_changed_files");
  const changedFiles = normalizePathArray(hasIssueScopedChangedFiles ? evidence.issue_changed_files : evidence.changed_files);
  const allChangedFiles = normalizePathArray(evidence.changed_files);
  const snapshotSha = trim(evidence.snapshot_sha);
  const evidenceDiagnostics = Array.isArray(evidence.diagnostics) ? evidence.diagnostics : [];
  const emptyScopeDiagnostics = evidenceDiagnostics
    .filter((entry) => isPlainObject(entry) && trim(entry.code) === "review_evidence_snapshot_empty_fallback")
    .map((entry) => sortObjectDeep(entry));

  const range = snapshotSha ? `${snapshotSha}..HEAD` : "main..HEAD";
  const commitSubjects = gitLogSubjects({ worktreeDir: worktreeDir || evidence.worktree_dir, range });

  const context = {
    ...buildNamedPacketEnvelope({
      schemaVersion: REVIEWER_CONTEXT_SCHEMA_VERSION,
      packetType: REVIEWER_CONTEXT_PACKET_TYPE,
      packetId: makePacketId({
        packetType: REVIEWER_CONTEXT_PACKET_TYPE,
        identity: {
          issue_number: trim(issueNumber || evidence.issue_number) || "unknown",
          branch: trim(branch || evidence.branch) || "unknown",
          snapshot_sha: snapshotSha,
          evidence_artifact_path: loadedEvidence.path,
          evidence_artifact_sha256: evidenceHash.sha256,
        },
      }),
    }),
    issue_number: trim(issueNumber || evidence.issue_number) || "unknown",
    issue_excerpt: normalizeIssueExcerpt(evidence.issue_body_excerpt || evidence.issue_body),
    branch: trim(branch || evidence.branch) || "unknown",
    snapshot_sha: snapshotSha,
    issue_commit_subjects: commitSubjects,
    diff_summary: {
      scope_mode: snapshotSha ? "snapshot_scoped" : "branch_scoped",
      commits_ahead: asCountString(evidence.commits_ahead, "0"),
      issue_commits: asCountString(evidence.issue_commits, asCountString(evidence.commits_ahead, "0")),
      changed_files_count: String(allChangedFiles.length),
      issue_changed_files_count: String(changedFiles.length),
      summary: trim(evidence.summary),
    },
    changed_files: changedFiles,
    ...(trim(evidence.builder_notes) ? { builder_notes: trim(evidence.builder_notes) } : {}),
    evidence_artifact_path: loadedEvidence.path,
    evidence_artifact_sha256: evidenceHash.sha256,
    policy_refs: policyBundle.policy_refs,
    policy_sources: policyBundle.policy_sources,
    effective_policy: policyBundle.effective_policy,
  };

  const validation = validateReviewerContextContract(context);
  if (!validation.ok) {
    return {
      ok: false,
      code: "review_context_validation_failed",
      context,
      diagnostics: validation.diagnostics,
    };
  }

  return {
    ok: true,
    code: "ok",
    context,
    diagnostics: emptyScopeDiagnostics,
  };
}

export function buildAndPersistReviewerContextContract({ reviewEvidencePath = "", worktreeDir = "", issueNumber = "", branch = "", repoPolicyPath = "", skillPolicyPath = "" } = {}) {
  const built = buildReviewerContextContract({
    reviewEvidencePath,
    worktreeDir,
    issueNumber,
    branch,
    repoPolicyPath,
    skillPolicyPath,
  });

  if (!built.ok || !built.context) {
    return {
      review_context_path: "",
      review_context_sha256: "",
      review_context_valid: "false",
      review_context_error: String(built.code || "review_context_build_failed"),
    };
  }

  const issue = trim(issueNumber || built.context.issue_number) || "unknown";
  const wd = trim(worktreeDir || dirname(resolvePath(reviewEvidencePath)));
  const outPath = join(wd, ".hatch", "review", "context", `${issue}.json`);
  mkdirSync(dirname(outPath), { recursive: true });

  const persistedContext = reusePersistedPacketCreatedAt({
    packet: built.context,
    packetPath: outPath,
    expectedPacketType: REVIEWER_CONTEXT_PACKET_TYPE,
  });
  const encoded = `${JSON.stringify(persistedContext, null, 2)}\n`;
  writeFileSync(outPath, encoded, "utf8");

  return {
    review_context_path: outPath,
    review_context_sha256: sha256Hex(encoded),
    review_context_valid: "true",
    review_context_error: "",
  };
}
