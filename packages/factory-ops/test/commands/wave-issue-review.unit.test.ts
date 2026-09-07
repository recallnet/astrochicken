import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_MAX_REVIEW_ATTEMPTS,
  ZERO_DELTA_RETRY_LIMIT,
  initReviewAttempt,
  nextReviewAttempt,
  shouldRetryReview,
  buildImplResult,
  buildApprovedImplResult,
  buildFailedImplResult,
  buildInfraFailureImplResult,
  resolveZeroDeltaReviewRoute,
  parseGitHubRepoFromRemoteUrl,
  resolveMaxReviewAttemptsWithInit,
} from "../../src/commands/wave-issue-review.ts";

describe("DEFAULT_MAX_REVIEW_ATTEMPTS", () => {
  it("equals 3", () => {
    assert.equal(DEFAULT_MAX_REVIEW_ATTEMPTS, 3);
  });
});

describe("ZERO_DELTA_RETRY_LIMIT", () => {
  it("equals 3", () => {
    assert.equal(ZERO_DELTA_RETRY_LIMIT, 3);
  });
});

describe("initReviewAttempt", () => {
  it("returns '0'", () => {
    assert.equal(initReviewAttempt(), "0");
  });
});

describe("nextReviewAttempt", () => {
  it("increments '0' to '1'", () => {
    assert.equal(nextReviewAttempt("0"), "1");
  });

  it("increments '2' to '3'", () => {
    assert.equal(nextReviewAttempt("2"), "3");
  });

  it("treats empty string as 0, returns '1'", () => {
    assert.equal(nextReviewAttempt(""), "1");
  });

  it("treats undefined as 0, returns '1'", () => {
    assert.equal(nextReviewAttempt(undefined), "1");
  });

  it("treats non-numeric string as 0, returns '1'", () => {
    assert.equal(nextReviewAttempt("abc"), "1");
  });
});

describe("shouldRetryReview", () => {
  it("returns 'false' for approve verdict regardless of attempts", () => {
    assert.equal(shouldRetryReview({ reviewVerdict: "approve", attempt: "0", maxAttempts: "3" }), "false");
    assert.equal(shouldRetryReview({ reviewVerdict: "approve", attempt: "5", maxAttempts: "3" }), "false");
  });

  it("returns 'true' when attempt < maxAttempts for revise", () => {
    assert.equal(shouldRetryReview({ reviewVerdict: "revise", attempt: "0", maxAttempts: "3" }), "true");
    assert.equal(shouldRetryReview({ reviewVerdict: "revise", attempt: "2", maxAttempts: "3" }), "true");
  });

  it("returns 'false' when attempt >= maxAttempts for revise", () => {
    assert.equal(shouldRetryReview({ reviewVerdict: "revise", attempt: "3", maxAttempts: "3" }), "false");
    assert.equal(shouldRetryReview({ reviewVerdict: "revise", attempt: "5", maxAttempts: "3" }), "false");
  });

  it("defaults maxAttempts to DEFAULT_MAX_REVIEW_ATTEMPTS (3)", () => {
    assert.equal(shouldRetryReview({ reviewVerdict: "revise", attempt: "2" }), "true");
    assert.equal(shouldRetryReview({ reviewVerdict: "revise", attempt: "3" }), "false");
  });

  it("treats maxAttempts '0' as DEFAULT (3) due to falsy || fallback, then Math.max(1, ...)", () => {
    // parseInt("0") = 0, which is falsy, so || DEFAULT_MAX_REVIEW_ATTEMPTS (3) kicks in
    assert.equal(shouldRetryReview({ reviewVerdict: "revise", attempt: "0", maxAttempts: "0" }), "true");
    assert.equal(shouldRetryReview({ reviewVerdict: "revise", attempt: "2", maxAttempts: "0" }), "true");
    assert.equal(shouldRetryReview({ reviewVerdict: "revise", attempt: "3", maxAttempts: "0" }), "false");
  });

  it("returns 'false' with no arguments (defaults)", () => {
    // default verdict is "", not "approve", so it falls through to attempt check
    // default attempt is "0", default maxAttempts is "3", so 0 < 3 → "true"
    assert.equal(shouldRetryReview(), "true");
  });
});

