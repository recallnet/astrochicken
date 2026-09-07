import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { sendReviewMessage } from "../../commands/review-messenger.ts";
import { resolveBuilderNotes } from "../../commands/wave-issue-builder-notes.ts";
import { decideExistingReuse } from "../../commands/wave-issue-inspector.ts";
import {
  run,
  sha256Hex,
  resolvePath,
  persistReviewEvidence,
  loadReviewEvidenceArtifact,
  resolvePersistedQaCommands,
  runQaCommand,
  resolveIssueScopedDelta,
  buildReviewEvidenceDiagnostics,
  summaryIndicatesZeroDelta,
  buildReviewEvidenceScopeDiagnostics,
  buildReviewEvidenceNote,
  isSharedWaveBranch,
} from "../../commands/wave-issue-shared.ts";
import {
  buildIssueExecutionCompletedEvent,
  buildReviewVerdictAppliedEvent,
  dispatchCanonicalDomainEvents,
} from "../canonical-domain-events.ts";
import { trim, parseJson, gh, ghJson } from "../cli-helpers.ts";
import {
  buildVerdictEnvelope,
  parseVerdictEnvelopeRaw,
  validateVerdictEnvelope,
} from "../verdict-envelope.ts";

/**
 * Canonical default for maximum review attempts before force-merge.
 * All references to the inline literal "3" must use this constant.
 * Supervisor policy template (shared.max_review_retries) must match.
 */
export const DEFAULT_MAX_REVIEW_ATTEMPTS = 3;

