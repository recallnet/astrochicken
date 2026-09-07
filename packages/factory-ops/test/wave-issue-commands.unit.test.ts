import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync, mkdtempSync, chmodSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { extractIssueItem } from "../src/commands/wave-issue-extract.ts";
import { initWaveIssueWorktree } from "../src/commands/wave-issue-init.ts";
import {
  resolveExecutionMode,
  estimateWaveIssueComplexity,
  decideExistingReuse,
  decideExistingReuseWithNotes,
  resolveMaxReviewAttemptsWithInit,
  isSharedWaveBranch,
  initReviewAttempt,
  nextReviewAttempt,
  shouldRetryReview,
  setRetryDecision,
  ZERO_DELTA_RETRY_LIMIT,
  fallbackReviewDecision,
  fallbackReviewDecisionFromJson,
  resolveZeroDeltaReviewRoute,
  buildImplResult,
  buildWaveIssueImplResult,
  buildApprovedImplResult,
  buildFailedImplResult,
  writeReviewEvidence,
  validateZeroDeltaReviewEvidence,
  buildReviewEvidenceScopeDiagnostics,
  evaluateDoneElsewherePrecheck,
  evaluateDoneElsewherePrecheckWithState,
  recordDoneElsewherePrecheck,
  resolveLatestReviewEvidencePath,
  snapshotBranchHead,
  revertToSnapshot,
  parseGitHubRepoFromRemoteUrl,
  resolveIssueMetadataRepo,
  readZeroDeltaState,
  recordZeroDeltaRetry,
  rerunReviewEvidenceQa,
  inspectBranchChanges,
} from "../src/commands/wave-issue-state.ts";
import { buildInfraFailureImplResult } from "../src/commands/wave-issue-review.ts";
import { readZeroDeltaStatus } from "../src/commands/wave-issue-zero-delta-status.ts";
import { emitStaleBranchSupervisorGuidance } from "../src/commands/wave-issue-stale-branch-guidance.ts";
import { resolveReviewRoute } from "../src/commands/wave-review-route.ts";
function sh(args, cwd) {
  const p = spawnSync(args[0], args.slice(1), { cwd, encoding: "utf8" });
  assert.equal(p.status, 0, p.stderr || p.stdout);
  return String(p.stdout || "").trim();
}
test("extractIssueItem maps issue fields", () => {
  const out = extractIssueItem('{"issue_number":123,"issue_title":"X"}');
  assert.equal(out.issue_number, "123");
  assert.equal(out.issue_title, "X");
});
test("resolveExecutionMode defaults full", () => {
  assert.equal(resolveExecutionMode(""), "full");
  assert.equal(resolveExecutionMode("SMOKE"), "smoke");
});

test("inspectBranchChanges includes latest_issue_change_summary binding", () => {
  const repo = mkdtempSync(join(tmpdir(), "wave-issue-inspect-"));
  sh(["git", "init", "-b", "main"], repo);
  sh(["git", "config", "user.email", "taxi@example.com"], repo);
  sh(["git", "config", "user.name", "Hatch"], repo);
  writeFileSync(join(repo, "base.txt"), "base\n", "utf8");
  sh(["git", "add", "base.txt"], repo);
  sh(["git", "commit", "-m", "base"], repo);
  sh(["git", "checkout", "-b", "wave/123"], repo);
  writeFileSync(join(repo, "feature.txt"), "feature\n", "utf8");
  sh(["git", "add", "feature.txt"], repo);
  sh(["git", "commit", "-m", "feat: add feature"], repo);

  const out = inspectBranchChanges({ worktreeDir: repo });
  assert.equal(out.commits_ahead, "1");
  assert.deepEqual(out.changed_files, ["feature.txt"]);
  assert.equal(
    out.latest_issue_change_summary,
    "commits_ahead=1; changed_files=[feature.txt]",
  );
});

