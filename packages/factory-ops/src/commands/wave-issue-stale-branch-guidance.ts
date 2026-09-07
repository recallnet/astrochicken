import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { emitSupervisorArtifact } from "./supervisor-artifact.ts";
import { trim } from "../lib/cli-helpers.ts";


function resolvePath(pathValue = "") {
  const raw = trim(pathValue);
  if (!raw) return "";
  return resolve(process.cwd(), raw);
}

function loadReviewEvidenceArtifact(pathValue = "") {
  const resolved = resolvePath(pathValue);
  if (!resolved) return { ok: false, code: "review_evidence_path_missing", path: "", evidence: null };
  try {
    const parsed = JSON.parse(readFileSync(resolved, "utf8"));
    if (!parsed || typeof parsed !== "object") {
      return { ok: false, code: "review_evidence_invalid_json", path: resolved, evidence: null };
    }
    return { ok: true, code: "ok", path: resolved, evidence: parsed };
  } catch (error) {
    if (String(error?.code || "") === "ENOENT") {
      return { ok: false, code: "review_evidence_not_found", path: resolved, evidence: null };
    }
    return { ok: false, code: "review_evidence_invalid_json", path: resolved, evidence: null };
  }
}

function evaluateZeroDeltaEvidence(evidence = {}) {
  const hasCommitsAhead = Object.prototype.hasOwnProperty.call(evidence || {}, "commits_ahead");
  const hasIssueChangedFiles = Object.prototype.hasOwnProperty.call(evidence || {}, "issue_changed_files");
  if (!hasCommitsAhead || !hasIssueChangedFiles) {
    return {
      ok: false,
      code: "review_evidence_missing_required_fields",
      commits_ahead: null,
      issue_changed_files: [],
      is_zero_delta: false,
    };
  }

  const commitsAheadRaw = trim(evidence?.commits_ahead);
  if (!/^-?\d+$/.test(commitsAheadRaw)) {
    return {
      ok: false,
      code: "review_evidence_invalid_commits_ahead",
      commits_ahead: null,
      issue_changed_files: [],
      is_zero_delta: false,
    };
  }

  const issueChangedFilesRaw = evidence?.issue_changed_files;
  if (!Array.isArray(issueChangedFilesRaw)) {
    return {
      ok: false,
      code: "review_evidence_invalid_issue_changed_files",
      commits_ahead: Number.parseInt(commitsAheadRaw, 10),
      issue_changed_files: [],
      is_zero_delta: false,
    };
  }

  const commitsAhead = Number.parseInt(commitsAheadRaw, 10);
  const issueChangedFiles = issueChangedFilesRaw.map((entry) => trim(entry)).filter(Boolean);
  return {
    ok: true,
    code: "ok",
    commits_ahead: commitsAhead,
    issue_changed_files: issueChangedFiles,
    is_zero_delta: commitsAhead === 0 && issueChangedFiles.length === 0,
  };
}

function buildStaleBranchSupervisorGuidance({ issueNumber = "", branch = "", reviewEvidencePath = "", evidence = {} } = {}) {
  const issue = trim(issueNumber || evidence?.issue_number);
  const branchName = trim(branch || evidence?.branch);
  const reviewPath = trim(reviewEvidencePath);
  const snapshotSha = trim(evidence?.snapshot_sha);
  const judgeContextValid = trim(evidence?.judge_context_valid);
  const judgeContextError = trim(evidence?.judge_context_error);
  const qaStatus = trim(evidence?.qa?.status).toLowerCase();
  const qaCommand = trim(evidence?.qa?.command);

  return [
    `Issue #${issue || "(unknown issue)"} on branch ${branchName || "(unknown branch)"} has zero-delta review evidence: commits_ahead=0 and issue_changed_files=[].`,
    "Do not repeat the give-up loop blindly.",
    `Guidance: reopen branch \`${branchName || "wave/<issue>"}\` and land issue-scoped commits, provide concrete commit/file evidence for issue #${issue || "(unknown issue)"}, or explicitly mark the work implemented elsewhere / rescope the issue before retrying.`,
    `Review evidence: ${reviewPath || "(missing review evidence path)"}`,
    `Snapshot SHA: ${snapshotSha || "(missing snapshot sha)"}`,
    `QA status: ${qaStatus || "(missing qa.status)"}${qaCommand ? ` via \`${qaCommand}\`` : ""}`,
    `Judge context: valid=${judgeContextValid || ""} error=${judgeContextError || ""} (empty/missing judge context does not suppress stale-branch guidance).`,
  ].join("\n");
}

export function emitStaleBranchSupervisorGuidance({ repo = "", issueNumber = "", branch = "", reviewEvidencePath = "", runId = "", pipeline = "wave_issue_execute", goalIngest = false } = {}) {
  const loaded = loadReviewEvidenceArtifact(reviewEvidencePath);
  if (!loaded.ok || !loaded.evidence) {
    return {
      stale_branch_detected: "false",
      emitted: "false",
      classification: "review_evidence_error",
      review_evidence_path: loaded.path || resolvePath(reviewEvidencePath),
      error: loaded.code || "review_evidence_load_failed",
      issue_url: "",
      summary: "",
      body: "",
    };
  }

  const evidence = loaded.evidence && typeof loaded.evidence === "object" ? loaded.evidence : {};
  const zeroDelta = evaluateZeroDeltaEvidence(evidence);
  if (!zeroDelta.ok) {
    return {
      stale_branch_detected: "false",
      emitted: "false",
      classification: "review_evidence_error",
      review_evidence_path: loaded.path,
      error: zeroDelta.code,
      issue_url: "",
      summary: "",
      body: "",
    };
  }

  if (!zeroDelta.is_zero_delta) {
    return {
      stale_branch_detected: "false",
      emitted: "false",
      classification: "has_delta",
      review_evidence_path: loaded.path,
      error: "",
      issue_url: "",
      summary: "",
      body: "",
    };
  }

  const issue = trim(issueNumber || evidence?.issue_number);
  const branchName = trim(branch || evidence?.branch);
  const classification = "stale_branch";
  const summary = `Issue #${issue || "(unknown issue)"} branch ${branchName || "(unknown branch)"} disappeared into zero-delta review evidence`;
  const body = buildStaleBranchSupervisorGuidance({
    issueNumber: issue,
    branch: branchName,
    reviewEvidencePath: loaded.path,
    evidence,
  });
  const evidencePayload = JSON.stringify({
    issue_number: issue,
    branch: branchName,
    classification,
    review_evidence_path: loaded.path,
    commits_ahead: trim(evidence?.commits_ahead),
    issue_commits: trim(evidence?.issue_commits),
    issue_changed_files_count: String(zeroDelta.issue_changed_files.length),
    issue_changed_files: zeroDelta.issue_changed_files,
    judge_context_valid: trim(evidence?.judge_context_valid),
    judge_context_error: trim(evidence?.judge_context_error),
    guidance: body,
  });

  const artifact = emitSupervisorArtifact({
    repo,
    artifactType: "wave-issue-stale-branch",
    classification,
    summary,
    evidence: evidencePayload,
    runId,
    pipeline,
    goalIngest,
  });

  return {
    stale_branch_detected: "true",
    emitted: artifact.ok ? "true" : "false",
    classification,
    review_evidence_path: loaded.path,
    error: artifact.error || "",
    issue_url: artifact.issue_url || "",
    supervisor_artifact_url: artifact.issue_url || "",
    supervisor_artifact_error: artifact.error || "",
    summary,
    body,
  };
}