export function initReviewAttempt() {
  return "0";
}
export function nextReviewAttempt(attemptRaw = "0") {
  const n = Number.parseInt(String(attemptRaw || "0"), 10) || 0;
  return String(n + 1);
}
export function shouldRetryReview({ reviewVerdict = "", attempt = "0", maxAttempts = String(DEFAULT_MAX_REVIEW_ATTEMPTS) } = {}) {
  const verdict = String(reviewVerdict || "").trim().toLowerCase();
  const a = Number.parseInt(String(attempt || "0"), 10) || 0;
  const m = Math.max(1, Number.parseInt(String(maxAttempts || DEFAULT_MAX_REVIEW_ATTEMPTS), 10) || DEFAULT_MAX_REVIEW_ATTEMPTS);
  if (verdict === "approve") return "false";
  return a < m ? "true" : "false";
}
export function setRetryDecision({
  reviewVerdict = "",
  attempt = "0",
  maxAttempts = String(DEFAULT_MAX_REVIEW_ATTEMPTS),
  zeroDelta = "false",
  zeroDeltaRetryCount = "0",
  worktreeDir = "",
  issueNumber = "",
  issueCommits = "",
} = {}) {
  const verdict = trim(reviewVerdict).toLowerCase();
  const zeroDeltaEnabled = trim(zeroDelta).toLowerCase() === "true";
  const scopedIssueCommits = Number.parseInt(trim(issueCommits), 10);
  const hasNoIssueCommits = Number.isFinite(scopedIssueCommits)
    ? scopedIssueCommits === 0
    : zeroDeltaEnabled;
  if (verdict === "approve") {
    const cleared = recordZeroDeltaRetry({
      worktreeDir,
      issueNumber,
      zeroDeltaTriggered: "false",
      commitsAhead: "1",
    });
    return {
      retry_review: "false",
      review_attempt: String(attempt || "0").trim() || "0",
      zero_delta_retry: cleared.zero_delta_retry,
      zero_delta_retry_count: cleared.zero_delta_retry_count,
    };
  }
  if (zeroDeltaEnabled && hasNoIssueCommits) {
    const currentCount = Number.parseInt(trim(zeroDeltaRetryCount), 10) || 0;
    if (currentCount >= ZERO_DELTA_RETRY_LIMIT) {
      return {
        retry_review: "false",
        review_attempt: String(attempt || "0").trim() || "0",
        zero_delta_retry: "true",
        zero_delta_retry_count: String(currentCount),
      };
    }
    const recorded = recordZeroDeltaRetry({
      worktreeDir,
      issueNumber,
      zeroDeltaTriggered: "true",
      commitsAhead: "0",
    });
    const nextCount = Number.parseInt(trim(recorded.zero_delta_retry_count), 10) || (currentCount + 1);
    if (nextCount >= ZERO_DELTA_RETRY_LIMIT) {
      return {
        retry_review: "false",
        review_attempt: String(attempt || "0").trim() || "0",
        zero_delta_retry: "true",
        zero_delta_retry_count: String(nextCount),
      };
    }
    return {
      retry_review: "true",
      review_attempt: String(attempt || "0").trim() || "0",
      zero_delta_retry: "true",
      zero_delta_retry_count: String(nextCount),
    };
  }
  const retryReview = shouldRetryReview({ reviewVerdict, attempt, maxAttempts });
  const cleared = recordZeroDeltaRetry({
    worktreeDir,
    issueNumber,
    zeroDeltaTriggered: "false",
    commitsAhead: Number.isFinite(scopedIssueCommits) ? String(scopedIssueCommits) : "1",
  });
  return {
    retry_review: retryReview,
    review_attempt: String(attempt || "0").trim() || "0",
    zero_delta_retry: cleared.zero_delta_retry,
    zero_delta_retry_count: cleared.zero_delta_retry_count,
  };
}
export function fallbackReviewDecision({ reviewEvidencePath = "", reviewError = "", reviewVerdict = "", reviewReasonCodesRaw = "", reviewNotes = "" } = {}) {
  const parsed = parseVerdictEnvelopeRaw(reviewVerdict);
  const validated = validateVerdictEnvelope(parsed || {}, {
    expectedKind: "code_review",
    allowedTransitions: new Set(["approved", "revise"]),
    requiredReasonCodes: true,
  });
  if (validated.ok) {
    return validated.verdict;
  }
  const p = trim(reviewEvidencePath);
  const err = trim(reviewError);
  if (!p || !existsSync(p)) {
    return buildVerdictEnvelope({
      verdictKind: "code_review",
      disposition: "reject",
      confidence: "high",
      recommendedTransition: "revise",
      observation: { fallback: "missing_review_evidence", error: err || "review_evidence_missing" },
      recommendation: { action: "revise_issue" },
      reasonCodes: ["EVIDENCE_MISSING"],
      notes: `Deterministic fallback review: missing evidence artifact. ${err}`.trim(),
    });
  }
  return buildVerdictEnvelope({
    verdictKind: "code_review",
    disposition: "approve",
    confidence: "low",
    recommendedTransition: "approved",
    observation: { fallback: "llm_unavailable", error: err || "llm_unavailable" },
    recommendation: { action: "report_approved" },
    reasonCodes: ["APPROVED"],
    notes: `Deterministic fallback review: approved because LLM reviewer unavailable (${err || "llm_unavailable"}).`,
  });
}
export function fallbackReviewDecisionFromJson({ reviewEvidencePath = "", reviewError = "", reviewResultRaw = "" } = {}) {
  return fallbackReviewDecision({
    reviewEvidencePath,
    reviewError,
    reviewVerdict: trim(reviewResultRaw),
  });
}
export function resolveZeroDeltaReviewRoute() {
  return {
    disposition: "reject",
    recommended_transition: "revise",
    route_reason: "zero_delta_stale_branch",
  };
}
export function buildImplResult({
  issueNumber,
  branch,
  worktreeDir,
  reviewFailed,
  reviewNotes,
  disposition = "",
  decisionConfidence = "",
  decisionEvidence = "",
  merged = false,
  zeroDeltaRetry = "",
  zeroDeltaRetryCount = "",
  reviewEvidencePath = "",
  factoryId = "",
  runId = "",
  emitDomainEventFn,
} = {}) {
  const result = {
    issue_number: String(issueNumber || ""),
    branch: String(branch || ""),
    worktree_dir: String(worktreeDir || ""),
    review_failed: reviewFailed ? "true" : "false",
    review_notes: String(reviewNotes || ""),
    disposition: String(disposition || "").trim(),
    decision_confidence: String(decisionConfidence || "").trim(),
    decision_evidence: String(decisionEvidence || "").trim(),
    zero_delta_retry: String(zeroDeltaRetry || "").trim(),
    zero_delta_retry_count: String(zeroDeltaRetryCount || "").trim(),
    merged: merged ? "true" : "false",
    review_evidence_path: String(reviewEvidencePath || "").trim(),
  };
  const canonicalEvents = dispatchCanonicalDomainEvents({
    events: [
      buildIssueExecutionCompletedEvent({
        factoryId,
        runId,
        issueNumber: result.issue_number,
        branch: result.branch,
        worktreeDir: result.worktree_dir,
        disposition: result.disposition,
        reviewFailed: result.review_failed,
        merged: result.merged,
        reviewEvidencePath: result.review_evidence_path,
      }),
      result.disposition
        ? buildReviewVerdictAppliedEvent({
          factoryId,
          runId,
          issueNumber: result.issue_number,
          disposition: result.disposition,
          reviewNotes: result.review_notes,
          decisionConfidence: result.decision_confidence,
          decisionEvidence: result.decision_evidence,
          zeroDeltaRetry: result.zero_delta_retry,
          zeroDeltaRetryCount: result.zero_delta_retry_count,
        })
        : null,
    ],
    emitDomainEventFn,
  });
  return {
    ...result,
    canonical_events: canonicalEvents,
  };
}
export function buildWaveIssueImplResult({
  issueNumber = "",
  branch = "",
  worktreeDir = "",
  reviewFailed = "false",
  reviewNotes = "",
  reviewEvidencePath = "",
  zeroDeltaRetry = "",
  zeroDeltaRetryCount = "",
  merged = "false",
  disposition = "",
  decisionConfidence = "",
  decisionEvidence = "",
  factoryId = "",
  runId = "",
  emitDomainEventFn,
} = {}) {
  return buildImplResult({
    issueNumber,
    branch,
    worktreeDir,
    reviewFailed: String(reviewFailed) === "true",
    reviewNotes,
    disposition,
    decisionConfidence,
    decisionEvidence,
    reviewEvidencePath,
    zeroDeltaRetry,
    zeroDeltaRetryCount,
    merged: String(merged) === "true",
    factoryId,
    runId,
    emitDomainEventFn,
  });
}
export function buildApprovedImplResult({
  issueNumber = "",
  branch = "",
  worktreeDir = "",
  reviewAttempt = "",
  maxReviewAttempts = "",
  reviewNotes = "",
  reviewEvidencePath = "",
  zeroDeltaRetry = "",
  zeroDeltaRetryCount = "",
  factoryId = "",
  runId = "",
  emitDomainEventFn,
} = {}) {
  const notes = `Approved (attempt ${trim(reviewAttempt) || "0"}/${trim(maxReviewAttempts) || "0"}). Merge deferred to wave end. ${trim(reviewNotes)}`.trim();
  return buildWaveIssueImplResult({
    issueNumber,
    branch,
    worktreeDir,
    disposition: "approved",
    reviewFailed: "false",
    reviewNotes: notes,
    reviewEvidencePath,
    zeroDeltaRetry,
    zeroDeltaRetryCount,
    factoryId,
    runId,
    emitDomainEventFn,
  });
}
export function buildInfraFailureImplResult({ issueNumber = "", branch = "", worktreeDir = "", reason = "" } = {}) {
  const notes = `Worktree setup infrastructure failure: ${trim(reason) || "unknown"}. Issue will be retried on next wave dispatch without consuming review budget.`;
  return buildImplResult({
    issueNumber,
    branch,
    worktreeDir,
    reviewFailed: true,
    reviewNotes: notes,
    disposition: "infra_failure",
  });
}
export function buildFailedImplResult({
  issueNumber = "",
  branch = "",
  worktreeDir = "",
  reviewAttempt = "",
  maxReviewAttempts = "",
  reviewNotes = "",
  reviewEvidencePath = "",
  zeroDeltaRetry = "",
  zeroDeltaRetryCount = "",
  factoryId = "",
  runId = "",
  emitDomainEventFn,
} = {}) {
  const notes = `Review failed after ${trim(reviewAttempt) || "0"}/${trim(maxReviewAttempts) || "0"} attempts. ${trim(reviewNotes)}`.trim();
  return buildWaveIssueImplResult({
    issueNumber,
    branch,
    worktreeDir,
    disposition: "revise",
    reviewFailed: "true",
    reviewNotes: notes,
    reviewEvidencePath,
    zeroDeltaRetry,
    zeroDeltaRetryCount,
    factoryId,
    runId,
    emitDomainEventFn,
  });
}
// Zero-delta retries represent a stale-branch/no-new-commits loop, not real
// implementation progress. Cap them separately from review_attempt so we keep
// the normal attempt budget intact while still forcing a deterministic give-up.
// Match the default review-attempt budget (3) so operators get a small, bounded
// chance to recover from snapshot/reuse oddities without creating infinite loops.
export const ZERO_DELTA_RETRY_LIMIT = 3;
function resolveZeroDeltaStatePaths({ worktreeDir = "", issueNumber = "" } = {}) {
  const wd = String(worktreeDir || ".").trim();
  const issue = String(issueNumber || "").trim();
  const dir = join(wd, ".hatch", "wave-issue", "zero-delta");
  const path = issue ? join(dir, `${issue}.json`) : "";
  return { dir, path };
}
function loadZeroDeltaStateRecord({ worktreeDir = "", issueNumber = "" } = {}) {
  const { dir, path } = resolveZeroDeltaStatePaths({ worktreeDir, issueNumber });
  if (!path || !existsSync(path)) return { dir, path, data: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return { dir, path, data: parsed && typeof parsed === "object" ? parsed : {} };
  } catch {
    return { dir, path, data: {} };
  }
}
function persistZeroDeltaStateRecord({ dir = "", path = "", data = {} } = {}) {
  if (!dir || !path) return "";
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
  return path;
}
function removeZeroDeltaStateRecord(pathValue = "") {
  const target = trim(pathValue);
  if (!target || !existsSync(target)) return;
  try {
    rmSync(target);
  } catch {
    // ignore cleanup errors; state rewrites are best-effort telemetry
  }
}
function defaultReviewEvidencePath({ worktreeDir = "", issueNumber = "" } = {}) {
  const wd = trim(worktreeDir);
  const issue = trim(issueNumber);
  if (!wd || !issue) return "";
  return join(wd, ".hatch", "review", `${issue}.json`);
}
export function resolveLatestReviewEvidencePath({ reviewEvidencePath = "", worktreeDir = "", issueNumber = "" } = {}) {
  const explicit = resolvePath(reviewEvidencePath);
  if (explicit && existsSync(explicit)) {
    return {
      review_evidence_path: explicit,
      review_evidence_present: "true",
      review_evidence_source: "explicit",
    };
  }
  const discovered = defaultReviewEvidencePath({ worktreeDir, issueNumber });
  if (discovered && existsSync(discovered)) {
    return {
      review_evidence_path: discovered,
      review_evidence_present: "true",
      review_evidence_source: "worktree_default",
    };
  }
  return {
    review_evidence_path: explicit || discovered,
    review_evidence_present: "false",
    review_evidence_source: explicit ? "explicit_missing" : "worktree_default_missing",
  };
}
export function readZeroDeltaState({ worktreeDir = "", issueNumber = "" } = {}) {
  const { data } = loadZeroDeltaStateRecord({ worktreeDir, issueNumber });
  return {
    zero_delta_retry: String(data?.zero_delta_retry || "false") === "true" ? "true" : "false",
    zero_delta_retry_count: String(data?.zero_delta_retry_count || "0").trim() || "0",
    precheck_done_elsewhere: String(data?.precheck_done_elsewhere || "false") === "true" ? "true" : "false",
    precheck_reason: String(data?.precheck_reason || "").trim(),
    review_evidence_path: String(data?.review_evidence_path || "").trim(),
  };
}
export function recordZeroDeltaRetry({ worktreeDir = "", issueNumber = "", zeroDeltaTriggered = "false", commitsAhead = "0" } = {}) {
  const issue = String(issueNumber || "").trim();
  if (!issue) {
    return {
      zero_delta_retry: "false",
      zero_delta_retry_count: "0",
      precheck_done_elsewhere: "false",
      precheck_reason: "",
      review_evidence_path: "",
      zero_delta_state_path: "",
    };
  }
  const triggered = String(zeroDeltaTriggered || "").trim().toLowerCase() === "true";
  const commits = Number.parseInt(String(commitsAhead || "0"), 10) || 0;
  const prior = loadZeroDeltaStateRecord({ worktreeDir, issueNumber: issue });
  const priorState = readZeroDeltaState({ worktreeDir, issueNumber: issue });
  if (!triggered || commits > 0) {
    const next = {
      issue_number: issue,
      zero_delta_retry: "false",
      zero_delta_retry_count: "0",
      precheck_done_elsewhere: commits > 0 ? "false" : priorState.precheck_done_elsewhere,
      precheck_reason: commits > 0 ? "" : priorState.precheck_reason,
      review_evidence_path: commits > 0 ? "" : priorState.review_evidence_path,
      updated_at: Math.floor(Date.now() / 1000),
    };
    const keepRecord = next.precheck_done_elsewhere === "true"
      || Boolean(next.precheck_reason)
      || Boolean(next.review_evidence_path);
    if (!keepRecord) {
      removeZeroDeltaStateRecord(prior.path);
      return {
        zero_delta_retry: "false",
        zero_delta_retry_count: "0",
        precheck_done_elsewhere: "false",
        precheck_reason: "",
        review_evidence_path: "",
        zero_delta_state_path: prior.path,
      };
    }
    persistZeroDeltaStateRecord({ dir: prior.dir, path: prior.path, data: next });
    return {
      zero_delta_retry: next.zero_delta_retry,
      zero_delta_retry_count: next.zero_delta_retry_count,
      precheck_done_elsewhere: next.precheck_done_elsewhere,
      precheck_reason: next.precheck_reason,
      review_evidence_path: next.review_evidence_path,
      zero_delta_state_path: prior.path,
    };
  }
  const nextCount = (Number.parseInt(String(priorState.zero_delta_retry_count || "0"), 10) || 0) + 1;
  const payload = {
    issue_number: issue,
    zero_delta_retry: "true",
    zero_delta_retry_count: String(nextCount),
    precheck_done_elsewhere: priorState.precheck_done_elsewhere,
    precheck_reason: priorState.precheck_reason,
    review_evidence_path: priorState.review_evidence_path,
    updated_at: Math.floor(Date.now() / 1000),
  };
  persistZeroDeltaStateRecord({ dir: prior.dir, path: prior.path, data: payload });
  return {
    zero_delta_retry: "true",
    zero_delta_retry_count: String(nextCount),
    precheck_done_elsewhere: payload.precheck_done_elsewhere,
    precheck_reason: payload.precheck_reason,
    review_evidence_path: payload.review_evidence_path,
    zero_delta_state_path: prior.path,
  };
}
export function recordDoneElsewherePrecheck({ worktreeDir = "", issueNumber = "", precheckDoneElsewhere = "false", precheckReason = "", reviewEvidencePath = "" } = {}) {
  const issue = trim(issueNumber);
  if (!issue) {
    return {
      precheck_done_elsewhere: "false",
      precheck_reason: trim(precheckReason),
      review_evidence_path: trim(reviewEvidencePath),
      zero_delta_state_path: "",
    };
  }
  const prior = loadZeroDeltaStateRecord({ worktreeDir, issueNumber: issue });
  const priorState = readZeroDeltaState({ worktreeDir, issueNumber: issue });
  const next = {
    issue_number: issue,
    zero_delta_retry: priorState.zero_delta_retry,
    zero_delta_retry_count: priorState.zero_delta_retry_count,
    precheck_done_elsewhere: String(precheckDoneElsewhere || "false") === "true" ? "true" : "false",
    precheck_reason: trim(precheckReason),
    review_evidence_path: trim(reviewEvidencePath) || priorState.review_evidence_path,
    updated_at: Math.floor(Date.now() / 1000),
  };
  persistZeroDeltaStateRecord({ dir: prior.dir, path: prior.path, data: next });
  return {
    precheck_done_elsewhere: next.precheck_done_elsewhere,
    precheck_reason: next.precheck_reason,
    review_evidence_path: next.review_evidence_path,
    zero_delta_state_path: prior.path,
  };
}
export function evaluateDoneElsewherePrecheck({ reviewEvidencePath = "" } = {}) {
  const p = String(reviewEvidencePath || "").trim();
  if (!p) return { precheck_done_elsewhere: "false", precheck_reason: "missing_review_evidence" };
  let evidence = {};
  try {
    evidence = JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return { precheck_done_elsewhere: "false", precheck_reason: "invalid_review_evidence" };
  }
  const commitsAhead = Number.parseInt(String(evidence?.commits_ahead || "0"), 10) || 0;
  const changedFiles = Array.isArray(evidence?.changed_files) ? evidence.changed_files : [];
  const hasIssueScopedDelta = evidence && Object.prototype.hasOwnProperty.call(evidence, "issue_commits");
  const issueCommits = Number.parseInt(String(evidence?.issue_commits || "0"), 10) || 0;
  const issueChangedFiles = Array.isArray(evidence?.issue_changed_files) ? evidence.issue_changed_files : [];
  const qaStatus = String(evidence?.qa?.status || "").trim().toLowerCase();
  const qaCommand = String(evidence?.qa?.command || "").trim();
  const dirty = Boolean(evidence?.dirty);
  const scopePrefix = hasIssueScopedDelta ? "issue_scoped" : "branch_scoped";
  const scopedCommits = hasIssueScopedDelta ? issueCommits : commitsAhead;
  const scopedFiles = hasIssueScopedDelta ? issueChangedFiles : changedFiles;
  if (dirty) return { precheck_done_elsewhere: "false", precheck_reason: "dirty_worktree" };
  if (scopedCommits !== 0) return { precheck_done_elsewhere: "false", precheck_reason: `${scopePrefix}_commits_present` };
  if (scopedFiles.length !== 0) return { precheck_done_elsewhere: "false", precheck_reason: `${scopePrefix}_changed_files_present` };
  if (qaStatus !== "pass" || !qaCommand) return { precheck_done_elsewhere: "false", precheck_reason: `${scopePrefix}_qa_not_passing` };
  return { precheck_done_elsewhere: "true", precheck_reason: `${scopePrefix}_zero_delta_with_passing_qa` };
}
export function evaluateDoneElsewherePrecheckWithState({ reviewEvidencePath = "", worktreeDir = "", issueNumber = "" } = {}) {
  const resolved = resolveLatestReviewEvidencePath({ reviewEvidencePath, worktreeDir, issueNumber });
  const evaluated = evaluateDoneElsewherePrecheck({ reviewEvidencePath: resolved.review_evidence_path });
  const recorded = recordDoneElsewherePrecheck({
    worktreeDir,
    issueNumber,
    precheckDoneElsewhere: evaluated.precheck_done_elsewhere,
    precheckReason: evaluated.precheck_reason,
    reviewEvidencePath: resolved.review_evidence_path,
  });
  const state = readZeroDeltaState({ worktreeDir, issueNumber });
  return {
    review_evidence_path: resolved.review_evidence_path,
    review_evidence_present: resolved.review_evidence_present,
    review_evidence_source: resolved.review_evidence_source,
    precheck_done_elsewhere: evaluated.precheck_done_elsewhere,
    precheck_reason: evaluated.precheck_reason,
    zero_delta_retry: state.zero_delta_retry,
    zero_delta_retry_count: state.zero_delta_retry_count,
    zero_delta_state_path: recorded.zero_delta_state_path,
  };
}
function isOwnerRepoSlug(value = "") {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(value || "").trim());
}
export function parseGitHubRepoFromRemoteUrl(remoteUrl = "") {
  const raw = String(remoteUrl || "").trim();
  if (!raw) return "";
  const patterns = [
    /^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/,
    /^https?:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/,
    /^ssh:\/\/git@github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/,
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match?.[1]) return String(match[1]).trim();
  }
  return "";
}
export function resolveIssueMetadataRepo({ repo = "", worktreeDir = "" } = {}) {
  const explicit = String(repo || "").trim();
  if (isOwnerRepoSlug(explicit) && !explicit.startsWith("/") && !explicit.startsWith(".")) return explicit;
  const candidates = [explicit, String(worktreeDir || "").trim()].filter(Boolean);
  for (const candidate of candidates) {
    const remote = run(["git", "-C", candidate, "remote", "get-url", "origin"], candidate);
    if (remote.code !== 0) continue;
    const parsed = parseGitHubRepoFromRemoteUrl(remote.stdout);
    if (parsed) return parsed;
  }
  return explicit;
}
export function writeReviewEvidence({
  worktreeDir,
  repo,
  issueNumber,
  branch,
  issueTitle,
  issueBody,
  reviewQaCommand,
  integrationCommand,
  snapshotSha = "",
  builderOutput = "",
  builderNotesB64 = "",
} = {}) {
  const wd = String(worktreeDir || ".");
  const issue = String(issueNumber || "");
  const r = String(repo || "").trim();
  // Fetch issue title/body from GitHub instead of relying on shell args
  // (shell args break on multi-line content with quotes/metacharacters)
  let title = String(issueTitle || "").trim();
  let body = String(issueBody || "").trim();
  const metadataRepo = resolveIssueMetadataRepo({ repo: r, worktreeDir: wd });
  const lookupRepos = [...new Set([metadataRepo, r].filter(Boolean))];
  if (issue && (!title || !body)) {
    for (const lookupRepo of lookupRepos) {
      const data = ghJson(["issue", "view", issue, "--repo", lookupRepo, "--json", "title,body"], null);
      if (!data || typeof data !== "object") continue;
      if (!title) title = String(data.title || "").trim();
      if (!body) body = String(data.body || "").trim();
      if (title && body) break;
    }
  }
  const resolvedQaCommands = resolvePersistedQaCommands({
    reviewQaCommand: String(reviewQaCommand || "").trim(),
    integrationCommand: String(integrationCommand || "").trim(),
    worktreeDir: wd,
    repo: repo || ".",
  });
  const qaCmd = resolvedQaCommands.qa_command;
  const commits = run(["git", "-C", wd, "rev-list", "--count", "main..HEAD"]).stdout || "0";
  const files = run(["git", "-C", wd, "diff", "--name-only", "main...HEAD"]).stdout;
  const head = run(["git", "-C", wd, "rev-parse", "HEAD"]).stdout;
  const dirty = Boolean(run(["git", "-C", wd, "status", "--porcelain"]).stdout);
  const commitsAhead = Number.parseInt(String(commits || "0").trim() || "0", 10) || 0;
  const allChangedFiles = String(files || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const snap = String(snapshotSha || "").trim();
  const branchName = String(branch || "").trim();
  const sharedBranch = isSharedWaveBranch(branchName);
  if (sharedBranch && !snap && (commitsAhead > 0 || allChangedFiles.length > 0)) {
    return {
      review_evidence_path: "",
      review_evidence_sha256: "",
      review_evidence_valid: "false",
      review_evidence_error: "review_evidence_snapshot_missing",
      review_evidence_note: "snapshot_sha required for issue-scoped diffs; rerun after snapshot_head completes.",
    };
  }
  const delta = resolveIssueScopedDelta({
    worktreeDir: wd,
    issueNumber: issue,
    branch: branchName,
    snapshotSha: snap,
    changedFiles: allChangedFiles,
    commitsAhead: String(commitsAhead),
  });
  const qa = runQaCommand({ command: qaCmd, worktreeDir: wd });
  const qaSignature = qa.command
    ? sha256Hex(JSON.stringify({ status: qa.status, command: qa.command, exit_code: qa.exit_code, stdout: qa.stdout, stderr: qa.stderr }))
    : "";
  const scopeDiagnostics = buildReviewEvidenceScopeDiagnostics({
    snapshotScopeStatus: delta.snapshot_scope_status,
    commitsAhead: delta.commits_ahead,
    issueCommits: delta.issue_commits,
    issueChangedFilesCount: String(Array.isArray(delta.issue_changed_files) ? delta.issue_changed_files.length : 0),
    worktreeDir: wd,
    repo: r,
    issueNumber: issue,
    branch: branchName,
    snapshotSha: snap,
  });
  const reviewEvidenceNote = buildReviewEvidenceNote(scopeDiagnostics);
  const zeroDeltaTriggered = Number.parseInt(delta.issue_commits, 10) === 0 && delta.issue_changed_files.length === 0;
  const zeroDeltaState = recordZeroDeltaRetry({ worktreeDir: wd, issueNumber: issue, zeroDeltaTriggered: zeroDeltaTriggered ? "true" : "false", commitsAhead: delta.issue_commits });
  const diagnostics = buildReviewEvidenceDiagnostics({
    issueNumber: issue,
    branch: branchName,
    snapshotSha: snap,
    delta,
  });
  const builderNotes = resolveBuilderNotes({ builderOutput, builderNotesB64 });
  const evidence = {
    issue_number: issue,
    issue_title: title,
    issue_body_excerpt: body.slice(0, 1200),
    branch: String(branch || ""),
    worktree_dir: wd,
    commits_ahead: delta.commits_ahead,
    changed_files: delta.changed_files,
    // Issue-scoped fields: only this issue's commits (excludes sibling work on shared branches)
    issue_commits: delta.issue_commits,
    issue_changed_files_count: String(Array.isArray(delta.issue_changed_files) ? delta.issue_changed_files.length : 0),
    issue_changed_files: Array.isArray(delta.issue_changed_files) ? delta.issue_changed_files : [],
    snapshot_sha: snap || "",
    snapshot_scope_status: delta.snapshot_scope_status,
    scope_diagnostics: scopeDiagnostics,
    review_evidence_note: reviewEvidenceNote,
    ...(builderNotes ? { builder_notes: builderNotes } : {}),
    diagnostics,
    head_commit: String(head || "").trim(),
    dirty,
    review_qa_command: resolvedQaCommands.review_qa_command,
    integration_command: resolvedQaCommands.integration_command,
    qa,
    qa_signature: qaSignature,
    qa_rerun: null,
    zero_delta_retry: zeroDeltaState.zero_delta_retry,
    zero_delta_retry_count: zeroDeltaState.zero_delta_retry_count,
    summary: commitsAhead > 0 ? "Existing commits reviewed" : "No commits ahead of main",
    generated_at: Math.floor(Date.now() / 1000),
  };
  // Store evidence in the factory repo's .hatch/ (gitignored) rather than the
  // worktree's .hatch/ (not gitignored in target repos). Worktree evidence files
  // get deleted by git clean between sequential issue builds on shared branches.
  const evidenceBaseDir = resolve(r || wd);
  const persisted = persistReviewEvidence({ evidence, outPath: join(evidenceBaseDir, ".hatch", "review", `${issue}.json`) });
  if (builderNotes) {
    persisted.builder_notes = builderNotes;
  }
  if (persisted.review_evidence_valid === "true" && diagnostics.length > 0) {
    persisted.review_evidence_note = diagnostics.map((entry) => entry.message).join(" ");
    persisted.review_evidence_diagnostic_code = diagnostics.map((entry) => trim(entry.code)).filter(Boolean).join(",");
  }
  // Expose issue-scoped changed files so reviewer prompt can bind ${issue_changed_files} (not full-branch diff).
  persisted.issue_changed_files = Array.isArray(delta.issue_changed_files) ? delta.issue_changed_files : [];
  return persisted;
}
export function validateZeroDeltaReviewEvidence({ reviewEvidencePath = "", worktreeDir = "", issueNumber = "", branch = "" } = {}) {
  const loaded = loadReviewEvidenceArtifact(reviewEvidencePath);
  if (!loaded.ok || !loaded.evidence) {
    return {
      zero_delta_detected: "false",
      classification: "review_evidence_error",
      review_notes: `Zero-delta validation could not load review evidence (${loaded.code || "review_evidence_load_failed"}).`,
      review_evidence_path: loaded.path || resolvePath(reviewEvidencePath),
      review_evidence_valid: "false",
      review_evidence_error: loaded.code || "review_evidence_load_failed",
      commits_ahead: "0",
      issue_commits: "0",
    };
  }
  const evidence = loaded.evidence && typeof loaded.evidence === "object" ? loaded.evidence : {};
  const resolvedWorktree = trim(worktreeDir || evidence.worktree_dir || ".");
  const resolvedIssue = trim(issueNumber || evidence.issue_number);
  const resolvedBranch = trim(branch || evidence.branch);
  const delta = resolveIssueScopedDelta({
    worktreeDir: resolvedWorktree,
    issueNumber: resolvedIssue,
    branch: resolvedBranch,
    snapshotSha: trim(evidence.snapshot_sha),
    changedFiles: Array.isArray(evidence.changed_files) ? evidence.changed_files : [],
    commitsAhead: trim(evidence.commits_ahead),
    issueChangedFiles: Array.isArray(evidence.issue_changed_files) ? evidence.issue_changed_files : [],
    issueCommits: trim(evidence.issue_commits),
  });
  const branchCommits = Number.parseInt(delta.commits_ahead, 10) || 0;
  const scopedCommits = Number.parseInt(delta.issue_commits, 10) || 0;
  const scopedFilesCount = Array.isArray(delta.issue_changed_files) ? delta.issue_changed_files.length : 0;
  const judgeContext = evidence.judge_context && typeof evidence.judge_context === "object" ? evidence.judge_context : {};
  const judgeContextScenario = trim(judgeContext.scenario);
  const zeroDeltaDetected = branchCommits === 0 && scopedCommits === 0;
  if (zeroDeltaDetected) {
    const diagnostics = Array.isArray(evidence.scope_diagnostics) ? evidence.scope_diagnostics : [];
    const primaryDiagnostic = diagnostics[0] && typeof diagnostics[0] === "object" ? diagnostics[0] : null;
    const diagnosticMessage = trim(primaryDiagnostic?.message || evidence.review_evidence_note);
    const rerunCommand = trim(primaryDiagnostic?.rerun_command || "");
    return {
      zero_delta_detected: "true",
      classification: "stale_branch",
      review_notes: [
        "classification=stale_branch",
        `No issue-scoped commits are available for review on branch ${resolvedBranch || "(unknown branch)"} for issue #${resolvedIssue || "(unknown issue)"}.`,
        `Review evidence reports commits_ahead=${branchCommits} and issue_commits=${scopedCommits} with issue_changed_files_count=${scopedFilesCount}.`,
        "The missing issue commit means reviewer approval would be wasted on a stale branch; land at least one issue-scoped code/test commit before requesting review again.",
        judgeContextScenario ? `Judge-context style evidence scenario=${judgeContextScenario}.` : "",
        diagnosticMessage,
        rerunCommand ? `Missing-commit guidance: rerun history/evidence validation with ${rerunCommand}` : "",
      ].filter(Boolean).join(" "),
      review_evidence_path: loaded.path,
      review_evidence_valid: "true",
      review_evidence_error: "",
      commits_ahead: String(branchCommits),
      issue_commits: String(scopedCommits),
    };
  }
  return {
    zero_delta_detected: "false",
    classification: "has_delta",
    review_notes: `Issue-scoped delta detected for branch ${resolvedBranch || "(unknown branch)"}; continue to reviewer path because commits/files remain in scope for this issue.`,
    review_evidence_path: loaded.path,
    review_evidence_valid: "true",
    review_evidence_error: "",
    commits_ahead: String(branchCommits),
    issue_commits: String(scopedCommits),
  };
}
export function rerunReviewEvidenceQa({ reviewEvidencePath = "", worktreeDir = "", repo = "" } = {}) {
  const loaded = loadReviewEvidenceArtifact(reviewEvidencePath);
  if (!loaded.ok || !loaded.evidence) {
    return {
      qa_rerun_ok: "false",
      review_evidence_path: loaded.path || resolvePath(reviewEvidencePath),
      review_evidence_sha256: "",
      review_evidence_valid: "false",
      review_evidence_error: loaded.code || "review_evidence_load_failed",
      qa_status: "",
      qa_command: "",
      qa_exit_code: "",
      qa_rerun_count: "0",
      qa_rerun_error: loaded.code || "review_evidence_load_failed",
      qa_rerun_timestamp: String(Math.floor(Date.now() / 1000)),
    };
  }
  const evidence = loaded.evidence && typeof loaded.evidence === "object" ? loaded.evidence : {};
  const worktree = trim(worktreeDir || evidence.worktree_dir || ".");
  const resolvedQaCommands = resolvePersistedQaCommands({
    qaCommand: trim(evidence?.qa?.command),
    reviewQaCommand: trim(evidence?.review_qa_command),
    integrationCommand: trim(evidence?.integration_command),
    worktreeDir: worktree,
    repo: repo || evidence.worktree_dir || ".",
  });
  const qa = runQaCommand({ command: resolvedQaCommands.qa_command, worktreeDir: worktree });
  process.stderr.write(`[wave-issue] qa_rerun executing source=${resolvedQaCommands.qa_command_source || "missing"} command=${qa.command || "(missing)"}\n`);
  const priorRerun = evidence.qa_rerun && typeof evidence.qa_rerun === "object" ? evidence.qa_rerun : {};
  const priorCount = Number.parseInt(trim(priorRerun.count), 10) || 0;
  const nextCount = priorCount + 1;
  const timestamp = Math.floor(Date.now() / 1000);
  const qaHash = sha256Hex(JSON.stringify({ status: qa.status, command: qa.command, exit_code: qa.exit_code, stdout: qa.stdout, stderr: qa.stderr }));
  const rerunEvidence = {
    ...evidence,
    worktree_dir: worktree || evidence.worktree_dir || "",
    review_qa_command: resolvedQaCommands.review_qa_command,
    integration_command: resolvedQaCommands.integration_command,
    qa,
    qa_signature: qaHash,
    qa_rerun: {
      count: String(nextCount),
      last_timestamp: String(timestamp),
      last_exit_code: String(qa.exit_code ?? ""),
      last_status: String(qa.status || ""),
      last_hash: qaHash,
      last_stdout_excerpt: qa.stdout,
      last_stderr_excerpt: qa.stderr,
      last_command: qa.command,
    },
  };
  const persisted = persistReviewEvidence({ evidence: rerunEvidence, outPath: loaded.path });
  const ok = persisted.review_evidence_valid === "true" && qa.command !== "" && qa.status === "pass";
  return {
    qa_rerun_ok: ok ? "true" : "false",
    review_evidence_path: persisted.review_evidence_path,
    review_evidence_sha256: persisted.review_evidence_sha256,
    review_evidence_valid: persisted.review_evidence_valid,
    review_evidence_error: persisted.review_evidence_error,
    qa_status: qa.status,
    qa_command: qa.command,
    qa_exit_code: String(qa.exit_code ?? ""),
    qa_stdout_excerpt: qa.stdout,
    qa_stderr_excerpt: qa.stderr,
    qa_rerun_count: String(nextCount),
    qa_rerun_error: ok ? "" : qa.command ? "qa_rerun_failed" : "qa_command_missing",
    qa_rerun_timestamp: String(timestamp),
    qa_command_source: resolvedQaCommands.qa_command_source,
    review_qa_command: resolvedQaCommands.review_qa_command,
    integration_command: resolvedQaCommands.integration_command,
  };
}
/**
 * Combined decide-existing-reuse that also sets review_notes when reuse=true.
 * Replaces the separate report_existing node.
 */
export function decideExistingReuseWithNotes({ branch = "", existingCommits = "0", issueNumber = "", worktreeDir = "" } = {}) {
  const decision = decideExistingReuse({ branch, existingCommits, issueNumber, worktreeDir });
  return {
    reuse_existing_commits: decision,
    review_notes: decision === "true" ? "Existing commits already present on branch; running review without new implementation." : "",
  };
}
/** Combined resolve-max-review-attempts + init-review-attempt. */
export function resolveMaxReviewAttemptsWithInit(maxRaw = "") {
  const v = String(maxRaw || "").trim();
  return { max_review_attempts: v || String(DEFAULT_MAX_REVIEW_ATTEMPTS), review_attempt: "0" };
}