test("estimateWaveIssueComplexity returns deterministic fallback on hatch failure", () => {
  const out = estimateWaveIssueComplexity({ issueTitle: "Title", issueBody: "Body" });
  assert.ok(typeof out.complexity_class === "string");
  assert.ok(typeof out.complexity_reason === "string");
});
test("decideExistingReuse disables reuse for milestone branches", () => {
  assert.equal(decideExistingReuse({ branch: "milestone/goal-1-wave-1", existingCommits: "2" }), "false");
  assert.equal(decideExistingReuse({ branch: "wave/12", existingCommits: "2" }), "true");
});
test("buildImplResult returns deterministic shape", () => {
  const out = buildImplResult({
    issueNumber: 1,
    branch: "b",
    worktreeDir: "w",
    reviewFailed: true,
    reviewNotes: "n",
    disposition: "not_done",
    decisionConfidence: "medium",
    zeroDeltaRetry: "true",
    zeroDeltaRetryCount: "2",
    reviewEvidencePath: "review.json",
  });
  assert.equal(out.review_failed, "true");
  assert.equal(out.issue_number, "1");
  assert.equal(out.disposition, "not_done");
  assert.equal(out.decision_confidence, "medium");
  assert.equal(out.zero_delta_retry, "true");
  assert.equal(out.zero_delta_retry_count, "2");
  assert.equal(out.review_evidence_path, "review.json");
});
test("wave issue result builders produce deterministic approve/fail payloads", () => {
  const generic = buildWaveIssueImplResult({
    issueNumber: "9",
    branch: "wave/9",
    worktreeDir: "/tmp/wave/9",
    reviewFailed: "false",
    reviewNotes: "ok",
    reviewEvidencePath: "review.json",
  });
  assert.equal(generic.review_failed, "false");
  assert.equal(generic.review_notes, "ok");
  const approved = buildApprovedImplResult({
    issueNumber: "9",
    branch: "wave/9",
    worktreeDir: "/tmp/wave/9",
    reviewAttempt: "1",
    maxReviewAttempts: "3",
    reviewNotes: "looks good",
    reviewEvidencePath: "review.json",
  });
  assert.equal(approved.review_failed, "false");
  assert.match(approved.review_notes, /Approved \(attempt 1\/3\)/);
  const failed = buildFailedImplResult({
    issueNumber: "9",
    branch: "wave/9",
    worktreeDir: "/tmp/wave/9",
    reviewAttempt: "3",
    maxReviewAttempts: "3",
    reviewNotes: "still broken",
    reviewEvidencePath: "review.json",
  });
  assert.equal(failed.review_failed, "true");
  assert.match(failed.review_notes, /Review failed after 3\/3 attempts/);
});
test("review attempt helpers enforce bounded retry", () => {
  assert.equal(initReviewAttempt(), "0");
  assert.equal(nextReviewAttempt("0"), "1");
  assert.equal(shouldRetryReview({ reviewVerdict: "revise", attempt: "1", maxAttempts: "3" }), "true");
  assert.equal(shouldRetryReview({ reviewVerdict: "revise", attempt: "3", maxAttempts: "3" }), "false");
  assert.equal(shouldRetryReview({ reviewVerdict: "approve", attempt: "1", maxAttempts: "3" }), "false");
});
test("setRetryDecision preserves attempt budget for zero-delta revise loops", () => {
  const wd = mkdtempSync(join(tmpdir(), "wave-issue-retry-decision-zero-delta-"));
  const out = setRetryDecision({
    reviewVerdict: "revise",
    attempt: "2",
    maxAttempts: "3",
    zeroDelta: "true",
    zeroDeltaRetryCount: "0",
    worktreeDir: wd,
    issueNumber: "551",
    issueCommits: "0",
  });
  assert.equal(out.retry_review, "true");
  assert.equal(out.review_attempt, "2");
  assert.equal(out.zero_delta_retry, "true");
  assert.equal(out.zero_delta_retry_count, "1");
  const saved = readZeroDeltaState({ worktreeDir: wd, issueNumber: "551" });
  assert.equal(saved.zero_delta_retry, "true");
  assert.equal(saved.zero_delta_retry_count, "1");
});
test("setRetryDecision stops zero-delta loop at retry cap and preserves review_attempt", () => {
  const wd = mkdtempSync(join(tmpdir(), "wave-issue-retry-decision-zero-delta-cap-"));
  const issueNumber = "553";
  for (let index = 0; index < ZERO_DELTA_RETRY_LIMIT; index += 1) {
    const out = setRetryDecision({
      reviewVerdict: "revise",
      attempt: "2",
      maxAttempts: "3",
      zeroDelta: "true",
      zeroDeltaRetryCount: String(index),
      worktreeDir: wd,
      issueNumber,
      issueCommits: "0",
    });
    if (index < ZERO_DELTA_RETRY_LIMIT - 1) {
      assert.equal(out.retry_review, "true");
      assert.equal(out.zero_delta_retry_count, String(index + 1));
    } else {
      assert.equal(out.retry_review, "false");
      assert.equal(out.zero_delta_retry_count, String(ZERO_DELTA_RETRY_LIMIT));
    }
    assert.equal(out.review_attempt, "2");
  }
});
test("setRetryDecision consumes normal attempt budget when issue delta exists", () => {
  const wd = mkdtempSync(join(tmpdir(), "wave-issue-retry-decision-normal-"));
  const out = setRetryDecision({
    reviewVerdict: "revise",
    attempt: "3",
    maxAttempts: "3",
    zeroDelta: "false",
    zeroDeltaRetryCount: String(ZERO_DELTA_RETRY_LIMIT),
    worktreeDir: wd,
    issueNumber: "552",
    issueCommits: "1",
  });
  assert.equal(out.retry_review, "false");
  assert.equal(out.review_attempt, "3");
  assert.equal(out.zero_delta_retry, "false");
  assert.equal(out.zero_delta_retry_count, "0");
});
test("fallbackReviewDecision preserves explicit reviewer verdict", () => {
  const out = fallbackReviewDecision({
    reviewVerdict: "revise",
    reviewReasonCodesRaw: '["SCOPE_MISMATCH"]',
    reviewNotes: "needs changes",
  });
  assert.equal(out.review_verdict, "revise");
  assert.deepEqual(out.review_reason_codes, ["SCOPE_MISMATCH"]);
  assert.equal(out.review_notes, "needs changes");
});
test("fallbackReviewDecision approves deterministically when evidence exists and reviewer missing", () => {
  const wd = mkdtempSync(join(tmpdir(), "wave-issue-fallback-review-"));
  const p = join(wd, "review.json");
  writeFileSync(p, JSON.stringify({ ok: true }), "utf8");
  const out = fallbackReviewDecision({ reviewEvidencePath: p, reviewError: "llm_unavailable" });
  assert.equal(out.review_verdict, "approve");
  assert.deepEqual(out.review_reason_codes, ["APPROVED"]);
});
test("fallbackReviewDecisionFromJson preserves reviewer JSON payload", () => {
  const out = fallbackReviewDecisionFromJson({
    reviewResultRaw: JSON.stringify({
      review_verdict: "revise",
      review_reason_codes: ["SCOPE_MISMATCH"],
      review_notes: "needs narrowing",
    }),
  });
  assert.equal(out.review_verdict, "revise");
  assert.deepEqual(out.review_reason_codes, ["SCOPE_MISMATCH"]);
  assert.equal(out.review_notes, "needs narrowing");
});
test("resolveZeroDeltaReviewRoute forces revise with deterministic reason", () => {
  assert.deepEqual(resolveZeroDeltaReviewRoute(), {
    review_verdict: "revise",
    review_route_reason: "zero_delta_stale_branch",
  });
});
test("resolveReviewRoute preserves explicit approval and revise payloads", () => {
  assert.deepEqual(resolveReviewRoute({ reviewVerdict: "approve", reviewContextGatePass: "true" }), {
    review_verdict: "approve",
    review_route_reason: "approved",
  });
  assert.deepEqual(resolveReviewRoute({ reviewVerdict: "revise", reviewContextGatePass: "true" }), {
    review_verdict: "revise",
    review_route_reason: "non_approve_verdict",
  });
});
test("resolveReviewRoute forces revise on gate failure, policy override, and invalid verdict payloads", () => {
  const tmp = mkdtempSync(join(tmpdir(), "review-route-policy-"));
  const contextPath = join(tmp, "review-context.json");
  writeFileSync(contextPath, JSON.stringify({
    effective_policy: {
      values: {
        review: {
          route_override: "revise",
        },
      },
    },
  }, null, 2));
  assert.deepEqual(resolveReviewRoute({
    reviewVerdict: "approve",
    reviewContextGatePass: "false",
    reviewContextGateCode: "review_context_missing_required_fields",
  }), {
    review_verdict: "revise",
    review_route_reason: "review_context_missing_required_fields",
  });
  assert.deepEqual(resolveReviewRoute({
    reviewVerdict: "approve",
    reviewContextGatePass: "true",
    reviewContextPath: contextPath,
  }), {
    review_verdict: "revise",
    review_route_reason: "policy_override_revise",
  });
  assert.deepEqual(resolveReviewRoute({ reviewVerdict: "ship", reviewContextGatePass: "true" }), {
    review_verdict: "revise",
    review_route_reason: "invalid_review_verdict",
  });
  assert.deepEqual(resolveReviewRoute({ reviewVerdict: "", reviewContextGatePass: "true" }), {
    review_verdict: "revise",
    review_route_reason: "invalid_review_verdict",
  });
});

