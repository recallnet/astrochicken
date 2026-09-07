import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  readZeroDeltaState,
  resolveLatestReviewEvidencePath,
  validateZeroDeltaReviewEvidence,
} from "./wave-issue-state.ts";
import { trim } from "../lib/cli-helpers.ts";


function zeroDeltaStatePath({ worktreeDir = "", issueNumber = "" } = {}) {
  const wd = trim(worktreeDir) || ".";
  const issue = trim(issueNumber);
  return issue ? join(wd, ".hatch", "wave-issue", "zero-delta", `${issue}.json`) : "";
}

function buildStatusResult({
  ok = false,
  error = "",
  message = "",
  issueNumber = "",
  state = {},
  zeroDeltaDetected = "false",
  reviewNotes = "",
  commitsAhead = "0",
  issueCommits = "0",
  resolvedEvidence = {},
  branch = "",
} = {}) {
  return {
    ok,
    error,
    message,
    issue_number: trim(issueNumber),
    zero_delta_retry: trim(state.zero_delta_retry) || "false",
    zero_delta_retry_count: trim(state.zero_delta_retry_count) || "0",
    zero_delta_detected: trim(zeroDeltaDetected) || "false",
    review_notes: trim(reviewNotes),
    commits_ahead: trim(commitsAhead) || "0",
    issue_commits: trim(issueCommits) || "0",
    evidence_path: trim(resolvedEvidence.review_evidence_path),
    evidence_present: trim(resolvedEvidence.review_evidence_present) || "false",
    evidence_source: trim(resolvedEvidence.review_evidence_source),
    branch: trim(branch),
  };
}

export function readZeroDeltaStatus({ worktreeDir = "", issueNumber = "", reviewEvidencePath = "", branch = "" } = {}) {
  const issue = trim(issueNumber);
  const state = readZeroDeltaState({ worktreeDir, issueNumber: issue });
  const resolvedEvidence = resolveLatestReviewEvidencePath({
    reviewEvidencePath: reviewEvidencePath || state.review_evidence_path,
    worktreeDir,
    issueNumber: issue,
  });
  const statePath = zeroDeltaStatePath({ worktreeDir, issueNumber: issue });

  if (!statePath || !existsSync(statePath)) {
    return buildStatusResult({
      ok: false,
      error: "zero_delta_state_not_found",
      message: `Zero-delta state not found for issue #${issue || "(unknown issue)"} at ${statePath || "(missing path)"}.`,
      issueNumber: issue,
      state,
      resolvedEvidence,
      branch,
    });
  }

  if (resolvedEvidence.review_evidence_present !== "true") {
    return buildStatusResult({
      ok: false,
      error: "review_evidence_not_found",
      message: `Review evidence not found for issue #${issue || "(unknown issue)"} at ${resolvedEvidence.review_evidence_path || "(missing path)"}.`,
      issueNumber: issue,
      state,
      resolvedEvidence,
      branch,
    });
  }

  const validated = validateZeroDeltaReviewEvidence({
    reviewEvidencePath: resolvedEvidence.review_evidence_path,
    worktreeDir,
    issueNumber: issue,
    branch,
  });

  if (trim(validated.review_evidence_error)) {
    return buildStatusResult({
      ok: false,
      error: trim(validated.review_evidence_error),
      message: `Zero-delta status could not validate review evidence (${trim(validated.review_evidence_error)}).`,
      issueNumber: issue,
      state,
      zeroDeltaDetected: validated.zero_delta_detected,
      reviewNotes: validated.review_notes,
      commitsAhead: validated.commits_ahead,
      issueCommits: validated.issue_commits,
      resolvedEvidence,
      branch,
    });
  }

  return buildStatusResult({
    ok: true,
    error: "",
    message: "ok",
    issueNumber: issue,
    state,
    zeroDeltaDetected: validated.zero_delta_detected,
    reviewNotes: validated.review_notes,
    commitsAhead: validated.commits_ahead,
    issueCommits: validated.issue_commits,
    resolvedEvidence,
    branch,
  });
}
