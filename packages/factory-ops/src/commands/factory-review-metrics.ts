import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { trim, parseJson } from "../lib/cli-helpers.ts";
import { resolveRunsDir } from "../lib/runs-dir-resolver.ts";


function normalizeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeTimestampMs(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 0 && value < 1_000_000_000_000) return Math.trunc(value * 1000);
    return Math.trunc(value);
  }

  const raw = String(value || "").trim();
  if (!raw) return fallback;

  const numeric = Number(raw);
  if (Number.isFinite(numeric)) {
    if (numeric > 0 && numeric < 1_000_000_000_000) return Math.trunc(numeric * 1000);
    return Math.trunc(numeric);
  }

  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function normalizeVerdictRecord(raw = {}, index = 0) {
  const record = raw && typeof raw === "object" ? raw : {};
  const issueNumber = Number.parseInt(String(record.issue_number || "").trim(), 10);
  const retryAttempt = Number.parseInt(String(record.retry_attempt || "0").trim(), 10);

  return {
    disposition: String(record.disposition || "").trim().toLowerCase(),
    reason_codes: normalizeStringArray(record.reason_codes),
    retry_attempt: Number.isFinite(retryAttempt) && retryAttempt > 0 ? retryAttempt : 0,
    max_review_attempts: normalizeNumber(record.max_review_attempts, 0),
    force_merged: record.force_merged === true,
    issue_number: Number.isFinite(issueNumber) && issueNumber > 0 ? issueNumber : null,
    issue_labels: normalizeStringArray(record.issue_labels),
    milestone: String(record.milestone || "").trim(),
    run_id: String(record.run_id || "").trim(),
    timestamp_ms: normalizeTimestampMs(record.timestamp, index),
    _line_index: index,
  };
}

function readVerdictLog(verdictsLogPath) {
  if (!existsSync(verdictsLogPath)) return [];
  const raw = String(readFileSync(verdictsLogPath, "utf8") || "").trim();
  if (!raw) return [];

  const records = [];
  const lines = raw.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = String(lines[index] || "").trim();
    if (!line) continue;
    const parsed = parseJson(line, null);
    if (!parsed) continue;
    records.push(normalizeVerdictRecord(parsed, index));
  }

  records.sort((a, b) => a.timestamp_ms - b.timestamp_ms || a._line_index - b._line_index);
  return records;
}

function zeroMetrics({ verdictsPath = "", lookbackHours = null } = {}) {
  return {
    first_pass_approval_rate: 0,
    retry_distribution: {
      attempt_1: 0,
      attempt_2: 0,
      attempt_3: 0,
      force_merged: 0,
    },
    force_merge_rate: 0,
    top_reason_codes: [],
    approval_rate_by_label: [],
    total_issues: 0,
    lookback_hours: lookbackHours,
    verdicts_path: verdictsPath,
  };
}

function computeIssueSummaries(records = []) {
  const byIssue = new Map();

  for (const record of records) {
    if (!Number.isFinite(record.issue_number) || record.issue_number <= 0) continue;

    const key = record.issue_number;
    const previous = byIssue.get(key) || {
      issue_number: key,
      max_retry_attempt: 0,
      force_merged: false,
      final_record: null,
    };

    const maxRetry = Math.max(Number(previous.max_retry_attempt || 0), Number(record.retry_attempt || 0));
    let finalRecord = previous.final_record;
    if (!finalRecord) {
      finalRecord = record;
    } else if (record.retry_attempt > finalRecord.retry_attempt) {
      finalRecord = record;
    } else if (record.retry_attempt === finalRecord.retry_attempt && record.timestamp_ms >= finalRecord.timestamp_ms) {
      finalRecord = record;
    }

    byIssue.set(key, {
      issue_number: key,
      max_retry_attempt: maxRetry,
      force_merged: previous.force_merged || record.force_merged === true,
      final_record: finalRecord,
    });
  }

  return [...byIssue.values()];
}

