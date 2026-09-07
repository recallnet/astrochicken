import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import { trim } from "../lib/cli-helpers.ts";
import { resolveRunsDir } from "../lib/runs-dir-resolver.ts";
import { parseVerdictEnvelopeRaw, validateVerdictEnvelope } from "../lib/verdict-envelope.ts";

const REVIEW_VERDICT_SCHEMA_VERSION = "review-verdict/v2";
const REVIEW_VERDICTS_FILE_NAME = "review-verdicts.jsonl";

function ensureInteger(value, fieldName) {
  if (!Number.isInteger(value)) {
    throw new Error(`invalid_${fieldName}: expected integer`);
  }
  return value;
}

function normalizeStringArray(value, fieldName, { required = false } = {}) {
  if (!Array.isArray(value)) {
    throw new Error(`invalid_${fieldName}: expected array`);
  }

  const out = value
    .map((entry) => trim(entry))
    .filter(Boolean);

  if (required && out.length === 0) {
    throw new Error(`invalid_${fieldName}: expected non-empty array`);
  }

  return out;
}

function validateRequiredString(value = "", fieldName = "field") {
  const normalized = trim(value);
  if (!normalized) {
    throw new Error(`missing_${fieldName}`);
  }
  return normalized;
}

export function resolveReviewVerdictsLogPath({ factoryId = "", runsDir = "" } = {}) {
  const resolvedRunsDir = resolveRunsDir({ factoryId: trim(factoryId), runsDir: trim(runsDir) });
  return path.resolve(resolvedRunsDir, "..", REVIEW_VERDICTS_FILE_NAME);
}

export async function emitReviewVerdictTelemetry({
  factoryId,
  runId,
  issueNumber,
  milestone,
  verdictRaw,
  retryAttempt,
  maxReviewAttempts,
  issueLabels,
  runsDir,
} = {}) {
  const resolvedFactoryId = validateRequiredString(factoryId, "factory_id");
  const resolvedRunId = validateRequiredString(runId, "run_id");
  const resolvedIssueNumber = ensureInteger(issueNumber, "issue_number");
  const resolvedRetryAttempt = ensureInteger(retryAttempt, "retry_attempt");
  const resolvedMaxReviewAttempts = ensureInteger(maxReviewAttempts, "max_review_attempts");
  const validatedVerdict = validateVerdictEnvelope(parseVerdictEnvelopeRaw(verdictRaw) || {}, {
    expectedKind: "code_review",
    allowedTransitions: new Set(["approved", "revise"]),
    requiredReasonCodes: true,
  });
  if (!validatedVerdict.ok) {
    throw new Error(`invalid_review_verdict: ${validatedVerdict.errors.join(",")}`);
  }
  const resolvedVerdict = validatedVerdict.verdict;
  const resolvedIssueLabels = normalizeStringArray(issueLabels || [], "issue_labels", { required: false });

  const forceMerged = resolvedRetryAttempt >= resolvedMaxReviewAttempts && resolvedVerdict.disposition === "reject";

  const record = {
    schema_version: REVIEW_VERDICT_SCHEMA_VERSION,
    run_id: resolvedRunId,
    issue_number: resolvedIssueNumber,
    milestone: trim(milestone),
    disposition: resolvedVerdict.disposition,
    confidence: resolvedVerdict.confidence,
    recommended_transition: resolvedVerdict.recommended_transition,
    reason_codes: resolvedVerdict.reason_codes,
    notes: resolvedVerdict.notes,
    retry_attempt: resolvedRetryAttempt,
    max_review_attempts: resolvedMaxReviewAttempts,
    force_merged: forceMerged,
    issue_labels: resolvedIssueLabels,
    emitted_at: new Date().toISOString(),
  };

  const logPath = resolveReviewVerdictsLogPath({
    factoryId: resolvedFactoryId,
    runsDir,
  });

  mkdirSync(path.dirname(logPath), { recursive: true });
  appendFileSync(logPath, `${JSON.stringify(record)}\n`, "utf8");

  return {
    ok: true,
    factory_id: resolvedFactoryId,
    log_path: logPath,
    record,
  };
}