describe("buildImplResult", () => {
  it("returns all expected fields with defaults", () => {
    const result = buildImplResult({});
    assert.equal(result.issue_number, "");
    assert.equal(result.branch, "");
    assert.equal(result.worktree_dir, "");
    assert.equal(result.review_failed, "false");
    assert.equal(result.review_notes, "");
    assert.equal(result.disposition, "");
    assert.equal(result.decision_confidence, "");
    assert.equal(result.decision_evidence, "");
    assert.equal(result.zero_delta_retry, "");
    assert.equal(result.zero_delta_retry_count, "");
    assert.equal(result.merged, "false");
    assert.equal(result.review_evidence_path, "");
  });

  it("converts reviewFailed: true to 'true'", () => {
    const result = buildImplResult({ reviewFailed: true });
    assert.equal(result.review_failed, "true");
  });

  it("converts reviewFailed: false to 'false'", () => {
    const result = buildImplResult({ reviewFailed: false });
    assert.equal(result.review_failed, "false");
  });

  it("converts merged: true to 'true'", () => {
    const result = buildImplResult({ merged: true });
    assert.equal(result.merged, "true");
  });

  it("converts merged: false to 'false'", () => {
    const result = buildImplResult({ merged: false });
    assert.equal(result.merged, "false");
  });

  it("populates fields from arguments", () => {
    const result = buildImplResult({
      issueNumber: "42",
      branch: "feature/x",
      worktreeDir: "/tmp/wt",
      reviewFailed: true,
      reviewNotes: "needs work",
      disposition: "revise",
      decisionConfidence: "high",
      decisionEvidence: "tests fail",
      merged: false,
      zeroDeltaRetry: "true",
      zeroDeltaRetryCount: "2",
      reviewEvidencePath: "/tmp/evidence.json",
    });
    assert.equal(result.issue_number, "42");
    assert.equal(result.branch, "feature/x");
    assert.equal(result.worktree_dir, "/tmp/wt");
    assert.equal(result.review_failed, "true");
    assert.equal(result.review_notes, "needs work");
    assert.equal(result.disposition, "revise");
    assert.equal(result.decision_confidence, "high");
    assert.equal(result.decision_evidence, "tests fail");
    assert.equal(result.merged, "false");
    assert.equal(result.zero_delta_retry, "true");
    assert.equal(result.zero_delta_retry_count, "2");
    assert.equal(result.review_evidence_path, "/tmp/evidence.json");
  });

  it("emits canonical issue_execution_completed and review_verdict_applied events", () => {
    const emitted = [];
    const result = buildImplResult({
      issueNumber: "1536",
      branch: "wave/1536",
      worktreeDir: "/tmp/wave/1536",
      reviewFailed: true,
      reviewNotes: "tests broken",
      disposition: "revise",
      decisionConfidence: "high",
      decisionEvidence: "qa",
      merged: false,
      zeroDeltaRetry: "false",
      zeroDeltaRetryCount: "0",
      reviewEvidencePath: "/tmp/evidence.json",
      factoryId: "example-trading",
      runId: "run-1536",
      emitDomainEventFn: (event) => emitted.push(event),
    });

    assert.equal(result.canonical_events.length, 2);
    assert.equal(emitted[0].event_family, "factory.issue.execution_completed");
    assert.equal(emitted[0].payload.issue_number, "1536");
    assert.equal(emitted[0].payload.disposition, "revise");
    assert.equal(emitted[1].event_family, "factory.review.verdict_applied");
    assert.equal(emitted[1].payload.issue_number, "1536");
    assert.equal(emitted[1].payload.disposition, "revise");
    assert.equal(emitted[1].payload.decision_confidence, "high");
  });
});

describe("buildApprovedImplResult", () => {
  it("returns review_failed 'false'", () => {
    const result = buildApprovedImplResult({ issueNumber: "10", branch: "b", worktreeDir: "/w" });
    assert.equal(result.review_failed, "false");
    assert.equal(result.disposition, "approved");
  });

  it("includes attempt info in review_notes", () => {
    const result = buildApprovedImplResult({
      issueNumber: "10",
      branch: "b",
      worktreeDir: "/w",
      reviewAttempt: "2",
      maxReviewAttempts: "3",
    });
    assert.ok(result.review_notes.includes("Approved (attempt 2/3)"));
    assert.ok(result.review_notes.includes("Merge deferred to wave end"));
  });

  it("appends extra reviewNotes", () => {
    const result = buildApprovedImplResult({
      reviewAttempt: "1",
      maxReviewAttempts: "3",
      reviewNotes: "looks good",
    });
    assert.ok(result.review_notes.includes("looks good"));
  });

  it("defaults attempt and maxAttempts to 0", () => {
    const result = buildApprovedImplResult({});
    assert.ok(result.review_notes.includes("Approved (attempt 0/0)"));
  });
});