function computeTopReasonCodes(records = []) {
  const counts = new Map();
  for (const record of records) {
    for (const code of normalizeStringArray(record.reason_codes)) {
      counts.set(code, Number(counts.get(code) || 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
    .slice(0, 5);
}

function computeApprovalRateByLabel(records = []) {
  const labels = new Map();

  for (const record of records) {
    const dedupedLabels = [...new Set(normalizeStringArray(record.issue_labels))];
    if (dedupedLabels.length === 0) continue;
    const approved = record.disposition === "approve";

    for (const label of dedupedLabels) {
      const current = labels.get(label) || { label, approved: 0, total: 0 };
      current.total += 1;
      if (approved) current.approved += 1;
      labels.set(label, current);
    }
  }

  return [...labels.values()]
    .map((entry) => ({
      ...entry,
      rate: entry.total > 0 ? entry.approved / entry.total : 0,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function isFinitePositive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

export function resolveReviewVerdictsLogPath({ factoryId = "", runsDir = "" } = {}) {
  const resolvedRunsDir = resolveRunsDir({ runsDir, factoryId });
  return path.resolve(resolvedRunsDir, "..", "review-verdicts.jsonl");
}

export function computeReviewMetrics({
  verdictsLogPath,
  lookbackHours = undefined,
  window = undefined,
  nowMs = Date.now(),
} = {}) {
  const resolvedPath = path.resolve(String(verdictsLogPath || "review-verdicts.jsonl"));
  const normalizedLookback = isFinitePositive(lookbackHours) ? Number(lookbackHours) : null;
  const normalizedWindow = isFinitePositive(window) ? Math.trunc(Number(window)) : null;

  let records = readVerdictLog(resolvedPath);
  if (records.length === 0) {
    return zeroMetrics({ verdictsPath: resolvedPath, lookbackHours: normalizedLookback });
  }

  if (normalizedLookback !== null) {
    const cutoff = Number(nowMs) - (normalizedLookback * 60 * 60 * 1000);
    records = records.filter((record) => record.timestamp_ms >= cutoff);
  }

  if (normalizedWindow !== null) {
    records = records.slice(-normalizedWindow);
  }

  if (records.length === 0) {
    return zeroMetrics({ verdictsPath: resolvedPath, lookbackHours: normalizedLookback });
  }

  const issueSummaries = computeIssueSummaries(records);
  const totalIssues = issueSummaries.length;
  if (totalIssues === 0) {
    return zeroMetrics({ verdictsPath: resolvedPath, lookbackHours: normalizedLookback });
  }

  let firstPassApprovals = 0;
  let forceMergedIssues = 0;
  const retryDistribution = {
    attempt_1: 0,
    attempt_2: 0,
    attempt_3: 0,
    force_merged: 0,
  };

  for (const issue of issueSummaries) {
    const finalRecord = issue.final_record || {};
    if (finalRecord.disposition === "approve" && Number(finalRecord.retry_attempt || 0) === 1) {
      firstPassApprovals += 1;
    }

    if (issue.force_merged === true) {
      forceMergedIssues += 1;
      retryDistribution.force_merged += 1;
      continue;
    }

    const maxRetry = Number(issue.max_retry_attempt || 0);
    if (maxRetry <= 1) retryDistribution.attempt_1 += 1;
    else if (maxRetry === 2) retryDistribution.attempt_2 += 1;
    else retryDistribution.attempt_3 += 1;
  }

  return {
    first_pass_approval_rate: totalIssues > 0 ? firstPassApprovals / totalIssues : 0,
    retry_distribution: retryDistribution,
    force_merge_rate: totalIssues > 0 ? forceMergedIssues / totalIssues : 0,
    top_reason_codes: computeTopReasonCodes(records),
    approval_rate_by_label: computeApprovalRateByLabel(records),
    total_issues: totalIssues,
    lookback_hours: normalizedLookback,
    verdicts_path: resolvedPath,
  };
}