test("writeReviewEvidence persists resolved QA command fields for reruns", () => {
  const wd = join(tmpdir(), `wave-issue-test-${Date.now()}`);
  mkdirSync(wd, { recursive: true });
  writeFileSync(join(wd, "README.md"), "x\n");
  const out = writeReviewEvidence({
    worktreeDir: wd,
    repo: wd,
    issueNumber: "42",
    branch: "wave/42",
    issueTitle: "X",
    issueBody: "Y",
    reviewQaCommand: "",
    integrationCommand: "true",
  });
  const evidence = JSON.parse(readFileSync(out.review_evidence_path, "utf8"));
  assert.equal(evidence.review_qa_command, "true");
  assert.equal(evidence.integration_command, "true");
  assert.equal(evidence.qa.command, "true");
  assert.equal(evidence.qa.status, "pass");
});
test("writeReviewEvidence stores evidence in repo dir, not worktree dir, when they differ", () => {
  const worktree = join(tmpdir(), `wave-issue-wt-${Date.now()}`);
  const repoDir = join(tmpdir(), `wave-issue-repo-${Date.now()}`);
  mkdirSync(worktree, { recursive: true });
  mkdirSync(repoDir, { recursive: true });
  writeFileSync(join(worktree, "README.md"), "x\n");
  const out = writeReviewEvidence({
    worktreeDir: worktree,
    repo: repoDir,
    issueNumber: "500",
    branch: "wave/500",
    issueTitle: "Test",
    issueBody: "Body",
    reviewQaCommand: "true",
    integrationCommand: "true",
  });
  assert.equal(out.review_evidence_valid, "true");
  // Evidence must be in the repo dir (factory repo, gitignored), not the worktree
  const expectedPath = join(repoDir, ".hatch", "review", "500.json");
  const wrongPath = join(worktree, ".hatch", "review", "500.json");
  assert.equal(out.review_evidence_path, expectedPath, "evidence path should use repo dir");
  assert.ok(existsSync(expectedPath), "evidence file must exist in repo dir");
  assert.ok(!existsSync(wrongPath), "evidence file must NOT exist in worktree dir");
});
test("writeReviewEvidence fails deterministically when QA command missing", () => {
  const wd = join(tmpdir(), `wave-issue-test-${Date.now()}`);
  mkdirSync(wd, { recursive: true });
  writeFileSync(join(wd, "README.md"), "x\n");
  const out = writeReviewEvidence({
    worktreeDir: wd,
    repo: wd,
    issueNumber: "42",
    branch: "wave/42",
    issueTitle: "X",
    issueBody: "Y",
    reviewQaCommand: "",
    integrationCommand: "",
  });
  const evidence = JSON.parse(readFileSync(out.review_evidence_path, "utf8"));
  assert.equal(evidence.review_qa_command, "");
  assert.equal(evidence.integration_command, "");
  assert.equal(evidence.qa.status, "fail");
  assert.match(evidence.qa.stderr, /QA command missing/);
});
test("evaluateDoneElsewherePrecheck requires zero delta + passing qa", () => {
  const wd = join(tmpdir(), `wave-issue-precheck-${Date.now()}`);
  mkdirSync(wd, { recursive: true });
  const p = join(wd, "review.json");
  writeFileSync(p, JSON.stringify({
    commits_ahead: "0",
    changed_files: [],
    dirty: false,
    qa: { status: "pass", command: "npm test" },
  }, null, 2));
  const ok = evaluateDoneElsewherePrecheck({ reviewEvidencePath: p });
  assert.equal(ok.precheck_done_elsewhere, "true");
  assert.equal(ok.precheck_reason, "branch_scoped_zero_delta_with_passing_qa");
  writeFileSync(p, JSON.stringify({
    commits_ahead: "0",
    changed_files: [],
    dirty: false,
    qa: { status: "fail", command: "npm test" },
  }, null, 2));
  const bad = evaluateDoneElsewherePrecheck({ reviewEvidencePath: p });
  assert.equal(bad.precheck_done_elsewhere, "false");
  assert.equal(bad.precheck_reason, "branch_scoped_qa_not_passing");
});
test("evaluateDoneElsewherePrecheck prefers issue-scoped delta on shared wave branches", () => {
  const wd = join(tmpdir(), `wave-issue-precheck-issue-scope-${Date.now()}`);
  mkdirSync(wd, { recursive: true });
  const p = join(wd, "review.json");
  writeFileSync(p, JSON.stringify({
    commits_ahead: "4",
    changed_files: ["packages/factory-ops/src/cli.ts"],
    issue_commits: "0",
    issue_changed_files: [],
    dirty: false,
    qa: { status: "pass", command: "npm test" },
  }, null, 2));
  const scoped = evaluateDoneElsewherePrecheck({ reviewEvidencePath: p });
  assert.equal(scoped.precheck_done_elsewhere, "true");
  assert.equal(scoped.precheck_reason, "issue_scoped_zero_delta_with_passing_qa");
});
test("resolveLatestReviewEvidencePath discovers default worktree evidence path", () => {
  const wd = join(tmpdir(), `wave-issue-precheck-discovery-${Date.now()}`);
  const reviewDir = join(wd, ".hatch", "review");
  mkdirSync(reviewDir, { recursive: true });
  const p = join(reviewDir, "1172.json");
  writeFileSync(p, JSON.stringify({ qa: { status: "pass", command: "npm test" } }, null, 2));
  const out = resolveLatestReviewEvidencePath({ worktreeDir: wd, issueNumber: "1172" });
  assert.equal(out.review_evidence_path, p);
  assert.equal(out.review_evidence_present, "true");
  assert.equal(out.review_evidence_source, "worktree_default");
});
test("evaluateDoneElsewherePrecheckWithState records short-circuit decision in zero-delta state", () => {
  const wd = join(tmpdir(), `wave-issue-precheck-state-${Date.now()}`);
  const reviewDir = join(wd, ".hatch", "review");
  mkdirSync(reviewDir, { recursive: true });
  const p = join(reviewDir, "1172.json");
  writeFileSync(p, JSON.stringify({
    commits_ahead: "0",
    changed_files: [],
    issue_commits: "0",
    issue_changed_files: [],
    dirty: false,
    qa: { status: "pass", command: "npm run test:guard-gates" },
    judge_context_valid: "false",
    judge_context_error: "judge_context_scenarios_missing",
  }, null, 2));
  const out = evaluateDoneElsewherePrecheckWithState({ worktreeDir: wd, issueNumber: "1172" });
  assert.equal(out.precheck_done_elsewhere, "true");
  assert.equal(out.precheck_reason, "issue_scoped_zero_delta_with_passing_qa");
  assert.equal(out.review_evidence_path, p);
  const state = readZeroDeltaState({ worktreeDir: wd, issueNumber: "1172" });
  assert.equal(state.precheck_done_elsewhere, "true");
  assert.equal(state.precheck_reason, "issue_scoped_zero_delta_with_passing_qa");
  assert.equal(state.review_evidence_path, p);
  assert.equal(state.zero_delta_retry, "false");
  assert.equal(state.zero_delta_retry_count, "0");
});
test("evaluateDoneElsewherePrecheckWithState stays strict when zero-delta evidence lacks QA command", () => {
  const wd = join(tmpdir(), `wave-issue-precheck-strict-${Date.now()}`);
  const reviewDir = join(wd, ".hatch", "review");
  mkdirSync(reviewDir, { recursive: true });
  const p = join(reviewDir, "1172.json");
  writeFileSync(p, JSON.stringify({
    commits_ahead: "1",
    changed_files: ["README.md"],
    issue_commits: "0",
    issue_changed_files: [],
    dirty: false,
    qa: { status: "pass", command: "" },
    judge_context_valid: "false",
    judge_context_error: "judge_context_path_missing",
  }, null, 2));
  const out = evaluateDoneElsewherePrecheckWithState({ worktreeDir: wd, issueNumber: "1172" });
  assert.equal(out.precheck_done_elsewhere, "false");
  assert.equal(out.precheck_reason, "issue_scoped_qa_not_passing");
  const state = readZeroDeltaState({ worktreeDir: wd, issueNumber: "1172" });
  assert.equal(state.precheck_done_elsewhere, "false");
  assert.equal(state.precheck_reason, "issue_scoped_qa_not_passing");
  assert.equal(state.review_evidence_path, p);
});
test("recordDoneElsewherePrecheck preserves retry counters while persisting precheck metadata", () => {
  const wd = join(tmpdir(), `wave-issue-precheck-record-${Date.now()}`);
  const issue = "1172";
  const seeded = recordZeroDeltaRetry({ worktreeDir: wd, issueNumber: issue, zeroDeltaTriggered: "true", commitsAhead: "0" });
  assert.equal(seeded.zero_delta_retry, "true");
  assert.equal(seeded.zero_delta_retry_count, "1");
  const out = recordDoneElsewherePrecheck({
    worktreeDir: wd,
    issueNumber: issue,
    precheckDoneElsewhere: "true",
    precheckReason: "issue_scoped_zero_delta_with_passing_qa",
    reviewEvidencePath: join(wd, ".hatch", "review", `${issue}.json`),
  });
  assert.equal(out.precheck_done_elsewhere, "true");
  assert.equal(out.precheck_reason, "issue_scoped_zero_delta_with_passing_qa");
  const state = readZeroDeltaState({ worktreeDir: wd, issueNumber: issue });
  assert.equal(state.zero_delta_retry, "true");
  assert.equal(state.zero_delta_retry_count, "1");
  assert.equal(state.precheck_done_elsewhere, "true");
  assert.equal(state.precheck_reason, "issue_scoped_zero_delta_with_passing_qa");
});
test("emitStaleBranchSupervisorGuidance emits deterministic stale-branch guidance with missing judge context", () => {
  const captured = [];
  const originalWrite = process.stderr.write;
  process.stderr.write = (chunk, ...args) => {
    captured.push(String(chunk));
    return originalWrite.call(process.stderr, chunk, ...args);
  };
  const wd = join(tmpdir(), `wave-issue-stale-branch-${Date.now()}`);
  mkdirSync(wd, { recursive: true });
  const p = join(wd, "review.json");
  writeFileSync(p, JSON.stringify({
    issue_number: "1175",
    branch: "wave/goal-1175-wave-1",
    commits_ahead: "0",
    issue_commits: "2",
    issue_changed_files: [],
    judge_context_valid: "false",
    judge_context_error: "judge_context_path_missing",
    qa: { status: "pass", command: "npm run test:wave-claim-gates" },
  }, null, 2));
  try {
    const out = emitStaleBranchSupervisorGuidance({
      repo: "recallnet/astrochicken",
      issueNumber: "1175",
      branch: "wave/goal-1175-wave-1",
      reviewEvidencePath: p,
      runId: "run-1175",
      pipeline: "wave_issue_execute",
    });
    assert.equal(out.stale_branch_detected, "true");
    assert.equal(out.classification, "stale_branch");
    assert.equal(out.emitted, "true");
    assert.match(out.summary, /Issue #1175/);
    assert.match(out.summary, /zero-delta review evidence/i);
    assert.match(out.body, /commits_ahead=0 and issue_changed_files=\[\]/);
    assert.match(out.body, /Do not repeat the give-up loop blindly/);
    assert.match(out.body, /reopen branch/);
    assert.match(out.body, /provide concrete commit\/file evidence/);
    assert.match(out.body, /implemented elsewhere \/ rescope/);
    assert.match(out.body, /judge_context_path_missing/);
  } finally {
    process.stderr.write = originalWrite;
  }
  const logged = captured.join("");
  const events = [...logged.matchAll(/OTEL_EVENT\s+(\{[\s\S]*?\})(?=\n|$)/g)].map((m) => JSON.parse(m[1]));
  assert.equal(events.length >= 1, true, "expected supervisor artifact OTEL event");
  const artifactEvt = events.find((evt) => evt?.event_name === "factory.supervisor.telemetry");
  assert.equal(artifactEvt?.attributes?.classification, "stale_branch");
  assert.match(String(artifactEvt?.body?.evidence || ""), /Issue #1175/);
  assert.match(String(artifactEvt?.body?.evidence || ""), /wave\/goal-1175-wave-1/);
});
test("emitStaleBranchSupervisorGuidance is quiet when review evidence still has delta", () => {
  const captured = [];
  const originalWrite = process.stderr.write;
  process.stderr.write = (chunk, ...args) => {
    captured.push(String(chunk));
    return originalWrite.call(process.stderr, chunk, ...args);
  };
  const wd = join(tmpdir(), `wave-issue-stale-branch-has-delta-${Date.now()}`);
  mkdirSync(wd, { recursive: true });
  const p = join(wd, "review.json");
  writeFileSync(p, JSON.stringify({
    issue_number: "1175",
    branch: "wave/goal-1175-wave-1",
    commits_ahead: "1",
    issue_commits: "1",
    issue_changed_files: ["packages/factory-ops/src/commands/wave-issue-state.ts"],
  }, null, 2));
  try {
    const out = emitStaleBranchSupervisorGuidance({
      repo: "recallnet/astrochicken",
      issueNumber: "1175",
      branch: "wave/goal-1175-wave-1",
      reviewEvidencePath: p,
    });
    assert.equal(out.stale_branch_detected, "false");
    assert.equal(out.classification, "has_delta");
    assert.equal(out.emitted, "false");
  } finally {
    process.stderr.write = originalWrite;
  }
  assert.equal(captured.join("").includes("factory.supervisor.telemetry"), false);
});
test("emitStaleBranchSupervisorGuidance rejects malformed evidence instead of defaulting missing fields to zero", () => {
  const captured = [];
  const originalWrite = process.stderr.write;
  process.stderr.write = (chunk, ...args) => {
    captured.push(String(chunk));
    return originalWrite.call(process.stderr, chunk, ...args);
  };
  const wd = join(tmpdir(), `wave-issue-stale-branch-malformed-${Date.now()}`);
  mkdirSync(wd, { recursive: true });
  const p = join(wd, "review.json");
  writeFileSync(p, JSON.stringify({
    issue_number: "1175",
    branch: "wave/goal-1175-wave-1",
    qa: { status: "pass", command: "npm run test:wave-claim-gates" },
  }, null, 2));
  try {
    const out = emitStaleBranchSupervisorGuidance({
      repo: "recallnet/astrochicken",
      issueNumber: "1175",
      branch: "wave/goal-1175-wave-1",
      reviewEvidencePath: p,
    });
    assert.equal(out.stale_branch_detected, "false");
    assert.equal(out.classification, "review_evidence_error");
    assert.equal(out.error, "review_evidence_missing_required_fields");
    assert.equal(out.emitted, "false");
  } finally {
    process.stderr.write = originalWrite;
  }
  assert.equal(captured.join("").includes("factory.supervisor.telemetry"), false);
});
// ── zero-delta retry tracking ───────────────────────────────────
test("recordZeroDeltaRetry increments on zero-delta and resets after commits", () => {
  const wd = mkdtempSync(join(tmpdir(), "wave-issue-zero-delta-"));
  const issue = "123";
  const initial = readZeroDeltaState({ worktreeDir: wd, issueNumber: issue });
  assert.equal(initial.zero_delta_retry, "false");
  assert.equal(initial.zero_delta_retry_count, "0");
  const first = recordZeroDeltaRetry({ worktreeDir: wd, issueNumber: issue, zeroDeltaTriggered: "true", commitsAhead: "0" });
  assert.equal(first.zero_delta_retry, "true");
  assert.equal(first.zero_delta_retry_count, "1");
  const second = recordZeroDeltaRetry({ worktreeDir: wd, issueNumber: issue, zeroDeltaTriggered: "true", commitsAhead: "0" });
  assert.equal(second.zero_delta_retry, "true");
  assert.equal(second.zero_delta_retry_count, "2");
  const reset = recordZeroDeltaRetry({ worktreeDir: wd, issueNumber: issue, zeroDeltaTriggered: "false", commitsAhead: "2" });
  assert.equal(reset.zero_delta_retry, "false");
  assert.equal(reset.zero_delta_retry_count, "0");
  const after = readZeroDeltaState({ worktreeDir: wd, issueNumber: issue });
  assert.equal(after.zero_delta_retry, "false");
  assert.equal(after.zero_delta_retry_count, "0");
});
// ── zero-delta issue scope routing ─────────────────────────────
test("writeReviewEvidence increments zero-delta on issue-scoped zero delta despite branch commits", () => {
  const repoDir = mkdtempSync(join(tmpdir(), "wave-issue-zero-delta-scope-"));
  sh(["git", "init", "-b", "main"], repoDir);
  sh(["git", "config", "user.email", "taxi@example.com"], repoDir);
  sh(["git", "config", "user.name", "Hatch"], repoDir);
  writeFileSync(join(repoDir, "README.md"), "base\n", "utf8");
  sh(["git", "add", "README.md"], repoDir);
  sh(["git", "commit", "-m", "base"], repoDir);
  sh(["git", "checkout", "-b", "wave/77"], repoDir);
  writeFileSync(join(repoDir, "other.txt"), "branch change\n", "utf8");
  sh(["git", "add", "other.txt"], repoDir);
  sh(["git", "commit", "-m", "branch change"], repoDir);
  const snap = sh(["git", "rev-parse", "HEAD"], repoDir);
  const out = writeReviewEvidence({
    worktreeDir: repoDir,
    repo: repoDir,
    issueNumber: "77",
    branch: "wave/77",
    reviewQaCommand: "true",
    snapshotSha: snap,
  });
  const evidence = JSON.parse(readFileSync(out.review_evidence_path, "utf8"));
  assert.equal(evidence.commits_ahead, "1");
  assert.equal(evidence.issue_commits, "0");
  assert.equal(evidence.issue_changed_files_count, "0");
  assert.equal(evidence.issue_changed_files.length, 0);
  assert.equal(evidence.zero_delta_retry, "true");
  assert.equal(evidence.zero_delta_retry_count, "1");
  writeFileSync(join(repoDir, "issue.txt"), "issue change\n", "utf8");
  sh(["git", "add", "issue.txt"], repoDir);
  sh(["git", "commit", "-m", "issue change"], repoDir);
  const issueSnap = sh(["git", "rev-parse", "HEAD"], repoDir);
  const out2 = writeReviewEvidence({
    worktreeDir: repoDir,
    repo: repoDir,
    issueNumber: "77",
    branch: "wave/77",
    reviewQaCommand: "true",
    snapshotSha: issueSnap,
  });
  const evidence2 = JSON.parse(readFileSync(out2.review_evidence_path, "utf8"));
  assert.equal(evidence2.issue_commits, "0");
  assert.equal(evidence2.issue_changed_files_count, "0");
  assert.equal(evidence2.zero_delta_retry, "true");
  assert.equal(evidence2.zero_delta_retry_count, "2");
  writeFileSync(join(repoDir, "issue-2.txt"), "issue change 2\n", "utf8");
  sh(["git", "add", "issue-2.txt"], repoDir);
  sh(["git", "commit", "-m", "issue change 2"], repoDir);
  const out3 = writeReviewEvidence({
    worktreeDir: repoDir,
    repo: repoDir,
    issueNumber: "77",
    branch: "wave/77",
    reviewQaCommand: "true",
    snapshotSha: issueSnap,
  });
  const evidence3 = JSON.parse(readFileSync(out3.review_evidence_path, "utf8"));
  assert.equal(evidence3.issue_commits, "1");
  assert.equal(evidence3.issue_changed_files_count, "1");
  assert.equal(evidence3.zero_delta_retry, "false");
  assert.equal(evidence3.zero_delta_retry_count, "0");
});
test("writeReviewEvidence treats snapshot as branch boundary when snapshot equals head", () => {
  const repoDir = mkdtempSync(join(tmpdir(), "wave-issue-zero-delta-head-"));
  sh(["git", "init", "-b", "main"], repoDir);
  sh(["git", "config", "user.email", "taxi@example.com"], repoDir);
  sh(["git", "config", "user.name", "Hatch"], repoDir);
  writeFileSync(join(repoDir, "README.md"), "base\n", "utf8");
  sh(["git", "add", "README.md"], repoDir);
  sh(["git", "commit", "-m", "base"], repoDir);
  sh(["git", "checkout", "-b", "wave/88"], repoDir);
  const snap = sh(["git", "rev-parse", "HEAD"], repoDir);
  const out = writeReviewEvidence({
    worktreeDir: repoDir,
    repo: repoDir,
    issueNumber: "88",
    branch: "wave/88",
    reviewQaCommand: "true",
    snapshotSha: snap,
  });
  const evidence = JSON.parse(readFileSync(out.review_evidence_path, "utf8"));
  assert.equal(evidence.commits_ahead, "0");
  assert.equal(evidence.issue_commits, "0");
  assert.equal(evidence.issue_changed_files_count, "0");
  assert.deepEqual(evidence.issue_changed_files, []);
  assert.equal(evidence.zero_delta_retry, "true");
  assert.equal(evidence.zero_delta_retry_count, "1");
});
// ── isSharedWaveBranch ──────────────────────────────────────────
test("isSharedWaveBranch detects shared wave branches", () => {
  assert.equal(isSharedWaveBranch("wave/goal-333-wave-3"), true);
  assert.equal(isSharedWaveBranch("wave/goal-1-wave-1"), true);
  assert.equal(isSharedWaveBranch("wave/my-feature"), true);
});
test("isSharedWaveBranch returns false for per-issue branches", () => {
  assert.equal(isSharedWaveBranch("wave/123"), false);
  assert.equal(isSharedWaveBranch("wave/42"), false);
});
test("isSharedWaveBranch returns false for non-wave branches", () => {
  assert.equal(isSharedWaveBranch("milestone/goal-1-wave-1"), false);
  assert.equal(isSharedWaveBranch("main"), false);
  assert.equal(isSharedWaveBranch(""), false);
});
// ── decideExistingReuse with shared branches ────────────────────
test("decideExistingReuse returns false (not reset) for shared wave branches with unrelated commits", () => {
  // Shared wave branches should never be reset — they carry other issues' work
  // Without worktreeDir we can't check commits, so it falls through to "true"
  assert.equal(decideExistingReuse({ branch: "wave/goal-333-wave-3", existingCommits: "5" }), "true");
});
// ── snapshotBranchHead ──────────────────────────────────────────
test("snapshotBranchHead returns existing snapshot when provided (idempotent)", () => {
  const out = snapshotBranchHead({ worktreeDir: "/tmp", existingSnapshot: "abc123" });
  assert.equal(out.snapshot_sha, "abc123");
});
test("snapshotBranchHead returns empty-ish sha when no worktree", () => {
  // Without a real worktree, git rev-parse fails but should not throw
  const out = snapshotBranchHead({ worktreeDir: "/tmp/nonexistent-dir-xyz", existingSnapshot: "" });
  assert.ok("snapshot_sha" in out);
});
// ── writeReviewEvidence snapshot fallback ───────────────────────
test("writeReviewEvidence falls back to changed_files when snapshot diff is empty", () => {
  const repoDir = mkdtempSync(join(tmpdir(), "wave-issue-evidence-fallback-"));
  sh(["git", "init", "-b", "main"], repoDir);
  sh(["git", "config", "user.email", "taxi@example.com"], repoDir);
  sh(["git", "config", "user.name", "Hatch"], repoDir);
  writeFileSync(join(repoDir, "README.md"), "base\n", "utf8");
  sh(["git", "add", "README.md"], repoDir);
  sh(["git", "commit", "-m", "base"], repoDir);
  sh(["git", "checkout", "-b", "wave/goal-1-wave-1"], repoDir);
  writeFileSync(join(repoDir, "sibling.txt"), "sibling\n", "utf8");
  sh(["git", "add", "sibling.txt"], repoDir);
  sh(["git", "commit", "-m", "feat: sibling change (#605)"], repoDir);
  const snapshotSha = sh(["git", "rev-parse", "HEAD"], repoDir);
  sh(["git", "commit", "--allow-empty", "-m", "chore: empty issue commit (#606)"], repoDir);
  const out = writeReviewEvidence({
    worktreeDir: repoDir,
    repo: repoDir,
    issueNumber: "606",
    branch: "wave/goal-1-wave-1",
    reviewQaCommand: "true",
    integrationCommand: "",
    snapshotSha,
  });
  const evidence = JSON.parse(readFileSync(out.review_evidence_path, "utf8"));
  assert.equal(evidence.snapshot_scope_status, "snapshot_empty_fallback");
  assert.equal(evidence.issue_changed_files_count, "0");
  assert.deepEqual(evidence.issue_changed_files, []);
  assert.equal(evidence.scope_diagnostics[0].code, "STALE_BRANCH_MISSING_COMMIT");
  assert.equal(evidence.scope_diagnostics[0].commits_ahead, "2");
  assert.equal(evidence.scope_diagnostics[0].issue_commits, "1");
  assert.equal(evidence.scope_diagnostics[0].issue_changed_files_count, "0");
  assert.match(evidence.scope_diagnostics[0].graph_path, /wave_issue_execute\.dot/);
  assert.match(evidence.review_evidence_note, /STALE_BRANCH_MISSING_COMMIT/);
  assert.match(evidence.review_evidence_note, /wave-issue write-review-evidence/);
  assert.equal(Array.isArray(evidence.diagnostics), true);
  assert.deepEqual(evidence.diagnostics, [
    {
      action: "rerun_history_scan_before_stale_branch",
      branch: "wave/goal-1-wave-1",
      changed_files_count: "1",
      code: "review_evidence_snapshot_empty_fallback",
      commits_ahead: "2",
      issue_changed_files_count: "0",
      issue_commits: "1",
      issue_number: "606",
      message: "snapshot_scope_status=snapshot_empty_fallback; rerun history scanning before stale-branch classification.",
      severity: "warning",
      snapshot_scope_status: "snapshot_empty_fallback",
      snapshot_sha: snapshotSha,
    },
  ]);
  assert.equal(out.review_evidence_diagnostic_code, "review_evidence_snapshot_empty_fallback");
  assert.match(out.review_evidence_note || "", /rerun history scanning/i);
});
test("writeReviewEvidence fails when snapshot missing on shared wave branch with commits", () => {
  const repoDir = mkdtempSync(join(tmpdir(), "wave-issue-evidence-missing-snapshot-"));
  sh(["git", "init", "-b", "main"], repoDir);
  sh(["git", "config", "user.email", "taxi@example.com"], repoDir);
  sh(["git", "config", "user.name", "Hatch"], repoDir);
  writeFileSync(join(repoDir, "README.md"), "base\n", "utf8");
  sh(["git", "add", "README.md"], repoDir);
  sh(["git", "commit", "-m", "base"], repoDir);
  sh(["git", "checkout", "-b", "wave/goal-2-wave-1"], repoDir);
  writeFileSync(join(repoDir, "work.txt"), "work\n", "utf8");
  sh(["git", "add", "work.txt"], repoDir);
  sh(["git", "commit", "-m", "feat: work (#607)"], repoDir);
  const out = writeReviewEvidence({
    worktreeDir: repoDir,
    repo: repoDir,
    issueNumber: "607",
    branch: "wave/goal-2-wave-1",
    reviewQaCommand: "true",
    integrationCommand: "",
    snapshotSha: "",
  });
  assert.equal(out.review_evidence_valid, "false");
  assert.equal(out.review_evidence_error, "review_evidence_snapshot_missing");
  assert.match(out.review_evidence_note, /snapshot_sha required/);
});
test("writeReviewEvidence preserves issue_changed_files when snapshot is captured", () => {
  const repoDir = mkdtempSync(join(tmpdir(), "wave-issue-evidence-snapshot-"));
  sh(["git", "init", "-b", "main"], repoDir);
  sh(["git", "config", "user.email", "taxi@example.com"], repoDir);
  sh(["git", "config", "user.name", "Hatch"], repoDir);
  writeFileSync(join(repoDir, "README.md"), "base\n", "utf8");
  sh(["git", "add", "README.md"], repoDir);
  sh(["git", "commit", "-m", "base"], repoDir);
  sh(["git", "checkout", "-b", "wave/goal-3-wave-1"], repoDir);
  const snapshotSha = sh(["git", "rev-parse", "HEAD"], repoDir);
  writeFileSync(join(repoDir, "feature.txt"), "feature\n", "utf8");
  sh(["git", "add", "feature.txt"], repoDir);
  sh(["git", "commit", "-m", "feat: scoped change (#608)"], repoDir);
  const out = writeReviewEvidence({
    worktreeDir: repoDir,
    repo: repoDir,
    issueNumber: "608",
    branch: "wave/goal-3-wave-1",
    reviewQaCommand: "true",
    integrationCommand: "",
    snapshotSha,
  });
  const evidence = JSON.parse(readFileSync(out.review_evidence_path, "utf8"));
  assert.equal(evidence.snapshot_scope_status, "snapshot_scoped");
  assert.equal(evidence.issue_changed_files_count, "1");
  assert.deepEqual(evidence.issue_changed_files, ["feature.txt"]);
});
test("writeReviewEvidence backfills issue-scoped delta from commit history when snapshot diff is empty", () => {
  const repoDir = mkdtempSync(join(tmpdir(), "wave-issue-evidence-history-fallback-"));
  sh(["git", "init", "-b", "main"], repoDir);
  sh(["git", "config", "user.email", "taxi@example.com"], repoDir);
  sh(["git", "config", "user.name", "Hatch"], repoDir);
  writeFileSync(join(repoDir, "README.md"), "base\n", "utf8");
  sh(["git", "add", "README.md"], repoDir);
  sh(["git", "commit", "-m", "base"], repoDir);
  sh(["git", "checkout", "-b", "wave/goal-554-wave-2"], repoDir);
  writeFileSync(join(repoDir, "issue-560.txt"), "560\n", "utf8");
  sh(["git", "add", "issue-560.txt"], repoDir);
  sh(["git", "commit", "-m", "feat: stalled wave remediation (#560)"], repoDir);
  writeFileSync(join(repoDir, "issue-561.txt"), "561\n", "utf8");
  sh(["git", "add", "issue-561.txt"], repoDir);
  sh(["git", "commit", "-m", "feat: stalled wave telemetry (#561)"], repoDir);
  const snapshotSha = sh(["git", "rev-parse", "HEAD"], repoDir);
  const out = writeReviewEvidence({
    worktreeDir: repoDir,
    repo: repoDir,
    issueNumber: "561",
    branch: "wave/goal-554-wave-2",
    reviewQaCommand: "true",
    integrationCommand: "",
    snapshotSha,
  });
  const evidence = JSON.parse(readFileSync(out.review_evidence_path, "utf8"));
  assert.equal(evidence.issue_commits, "1");
  assert.equal(evidence.issue_changed_files_count, "1");
  assert.deepEqual(evidence.issue_changed_files, ["issue-561.txt"]);
});
test("validateZeroDeltaReviewEvidence classifies stale branch from zero-delta summary and judge-context style evidence", () => {
  const wd = mkdtempSync(join(tmpdir(), "wave-issue-validate-zero-delta-"));
  const evidencePath = join(wd, "judge-context.evidence.json");
  writeFileSync(evidencePath, JSON.stringify({
    issue_number: "777",
    branch: "wave/goal-777-wave-1",
    worktree_dir: wd,
    commits_ahead: "0",
    changed_files: [],
    issue_commits: "0",
    issue_changed_files: [],
    snapshot_sha: "deadbeef",
    snapshot_scope_status: "snapshot_empty_fallback",
    scope_diagnostics: buildReviewEvidenceScopeDiagnostics({
      snapshotScopeStatus: "snapshot_empty_fallback",
      commitsAhead: "0",
      issueCommits: "0",
      issueChangedFilesCount: "0",
      worktreeDir: wd,
      repo: wd,
      issueNumber: "777",
      branch: "wave/goal-777-wave-1",
      snapshotSha: "deadbeef",
    }),
    review_evidence_note: "STALE_BRANCH_MISSING_COMMIT: snapshot-scoped issue delta is empty or mismatched; rerun wave-issue write-review-evidence",
    summary: "No commits ahead of main",
    judge_context: {
      scenario: "qa/review-evidence",
      scenario_selector: "qa/infrastructure",
    },
    judge_context_path: join(wd, ".hatch", "judge", "context", "777.json"),
    judge_context_valid: "true",
    judge_context_error: "",
  }, null, 2), "utf8");
  const out = validateZeroDeltaReviewEvidence({
    reviewEvidencePath: evidencePath,
    worktreeDir: wd,
    issueNumber: "777",
    branch: "wave/goal-777-wave-1",
  });
  assert.equal(out.zero_delta_detected, "true");
  assert.equal(out.classification, "stale_branch");
  assert.equal(out.commits_ahead, "0");
  assert.equal(out.issue_commits, "0");
  assert.match(out.review_notes, /classification=stale_branch/);
  assert.match(out.review_notes, /issue-scoped/i);
  assert.match(out.review_notes, /missing issue commit/i);
  assert.match(out.review_notes, /judge-context style evidence/i);
  assert.match(out.review_notes, /qa\/review-evidence/);
  assert.match(out.review_notes, /STALE_BRANCH_MISSING_COMMIT/);
  assert.match(out.review_notes, /wave_issue_execute\.dot/);
  assert.match(out.review_notes, /wave-issue write-review-evidence/);
});
test("validateZeroDeltaReviewEvidence keeps reviewer path when issue-scoped delta exists", () => {
  const wd = mkdtempSync(join(tmpdir(), "wave-issue-validate-non-zero-delta-"));
  const evidencePath = join(wd, "review.evidence.json");
  writeFileSync(evidencePath, JSON.stringify({
    issue_number: "778",
    branch: "wave/778",
    worktree_dir: wd,
    commits_ahead: "2",
    changed_files: ["packages/factory-ops/src/commands/wave-issue-state.ts"],
    issue_commits: "2",
    issue_changed_files: ["packages/factory-ops/src/commands/wave-issue-state.ts"],
    snapshot_sha: "",
    summary: "Existing commits reviewed",
  }, null, 2), "utf8");
  const out = validateZeroDeltaReviewEvidence({
    reviewEvidencePath: evidencePath,
    worktreeDir: wd,
    issueNumber: "778",
    branch: "wave/778",
  });
  assert.equal(out.zero_delta_detected, "false");
  assert.equal(out.classification, "has_delta");
  assert.match(out.review_notes, /continue to reviewer path/i);
});
// ── revertToSnapshot ────────────────────────────────────────────
test("revertToSnapshot returns false with reason when no snapshot sha", () => {
  const out = revertToSnapshot({ worktreeDir: "/tmp", snapshotSha: "" });
  assert.equal(out.reverted, "false");
  assert.equal(out.reason, "no_snapshot_sha");
});
test("parseGitHubRepoFromRemoteUrl supports canonical github origin formats", () => {
  assert.equal(parseGitHubRepoFromRemoteUrl("git@github.com:recallnet/astrochicken.git"), "recallnet/astrochicken");
  assert.equal(parseGitHubRepoFromRemoteUrl("https://github.com/recallnet/astrochicken.git"), "recallnet/astrochicken");
  assert.equal(parseGitHubRepoFromRemoteUrl("ssh://git@github.com/recallnet/astrochicken.git"), "recallnet/astrochicken");
});
test("resolveIssueMetadataRepo resolves owner/repo from worktree remote when repo arg is a path", () => {
  const repoDir = mkdtempSync(join(tmpdir(), "wave-issue-meta-repo-"));
  sh(["git", "init", "-b", "main"], repoDir);
  sh(["git", "remote", "add", "origin", "https://github.com/recallnet/astrochicken.git"], repoDir);
  const resolved = resolveIssueMetadataRepo({ repo: repoDir, worktreeDir: repoDir });
  assert.equal(resolved, "recallnet/astrochicken");
});
test("writeReviewEvidence fetches issue metadata when repo arg is a local path", () => {
  const repoDir = mkdtempSync(join(tmpdir(), "wave-issue-evidence-repo-"));
  sh(["git", "init", "-b", "main"], repoDir);
  sh(["git", "config", "user.email", "taxi@example.com"], repoDir);
  sh(["git", "config", "user.name", "Hatch"], repoDir);
  writeFileSync(join(repoDir, "README.md"), "x\n", "utf8");
  sh(["git", "add", "README.md"], repoDir);
  sh(["git", "commit", "-m", "base"], repoDir);
  sh(["git", "remote", "add", "origin", "https://github.com/recallnet/astrochicken.git"], repoDir);
  const binDir = mkdtempSync(join(tmpdir(), "wave-issue-gh-bin-"));
  const ghPath = join(binDir, "gh");
  writeFileSync(
    ghPath,
    "#!/bin/sh\nif [ \"$1\" = \"issue\" ] && [ \"$2\" = \"view\" ]; then\n  echo '{\"title\":\"Issue 440 title\",\"body\":\"Issue body excerpt context\"}'\n  exit 0\nfi\necho \"unexpected gh invocation: $@\" >&2\nexit 1\n",
    "utf8",
  );
  chmodSync(ghPath, 0o755);
  const previousPath = process.env.PATH || "";
  process.env.PATH = `${binDir}:${previousPath}`;
  try {
    const out = writeReviewEvidence({
      worktreeDir: repoDir,
      repo: repoDir,
      issueNumber: "440",
      branch: "wave/440",
      reviewQaCommand: "true",
      integrationCommand: "",
    });
    const evidence = JSON.parse(readFileSync(out.review_evidence_path, "utf8"));
    assert.equal(evidence.issue_title, "Issue 440 title");
    assert.match(evidence.issue_body_excerpt, /Issue body excerpt context/);
  } finally {
    process.env.PATH = previousPath;
  }
});
test("rerunReviewEvidenceQa reruns stored QA command and updates metadata", () => {
  const repoDir = mkdtempSync(join(tmpdir(), "wave-issue-qa-rerun-"));
  sh(["git", "init", "-b", "main"], repoDir);
  sh(["git", "config", "user.email", "taxi@example.com"], repoDir);
  sh(["git", "config", "user.name", "Hatch"], repoDir);
  writeFileSync(join(repoDir, "README.md"), "x\n", "utf8");
  sh(["git", "add", "README.md"], repoDir);
  sh(["git", "commit", "-m", "base"], repoDir);
  const out = writeReviewEvidence({
    worktreeDir: repoDir,
    repo: repoDir,
    issueNumber: "441",
    branch: "wave/441",
    reviewQaCommand: "true",
    integrationCommand: "",
  });
  const rerun = rerunReviewEvidenceQa({ reviewEvidencePath: out.review_evidence_path, worktreeDir: repoDir, repo: repoDir });
  assert.equal(rerun.qa_rerun_ok, "true");
  assert.equal(rerun.qa_status, "pass");
  assert.equal(rerun.qa_rerun_count, "1");
  assert.equal(rerun.qa_command_source, "review_evidence.qa.command");
  assert.equal(rerun.review_qa_command, "true");
  assert.equal(rerun.integration_command, "true");
  assert.ok(rerun.review_evidence_sha256);
  const evidence = JSON.parse(readFileSync(out.review_evidence_path, "utf8"));
  assert.equal(evidence.review_qa_command, "true");
  assert.equal(evidence.integration_command, "true");
  assert.equal(evidence.qa_rerun.count, "1");
  assert.equal(evidence.qa_rerun.last_status, "pass");
  assert.equal(evidence.qa_signature, evidence.qa_rerun.last_hash);
});
test("rerunReviewEvidenceQa reports failure when QA rerun fails", () => {
  const repoDir = mkdtempSync(join(tmpdir(), "wave-issue-qa-rerun-fail-"));
  sh(["git", "init", "-b", "main"], repoDir);
  sh(["git", "config", "user.email", "taxi@example.com"], repoDir);
  sh(["git", "config", "user.name", "Hatch"], repoDir);
  writeFileSync(join(repoDir, "README.md"), "x\n", "utf8");
  sh(["git", "add", "README.md"], repoDir);
  sh(["git", "commit", "-m", "base"], repoDir);
  const out = writeReviewEvidence({
    worktreeDir: repoDir,
    repo: repoDir,
    issueNumber: "442",
    branch: "wave/442",
    reviewQaCommand: "false",
    integrationCommand: "",
  });
  const rerun = rerunReviewEvidenceQa({ reviewEvidencePath: out.review_evidence_path, worktreeDir: repoDir, repo: repoDir });
  assert.equal(rerun.qa_rerun_ok, "false");
  assert.equal(rerun.qa_status, "fail");
  assert.equal(rerun.qa_rerun_count, "1");
  assert.equal(rerun.qa_command_source, "review_evidence.qa.command");
  assert.equal(rerun.qa_rerun_error, "qa_rerun_failed");
});
test("rerunReviewEvidenceQa falls back to persisted review_qa_command when qa.command is empty", () => {
  const repoDir = mkdtempSync(join(tmpdir(), "wave-issue-qa-rerun-fallback-"));
  sh(["git", "init", "-b", "main"], repoDir);
  sh(["git", "config", "user.email", "taxi@example.com"], repoDir);
  sh(["git", "config", "user.name", "Hatch"], repoDir);
  writeFileSync(join(repoDir, "README.md"), "x\n", "utf8");
  sh(["git", "add", "README.md"], repoDir);
  sh(["git", "commit", "-m", "base"], repoDir);
  const out = writeReviewEvidence({
    worktreeDir: repoDir,
    repo: repoDir,
    issueNumber: "443",
    branch: "wave/443",
    reviewQaCommand: "true",
    integrationCommand: "",
  });
  const evidencePath = out.review_evidence_path;
  const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
  evidence.qa.command = "";
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  const captured = [];
  const originalWrite = process.stderr.write;
  process.stderr.write = (chunk, ...args) => {
    captured.push(String(chunk));
    return originalWrite.call(process.stderr, chunk, ...args);
  };
  try {
    const rerun = rerunReviewEvidenceQa({ reviewEvidencePath: evidencePath, worktreeDir: repoDir, repo: repoDir });
    assert.equal(rerun.qa_rerun_ok, "true");
    assert.equal(rerun.qa_status, "pass");
    assert.equal(rerun.qa_command, "true");
    assert.equal(rerun.qa_command_source, "review_evidence.review_qa_command");
    assert.equal(rerun.review_qa_command, "true");
    assert.equal(rerun.integration_command, "true");
  } finally {
    process.stderr.write = originalWrite;
  }
  assert.match(captured.join(""), /qa_rerun executing source=review_evidence\.review_qa_command command=true/);
});
test("rerunReviewEvidenceQa returns error details when evidence missing", () => {
  const tmp = mkdtempSync(join(tmpdir(), "wave-issue-qa-rerun-missing-"));
  const missingPath = join(tmp, "missing.json");
  const rerun = rerunReviewEvidenceQa({ reviewEvidencePath: missingPath });
  assert.equal(rerun.qa_rerun_ok, "false");
  assert.equal(rerun.review_evidence_error, "review_evidence_not_found");
  assert.equal(rerun.qa_rerun_error, "review_evidence_not_found");
});
// ── decideExistingReuseWithNotes ────────────────────────────────
test("decideExistingReuseWithNotes returns review_notes when reuse=true", () => {
  const out = decideExistingReuseWithNotes({ branch: "wave/100", existingCommits: "3" });
  assert.equal(out.reuse_existing_commits, "true");
  assert.match(out.review_notes, /Existing commits/);
});
test("decideExistingReuseWithNotes returns empty review_notes when reuse=false", () => {
  const out = decideExistingReuseWithNotes({ branch: "wave/100", existingCommits: "0" });
  assert.equal(out.reuse_existing_commits, "false");
  assert.equal(out.review_notes, "");
});
test("decideExistingReuseWithNotes returns empty review_notes when reuse=reset", () => {
  const out = decideExistingReuseWithNotes({ branch: "milestone/goal-1", existingCommits: "5" });
  assert.equal(out.reuse_existing_commits, "false");
  assert.equal(out.review_notes, "");
});
// ── resolveMaxReviewAttemptsWithInit ────────────────────────────
test("resolveMaxReviewAttemptsWithInit defaults to 3 and inits attempt at 0", () => {
  const out = resolveMaxReviewAttemptsWithInit("");
  assert.equal(out.max_review_attempts, "3");
  assert.equal(out.review_attempt, "0");
});
test("resolveMaxReviewAttemptsWithInit preserves explicit max", () => {
  const out = resolveMaxReviewAttemptsWithInit("5");
  assert.equal(out.max_review_attempts, "5");
  assert.equal(out.review_attempt, "0");
});
// ── resolveWaveConfig ───────────────────────────────────────────
import { resolveWaveConfig } from "../src/commands/wave-resolve-config.ts";
test("resolveWaveConfig uses defaults when no values provided", () => {
  const out = resolveWaveConfig({});
  assert.match(out.integration_command, /turbo run test/);
  assert.match(out.review_qa_command, /turbo run test/);
  assert.equal(out.stale_run_minutes, "20");
});
test("resolveWaveConfig uses explicit values when provided", () => {
  const out = resolveWaveConfig({
    integrationCommand: "npm test",
    reviewQaCommand: "npm run lint",
    stalledWaveMinutes: "30",
  });
  assert.equal(out.integration_command, "npm test");
  assert.equal(out.review_qa_command, "npm run lint");
  assert.equal(out.stale_run_minutes, "30");
});
test("resolveWaveConfig falls back review_qa_command to integration_command", () => {
  const out = resolveWaveConfig({ integrationCommand: "npm test" });
  assert.equal(out.review_qa_command, "npm test");
});
test("buildInfraFailureImplResult sets disposition and review_failed", () => {
  const r = buildInfraFailureImplResult({ issueNumber: "55", branch: "wave/55", worktreeDir: "/tmp/w", reason: "worktree_add_failed" });
  assert.equal(r.disposition, "infra_failure");
  assert.equal(r.review_failed, "true");
  assert.equal(r.issue_number, "55");
  assert.match(r.review_notes, /worktree_add_failed/);
});