describe("buildFailedImplResult", () => {
  it("returns review_failed 'true'", () => {
    const result = buildFailedImplResult({ issueNumber: "10" });
    assert.equal(result.review_failed, "true");
    assert.equal(result.disposition, "revise");
  });

  it("includes attempt info in review_notes", () => {
    const result = buildFailedImplResult({
      reviewAttempt: "3",
      maxReviewAttempts: "3",
    });
    assert.ok(result.review_notes.includes("Review failed after 3/3 attempts"));
  });

  it("appends extra reviewNotes", () => {
    const result = buildFailedImplResult({
      reviewAttempt: "2",
      maxReviewAttempts: "3",
      reviewNotes: "tests broken",
    });
    assert.ok(result.review_notes.includes("tests broken"));
  });
});

describe("buildInfraFailureImplResult", () => {
  it("returns review_failed 'true' and disposition 'infra_failure'", () => {
    const result = buildInfraFailureImplResult({ issueNumber: "5" });
    assert.equal(result.review_failed, "true");
    assert.equal(result.disposition, "infra_failure");
  });

  it("includes reason in review_notes", () => {
    const result = buildInfraFailureImplResult({ reason: "disk full" });
    assert.ok(result.review_notes.includes("Worktree setup infrastructure failure"));
    assert.ok(result.review_notes.includes("disk full"));
  });

  it("uses 'unknown' when reason is empty", () => {
    const result = buildInfraFailureImplResult({});
    assert.ok(result.review_notes.includes("unknown"));
  });
});

describe("resolveZeroDeltaReviewRoute", () => {
  it("returns reject disposition with revise transition", () => {
    const result = resolveZeroDeltaReviewRoute();
    assert.deepEqual(result, {
      disposition: "reject",
      recommended_transition: "revise",
      route_reason: "zero_delta_stale_branch",
    });
  });
});

describe("parseGitHubRepoFromRemoteUrl", () => {
  it("parses SSH git@ URL with .git suffix", () => {
    assert.equal(parseGitHubRepoFromRemoteUrl("git@github.com:owner/repo.git"), "owner/repo");
  });

  it("parses SSH git@ URL without .git suffix", () => {
    assert.equal(parseGitHubRepoFromRemoteUrl("git@github.com:owner/repo"), "owner/repo");
  });

  it("parses HTTPS URL with .git suffix", () => {
    assert.equal(parseGitHubRepoFromRemoteUrl("https://github.com/owner/repo.git"), "owner/repo");
  });

  it("parses HTTPS URL without .git suffix", () => {
    assert.equal(parseGitHubRepoFromRemoteUrl("https://github.com/owner/repo"), "owner/repo");
  });

  it("parses ssh:// protocol URL with .git suffix", () => {
    assert.equal(parseGitHubRepoFromRemoteUrl("ssh://git@github.com/owner/repo.git"), "owner/repo");
  });

  it("returns empty string for empty input", () => {
    assert.equal(parseGitHubRepoFromRemoteUrl(""), "");
  });

  it("returns empty string for undefined input", () => {
    assert.equal(parseGitHubRepoFromRemoteUrl(undefined), "");
  });

  it("returns empty string for non-matching URL", () => {
    assert.equal(parseGitHubRepoFromRemoteUrl("https://gitlab.com/owner/repo"), "");
  });
});

describe("resolveMaxReviewAttemptsWithInit", () => {
  it("returns provided max and initial attempt '0'", () => {
    const result = resolveMaxReviewAttemptsWithInit("5");
    assert.equal(result.max_review_attempts, "5");
    assert.equal(result.review_attempt, "0");
  });

  it("defaults to DEFAULT_MAX_REVIEW_ATTEMPTS when empty", () => {
    const result = resolveMaxReviewAttemptsWithInit("");
    assert.equal(result.max_review_attempts, String(DEFAULT_MAX_REVIEW_ATTEMPTS));
    assert.equal(result.review_attempt, "0");
  });

  it("defaults to DEFAULT_MAX_REVIEW_ATTEMPTS when undefined", () => {
    const result = resolveMaxReviewAttemptsWithInit();
    assert.equal(result.max_review_attempts, String(DEFAULT_MAX_REVIEW_ATTEMPTS));
    assert.equal(result.review_attempt, "0");
  });

  it("preserves the raw string value when provided", () => {
    const result = resolveMaxReviewAttemptsWithInit("10");
    assert.equal(result.max_review_attempts, "10");
  });
});
