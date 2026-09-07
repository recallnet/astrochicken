import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { trim, parseJson } from "../cli-helpers.ts";
import {
  buildNamedPacketEnvelope,
  makePacketId,
  validateNamedPacketBase,
  validateRegisteredPacketType,
} from "../packet-core.ts";
import { reusePersistedPacketCreatedAt } from "../persisted-packet-created-at.ts";
import { buildVerdictEnvelope } from "../verdict-envelope.ts";

export const JUDGE_EVIDENCE_SCHEMA_VERSION = "judge_evidence/v1";
export const JUDGE_EVIDENCE_PACKET_TYPE = "judge_evidence_packet";
export const JUDGE_EVIDENCE_PRIMARY_REASON_CODE = "JUDGE_EVIDENCE_INVALID";

const JUDGE_EVIDENCE_REQUIRED_KEYS = [
  "schema_version",
  "judge_kind",
  "judge_context",
  "evidence_items",
  "qa",
];


function toCount(value = "", fallback = 0) {
  const parsed = Number.parseInt(trim(value), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function toCountString(value = "", fallback = "0") {
  const fallbackCount = Number.parseInt(trim(fallback), 10);
  return String(toCount(value, Number.isFinite(fallbackCount) ? fallbackCount : 0));
}

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

function readFileSha256(pathValue = "") {
  const resolved = resolvePath(pathValue);
  if (!resolved || !existsSync(resolved)) return { ok: false, path: resolved, sha256: "" };
  const bytes = readFileSync(resolved);
  return { ok: true, path: resolved, sha256: sha256Hex(bytes) };
}


function slugify(value = "") {
  return trim(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "judge";
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

function uniqueSorted(values = []) {
  const out = [...new Set(values.map((value) => trim(value)).filter(Boolean))];
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

function parseJudgeContextRaw(raw = "") {
  const value = trim(raw);
  if (!value) {
    return { ok: false, code: "judge_context_missing", context: null };
  }

  const parsedValue = parseJson(value, null);
  if (parsedValue === null) {
    return { ok: false, code: "judge_context_invalid_json", context: null };
  }

  if (!Array.isArray(parsedValue) && !isPlainObject(parsedValue)) {
    return { ok: false, code: "judge_context_not_object_or_array", context: null };
  }

  return { ok: true, code: "ok", context: parsedValue };
}

function resolveReviewEvidencePath(item = {}, defaultWorktreeDir = "") {
  const explicit = trim(item.review_evidence_path);
  if (explicit) return resolvePath(explicit);

  const issueNumber = trim(item.issue_number);
  const worktreeDir = resolvePath(item.worktree_dir || defaultWorktreeDir);
  if (!issueNumber || !worktreeDir) return "";
  return join(worktreeDir, ".hatch", "review", `${issueNumber}.json`);
}

function loadReviewEvidence(pathValue = "") {
  const resolved = resolvePath(pathValue);
  if (!resolved) {
    return {
      ok: false,
      code: "judge_review_evidence_path_missing",
      path: "",
      reviewEvidenceSha256: "",
      qaStatus: "",
      qaCommand: "",
    };
  }
  if (!existsSync(resolved)) {
    return {
      ok: false,
      code: "judge_review_evidence_not_found",
      path: resolved,
      reviewEvidenceSha256: "",
      qaStatus: "",
      qaCommand: "",
    };
  }

  const fileSha = readFileSha256(resolved);
  const parsedValue = parseJson(readFileSync(resolved, "utf8"), null);
  if (!isPlainObject(parsedValue)) {
    return {
      ok: false,
      code: "judge_review_evidence_invalid_json",
      path: resolved,
      reviewEvidenceSha256: fileSha.sha256,
      qaStatus: "",
      qaCommand: "",
    };
  }

  const qa = isPlainObject(parsedValue.qa) ? parsedValue.qa : {};
  return {
    ok: true,
    code: "ok",
    path: resolved,
    reviewEvidenceSha256: fileSha.sha256,
    qaStatus: trim(qa.status).toLowerCase(),
    qaCommand: trim(qa.command),
  };
}

function normalizeEvidenceItemsFromList(items = [], defaultWorktreeDir = "") {
  const normalized = [];

  for (const rawItem of items) {
    if (!isPlainObject(rawItem)) continue;
    const issueNumber = trim(rawItem.issue_number);
    const branch = trim(rawItem.branch);
    const worktreeDir = resolvePath(rawItem.worktree_dir || defaultWorktreeDir);
    const reviewEvidencePath = resolveReviewEvidencePath(rawItem, defaultWorktreeDir);
    const loadedEvidence = loadReviewEvidence(reviewEvidencePath);
    const issueCommits = toCountString(rawItem.issue_commits, toCountString(rawItem.commits_ahead, "0"));
    const issueChangedFilesCount = toCountString(rawItem.issue_changed_files_count, toCountString(rawItem.issue_changed_files?.length, "0"));

    normalized.push({
      issue_number: issueNumber,
      branch,
      worktree_dir: worktreeDir,
      review_evidence_path: loadedEvidence.path || reviewEvidencePath,
      review_evidence_sha256: loadedEvidence.reviewEvidenceSha256,
      qa_status: trim(loadedEvidence.qaStatus).toLowerCase(),
      qa_command: trim(loadedEvidence.qaCommand),
      review_evidence_loaded: loadedEvidence.ok ? "true" : "false",
      review_evidence_error: loadedEvidence.ok ? "" : loadedEvidence.code,
      issue_commits: issueCommits,
      issue_changed_files_count: issueChangedFilesCount,
    });
  }

  normalized.sort((a, b) => {
    const byIssue = a.issue_number.localeCompare(b.issue_number);
    if (byIssue !== 0) return byIssue;
    const byBranch = a.branch.localeCompare(b.branch);
    if (byBranch !== 0) return byBranch;
    return a.review_evidence_path.localeCompare(b.review_evidence_path);
  });

  return normalized;
}

function buildQaSummaryFromItems(items = [], fallbackQa = {}) {
  const statuses = [];
  const commands = [];

  for (const item of items) {
    const status = trim(item?.qa_status).toLowerCase();
    const command = trim(item?.qa_command);
    if (status) statuses.push(status);
    if (command) commands.push(command);
  }

  const fallbackStatus = trim(fallbackQa?.status).toLowerCase();
  const fallbackCommand = trim(fallbackQa?.command);
  if (fallbackStatus) statuses.push(fallbackStatus);
  if (fallbackCommand) commands.push(fallbackCommand);

  const allStatuses = uniqueSorted(statuses);
  const allCommands = uniqueSorted(commands);
  const hasStatuses = allStatuses.length > 0;
  const allPass = hasStatuses && allStatuses.every((entry) => entry === "pass");

  return {
    status: allPass ? "pass" : hasStatuses ? "fail" : "",
    command: allCommands[0] || "",
    statuses: allStatuses,
    commands: allCommands,
  };
}

function normalizeJudgeContext(context) {
  if (Array.isArray(context)) {
    const normalizedList = context
      .filter((entry) => isPlainObject(entry))
      .map((entry) => sortObjectDeep(entry));

    if (normalizedList.length === 0) {
      return { ok: false, code: "judge_context_missing_required_fields", normalized: null };
    }

    return {
      ok: true,
      code: "ok",
      normalized: normalizedList,
      context_type: "list",
    };
  }

  if (isPlainObject(context)) {
    if (Object.keys(context).length === 0) {
      return { ok: false, code: "judge_context_missing_required_fields", normalized: null };
    }

    return {
      ok: true,
      code: "ok",
      normalized: sortObjectDeep(context),
      context_type: "object",
    };
  }

  return { ok: false, code: "judge_context_not_object_or_array", normalized: null };
}

function buildJudgeEvidencePayload({
  judgeKind = "",
  normalizedContext,
  contextType = "object",
  worktreeDir = "",
  requireQaMarkers = "",
} = {}) {
  const kind = trim(judgeKind) || "judge";
  const requireQa = toBoolean(requireQaMarkers) === "true";
  const resolvedWorktree = resolvePath(worktreeDir) || process.cwd();

  if (contextType === "list") {
    const items = normalizeEvidenceItemsFromList(normalizedContext, resolvedWorktree);
    if (items.length === 0) {
      return { ok: false, code: "judge_evidence_missing_required_fields", payload: null };
    }

    const qa = buildQaSummaryFromItems(items, {});
    return {
      ok: true,
      code: "ok",
      payload: sortObjectDeep({
        ...buildNamedPacketEnvelope({
          schemaVersion: JUDGE_EVIDENCE_SCHEMA_VERSION,
          packetType: JUDGE_EVIDENCE_PACKET_TYPE,
          packetId: makePacketId({
            packetType: JUDGE_EVIDENCE_PACKET_TYPE,
            identity: {
              judge_kind: kind,
              judge_context_sha256: sha256Hex(JSON.stringify(normalizedContext)),
              evidence_items: items.map((entry) => ({
                issue_number: trim(entry.issue_number),
                branch: trim(entry.branch),
                review_evidence_path: trim(entry.review_evidence_path),
                review_evidence_sha256: trim(entry.review_evidence_sha256),
              })),
              require_qa_markers: requireQa,
            },
          }),
        }),
        judge_kind: kind,
        judge_context: normalizedContext,
        evidence_items: items,
        qa,
        require_qa_markers: requireQa,
      }),
    };
  }

  const objectContext = isPlainObject(normalizedContext) ? normalizedContext : {};
  const fallbackQa = isPlainObject(objectContext.qa) ? objectContext.qa : {};
  const hasIssueSpec = Object.prototype.hasOwnProperty.call(objectContext, "issue_spec");
  const hasFeature = Object.prototype.hasOwnProperty.call(objectContext, "feature");

  const evidenceItems = [sortObjectDeep({
    context_keys: Object.keys(objectContext).sort((a, b) => a.localeCompare(b)),
    has_feature: hasFeature ? "true" : "false",
    has_issue_spec: hasIssueSpec ? "true" : "false",
  })];

  const qa = buildQaSummaryFromItems([], fallbackQa);

    return {
      ok: true,
      code: "ok",
      payload: sortObjectDeep({
        ...buildNamedPacketEnvelope({
          schemaVersion: JUDGE_EVIDENCE_SCHEMA_VERSION,
          packetType: JUDGE_EVIDENCE_PACKET_TYPE,
          packetId: makePacketId({
            packetType: JUDGE_EVIDENCE_PACKET_TYPE,
            identity: {
              judge_kind: kind,
              judge_context_sha256: sha256Hex(JSON.stringify(normalizedContext)),
              qa_status: trim(qa.status),
              qa_command: trim(qa.command),
              require_qa_markers: requireQa,
            },
          }),
        }),
        judge_kind: kind,
        judge_context: normalizedContext,
        evidence_items: evidenceItems,
      qa,
      require_qa_markers: requireQa,
    }),
  };
}

function buildJudgeEvidenceContractFailure(code = "judge_evidence_contract_build_failed") {
  return {
    judge_evidence_path: "",
    judge_evidence_sha256: "",
    judge_evidence_valid: "false",
    judge_evidence_error: trim(code) || "judge_evidence_contract_build_failed",
  };
}

export function buildAndPersistJudgeEvidenceContract({
  judgeKind = "",
  judgeContextRaw = "",
  worktreeDir = "",
  requireQaMarkers = "",
  subjectId = "",
} = {}) {
  const parsed = parseJudgeContextRaw(judgeContextRaw);
  if (!parsed.ok || parsed.context === null) {
    return buildJudgeEvidenceContractFailure(parsed.code);
  }

  const normalized = normalizeJudgeContext(parsed.context);
  if (!normalized.ok || normalized.normalized === null) {
    return buildJudgeEvidenceContractFailure(normalized.code);
  }

  const payloadBuilt = buildJudgeEvidencePayload({
    judgeKind,
    normalizedContext: normalized.normalized,
    contextType: normalized.context_type,
    worktreeDir,
    requireQaMarkers,
  });
  if (!payloadBuilt.ok || !payloadBuilt.payload) {
    return buildJudgeEvidenceContractFailure(payloadBuilt.code);
  }

  const contextFingerprint = sha256Hex(JSON.stringify(payloadBuilt.payload.judge_context));
  const filename = `${slugify(judgeKind)}-${slugify(subjectId) || "context"}-${contextFingerprint.slice(0, 12)}.json`;
  const baseDir = resolvePath(worktreeDir) || process.cwd();
  const outPath = join(baseDir, ".hatch", "judge", "evidence", filename);
  mkdirSync(dirname(outPath), { recursive: true });

  const persistedPayload = reusePersistedPacketCreatedAt({
    packet: payloadBuilt.payload,
    packetPath: outPath,
    expectedPacketType: JUDGE_EVIDENCE_PACKET_TYPE,
  });
  const encoded = `${JSON.stringify(persistedPayload, null, 2)}\n`;
  writeFileSync(outPath, encoded, "utf8");

  return {
    judge_evidence_path: outPath,
    judge_evidence_sha256: sha256Hex(encoded),
    judge_evidence_valid: "true",
    judge_evidence_error: "",
  };
}

function loadJudgeEvidenceArtifact(pathValue = "") {
  const resolved = resolvePath(pathValue);
  if (!resolved) return { ok: false, code: "judge_evidence_path_missing", path: "", evidence: null };
  if (!existsSync(resolved)) return { ok: false, code: "judge_evidence_not_found", path: resolved, evidence: null };

  const parsedValue = parseJson(readFileSync(resolved, "utf8"), null);
  if (!isPlainObject(parsedValue)) {
    return { ok: false, code: "judge_evidence_invalid_json", path: resolved, evidence: null };
  }

  return { ok: true, code: "ok", path: resolved, evidence: parsedValue };
}

function hasRequiredJudgeEvidenceFields(evidence = {}) {
  for (const key of JUDGE_EVIDENCE_REQUIRED_KEYS) {
    if (!(key in evidence)) return false;
  }
  if (trim(evidence.schema_version) !== JUDGE_EVIDENCE_SCHEMA_VERSION) return false;
  if (!trim(evidence.judge_kind)) return false;

  const judgeContext = evidence.judge_context;
  const contextValid = Array.isArray(judgeContext) || isPlainObject(judgeContext);
  if (!contextValid) return false;

  if (!Array.isArray(evidence.evidence_items) || evidence.evidence_items.length === 0) return false;
  if (!isPlainObject(evidence.qa)) return false;

  if (!Object.prototype.hasOwnProperty.call(evidence.qa, "status")) return false;
  if (!Object.prototype.hasOwnProperty.call(evidence.qa, "command")) return false;
  if (typeof evidence.qa.status !== "string") return false;
  if (typeof evidence.qa.command !== "string") return false;

  return true;
}

function resolveEvidenceItemLoadFailureCode(evidenceItems = []) {
  for (const item of evidenceItems) {
    if (!isPlainObject(item)) continue;

    const hasReviewEvidenceLoadKeys = Object.prototype.hasOwnProperty.call(item, "review_evidence_loaded")
      || Object.prototype.hasOwnProperty.call(item, "review_evidence_error");

    if (!hasReviewEvidenceLoadKeys) {
      continue;
    }

    const loaded = toBoolean(item.review_evidence_loaded) === "true";
    if (!loaded) {
      return trim(item.review_evidence_error) || "judge_evidence_item_not_loaded";
    }

    const itemError = trim(item.review_evidence_error);
    if (itemError) {
      return itemError;
    }
  }

  return "";
}

function normalizeFailureCode(code = "", fallback = "judge_evidence_validation_failed") {
  const normalized = trim(code);
  return normalized || fallback;
}

function buildJudgeEvidenceValidationPass() {
  return {
    judge_evidence_gate_pass: "true",
    judge_evidence_gate_code: "ok",
    judge_evidence_error: "",
    judge_route_code: "",
    disposition: "approve",
    confidence: "high",
    recommended_transition: "judge_ready",
    reason_codes: ["JUDGE_EVIDENCE_VALID"],
    notes: "",
    verdict: buildVerdictEnvelope({
      verdictKind: "post_merge_judge",
      disposition: "approve",
      confidence: "high",
      recommendedTransition: "judge_ready",
      observation: { contract: "judge_evidence_valid" },
      recommendation: { action: "continue_to_judge" },
      reasonCodes: ["JUDGE_EVIDENCE_VALID"],
      notes: "",
    }),
  };
}

function buildJudgeEvidenceValidationFailure(code = "judge_evidence_validation_failed") {
  const reason = normalizeFailureCode(code);
  const note = `${JUDGE_EVIDENCE_PRIMARY_REASON_CODE}: ${reason}`;
  return {
    judge_evidence_gate_pass: "false",
    judge_evidence_gate_code: reason,
    judge_evidence_error: reason,
    judge_route_code: reason,
    disposition: "escalate",
    confidence: "high",
    recommended_transition: "repair_judge_evidence_contract",
    reason_codes: [JUDGE_EVIDENCE_PRIMARY_REASON_CODE],
    notes: note,
    verdict: buildVerdictEnvelope({
      verdictKind: "post_merge_judge",
      disposition: "escalate",
      confidence: "high",
      recommendedTransition: "repair_judge_evidence_contract",
      observation: { contract: "judge_evidence_invalid", code: reason },
      recommendation: { action: "build_judge_evidence_recovery_packet" },
      reasonCodes: [JUDGE_EVIDENCE_PRIMARY_REASON_CODE],
      notes: note,
    }),
  };
}

export function validateJudgeEvidenceContract(value = {}) {
  const evidence = isPlainObject(value) ? value : {};
  const errors = [];
  const base = validateNamedPacketBase(evidence);
  errors.push(...base.errors);
  const registration = validateRegisteredPacketType({
    packetType: evidence.packet_type,
    schemaVersion: evidence.schema_version,
  });
  errors.push(...registration.errors);
  if (!hasRequiredJudgeEvidenceFields(evidence)) {
    errors.push("judge_evidence_missing_required_fields");
  }
  return {
    ok: errors.length === 0,
    errors,
  };
}

function judgeContextFingerprint(value) {
  const normalized = sortObjectDeep(value);
  return sha256Hex(JSON.stringify(normalized));
}

export function validateJudgeEvidenceCompleteness({
  judgeKind = "",
  judgeContextRaw = "",
  judgeEvidencePath = "",
  judgeEvidenceSha256 = "",
  judgeEvidenceValid = "",
  judgeEvidenceError = "",
  requireQaMarkers = "",
} = {}) {
  if (toBoolean(judgeEvidenceValid) === "false") {
    return buildJudgeEvidenceValidationFailure(judgeEvidenceError || "judge_evidence_build_failed");
  }

  const parsedContext = parseJudgeContextRaw(judgeContextRaw);
  if (!parsedContext.ok || parsedContext.context === null) {
    return buildJudgeEvidenceValidationFailure(parsedContext.code);
  }

  const loaded = loadJudgeEvidenceArtifact(judgeEvidencePath);
  if (!loaded.ok || !loaded.evidence) {
    return buildJudgeEvidenceValidationFailure(loaded.code);
  }

  const expectedSha = trim(judgeEvidenceSha256);
  if (!expectedSha) {
    return buildJudgeEvidenceValidationFailure("judge_evidence_sha256_missing");
  }

  const actualSha = readFileSha256(loaded.path);
  if (!actualSha.ok || !trim(actualSha.sha256)) {
    return buildJudgeEvidenceValidationFailure("judge_evidence_sha256_unavailable");
  }
  if (trim(actualSha.sha256) !== expectedSha) {
    return buildJudgeEvidenceValidationFailure("judge_evidence_sha256_mismatch");
  }

  if (!hasRequiredJudgeEvidenceFields(loaded.evidence)) {
    return buildJudgeEvidenceValidationFailure("judge_evidence_missing_required_fields");
  }

  const evidenceItemFailureCode = resolveEvidenceItemLoadFailureCode(loaded.evidence.evidence_items);
  if (evidenceItemFailureCode) {
    return buildJudgeEvidenceValidationFailure(evidenceItemFailureCode);
  }

  const normalizedContext = normalizeJudgeContext(parsedContext.context);
  if (!normalizedContext.ok || normalizedContext.normalized === null) {
    return buildJudgeEvidenceValidationFailure(normalizedContext.code);
  }

  const expectedContextSha = judgeContextFingerprint(normalizedContext.normalized);
  const actualContextSha = judgeContextFingerprint(loaded.evidence.judge_context);
  if (expectedContextSha !== actualContextSha) {
    return buildJudgeEvidenceValidationFailure("judge_evidence_context_mismatch");
  }

  const expectedKind = trim(judgeKind);
  if (expectedKind && trim(loaded.evidence.judge_kind) !== expectedKind) {
    return buildJudgeEvidenceValidationFailure("judge_evidence_kind_mismatch");
  }

  return buildJudgeEvidenceValidationPass();
}
