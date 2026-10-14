import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { REVIEWER_CONTEXT_REQUIRED_KEYS, REVIEWER_CONTEXT_PACKET_TYPE, REVIEWER_CONTEXT_SCHEMA_VERSION, REVIEW_CONTEXT_PRIMARY_REASON_CODE, buildAndPersistReviewerContextContract, buildReviewerContextContract, validateReviewContextCompleteness, validateReviewerContextContract } from "../../src/commands/reviewer-context-contract.ts";


function fixture(relativePath) {
  return JSON.parse(readFileSync(new URL(`../merge/fixtures/reviewer-context/${relativePath}`, import.meta.url), "utf8"));
}

function fixturePath(relativePath) {
  return new URL(`../merge/fixtures/reviewer-context/${relativePath}`, import.meta.url);
}

function fixtureRaw(relativePath) {
  return readFileSync(new URL(`../merge/fixtures/reviewer-context/${relativePath}`, import.meta.url), "utf8");
}

function sha256(input) {
  return createHash("sha256").update(input).digest("hex");
}

function sh(args, cwd) {
  const out = spawnSync(args[0], args.slice(1), { cwd, encoding: "utf8" });
  assert.equal(out.status, 0, out.stderr || out.stdout);
  return String(out.stdout || "").trim();
}

function writeJson(pathValue, value) {
  mkdirSync(dirname(pathValue), { recursive: true });
  writeFileSync(pathValue, JSON.stringify(value, null, 2));
}

function initRepo() {
  const dir = mkdtempSync(join(tmpdir(), "reviewer-context-"));
  sh(["git", "init", "-b", "main"], dir);
  sh(["git", "config", "user.email", "taxi@example.com"], dir);
  sh(["git", "config", "user.name", "Hatch"], dir);
  return dir;
}

function writePolicyJson(pathValue, value) {
  const encoded = `${JSON.stringify(value, null, 2)}\n`;
  mkdirSync(dirname(pathValue), { recursive: true });
  writeFileSync(pathValue, encoded, "utf8");
  return { encoded, sha256: sha256(encoded) };
}

test("validateReviewerContextContract accepts valid fixture", () => {
  const context = fixture("valid-context.json");
  const out = validateReviewerContextContract(context);
  assert.equal(out.ok, true);
  assert.deepEqual(out.missing_keys, []);
  assert.equal(context.packet_type, REVIEWER_CONTEXT_PACKET_TYPE);
  assert.match(String(context.packet_id || ""), /^reviewer_context_packet_/);
});

test("validateReviewerContextContract rejects missing required key fixture deterministically", () => {
  const context = fixture("missing-context-key.json");
  const out = validateReviewerContextContract(context);
  assert.equal(out.ok, false);
  assert.deepEqual(out.missing_keys, ["effective_policy", "policy_refs", "policy_sources"]);
});

test("validateReviewContextCompleteness fails deterministically for malformed context artifact JSON", () => {
  const repo = initRepo();
  const contextPath = join(repo, ".hatch", "review", "context", "461.json");
  mkdirSync(dirname(contextPath), { recursive: true });
  const malformedRaw = fixtureRaw("malformed-context-artifact.json");
  writeFileSync(contextPath, malformedRaw, "utf8");

  const out = validateReviewContextCompleteness({
    reviewContextPath: contextPath,
    reviewContextSha256: "deadbeef",
    reviewContextValid: "true",
    reviewContextError: "",
  });

  assert.equal(out.review_context_gate_pass, "false");
  assert.equal(out.disposition, "reject");
  assert.equal(out.recommended_transition, "revise");
  assert.deepEqual(out.reason_codes, [REVIEW_CONTEXT_PRIMARY_REASON_CODE]);
  assert.equal(out.review_context_error, "review_context_invalid_json");
});

test("validateReviewContextCompleteness fails deterministically for missing required context fields", () => {
  const repo = initRepo();
  const contextPath = join(repo, ".hatch", "review", "context", "461.json");
  mkdirSync(dirname(contextPath), { recursive: true });
  const context = fixture("missing-required-fields.context.json");
  const encoded = `${JSON.stringify(context, null, 2)}\n`;
  writeFileSync(contextPath, encoded, "utf8");

  const out = validateReviewContextCompleteness({
    reviewContextPath: contextPath,
    reviewContextSha256: sha256(encoded),
    reviewContextValid: "true",
    reviewContextError: "",
  });

  assert.equal(out.review_context_gate_pass, "false");
  assert.equal(out.disposition, "reject");
  assert.equal(out.recommended_transition, "revise");
  assert.deepEqual(out.reason_codes, [REVIEW_CONTEXT_PRIMARY_REASON_CODE]);
  assert.equal(out.review_context_error, "review_context_missing_required_fields");
});

test("validateReviewContextCompleteness passes for complete valid context artifact", () => {
  const repo = initRepo();
  const contextPath = join(repo, ".hatch", "review", "context", "461.json");
  mkdirSync(dirname(contextPath), { recursive: true });

  const globalPolicyPath = join(repo, "global-policy.json");
  const repoPolicyPath = join(repo, "repo-policy.json");
  const globalPolicy = writePolicyJson(globalPolicyPath, { review: { qa_required: true } });
  const repoPolicy = writePolicyJson(repoPolicyPath, { review: { qa_required: false } });

  const context = fixture("valid-context.json");
  context.policy_refs = [
    {
      id: "global_policy",
      precedence: 0,
      path: globalPolicyPath,
      sha256: globalPolicy.sha256,
      loaded: true,
    },
    {
      id: "repo_policy",
      precedence: 1,
      path: repoPolicyPath,
      sha256: repoPolicy.sha256,
      loaded: true,
    },
  ];
  context.policy_sources = [
    {
      id: "global_policy",
      order: 0,
      path: globalPolicyPath,
      sha256: globalPolicy.sha256,
      loaded: true,
      format: "json",
      key_count: "3",
    },
    {
      id: "repo_policy",
      order: 1,
      path: repoPolicyPath,
      sha256: repoPolicy.sha256,
      loaded: true,
      format: "json",
      key_count: "3",
    },
  ];
  context.effective_policy = {
    schema_version: "review_policy/v1",
    merge_order: ["global_policy", "repo_policy"],
    values: {
      review: {
        qa_required: false,
      },
    },
  };

  const encoded = `${JSON.stringify(context, null, 2)}\n`;
  writeFileSync(contextPath, encoded, "utf8");

  const out = validateReviewContextCompleteness({
    reviewContextPath: contextPath,
    reviewContextSha256: sha256(encoded),
    reviewContextValid: "true",
    reviewContextError: "",
  });

  assert.equal(out.review_context_gate_pass, "true");
  assert.equal(out.review_context_gate_code, "ok");
  assert.equal(out.review_context_error, "");
  assert.equal(out.disposition, "approve");
  assert.equal(out.recommended_transition, "approved");
  assert.deepEqual(out.reason_codes, ["REVIEW_CONTEXT_VALID"]);
});

test("buildReviewerContextContract emits required keys and deterministic ordering", () => {
  const repo = initReviewerBaseRepo();

  writeFileSync(join(repo, "a.txt"), "a\n", "utf8");
  writeFileSync(join(repo, "b.txt"), "b\n", "utf8");
  sh(["git", "add", "a.txt", "b.txt"], repo);
  sh(["git", "commit", "-m", "feat: context keys (#461)"], repo);

  const evidencePath = join(repo, ".hatch", "review", "461.json");
  const evidence = {
    issue_number: "461",
    issue_body_excerpt: "Deterministic contract context",
    branch: "wave/461",
    changed_files: ["b.txt", "a.txt"],
    issue_changed_files: ["b.txt", "a.txt"],
    commits_ahead: "1",
    issue_commits: "1",
    snapshot_sha: "",
    summary: "test",
  };
  writeJson(evidencePath, evidence);

  const first = buildReviewerContextContract({ reviewEvidencePath: evidencePath, worktreeDir: repo, issueNumber: "461", branch: "wave/461" });
  const second = buildReviewerContextContract({ reviewEvidencePath: evidencePath, worktreeDir: repo, issueNumber: "461", branch: "wave/461" });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.context.packet_type, REVIEWER_CONTEXT_PACKET_TYPE);
  assert.equal(second.context.packet_type, REVIEWER_CONTEXT_PACKET_TYPE);
  assert.equal(first.context.packet_id, second.context.packet_id);
  assert.equal(typeof first.context.created_at, "string");
  assert.equal(typeof second.context.created_at, "string");
  assert.deepEqual(
    { ...first.context, created_at: "<dynamic>" },
    { ...second.context, created_at: "<dynamic>" },
  );
  assert.equal(first.context.schema_version, REVIEWER_CONTEXT_SCHEMA_VERSION);
  for (const key of REVIEWER_CONTEXT_REQUIRED_KEYS) assert.ok(key in first.context, `missing key ${key}`);
  assert.deepEqual(first.context.changed_files, ["a.txt", "b.txt"]);
  assert.equal(first.context.policy_refs[0].id, "global_policy");
  assert.equal(first.context.policy_refs[1].id, "repo_policy");
  assert.equal(first.context.policy_sources[0].id, "global_policy");
  assert.equal(first.context.policy_sources[1].id, "repo_policy");
  assert.deepEqual(first.context.effective_policy.merge_order, ["global_policy", "repo_policy"]);
});

test("buildReviewerContextContract carries optional builder notes from review evidence", () => {
  const repo = initReviewerBaseRepo();

  const evidencePath = join(repo, ".hatch", "review", "462.json");
  writeJson(evidencePath, {
    issue_number: "462",
    issue_body_excerpt: "Builder note carry-through",
    branch: "wave/462",
    changed_files: ["README.md"],
    issue_changed_files: ["README.md"],
    commits_ahead: "1",
    issue_commits: "1",
    snapshot_sha: "",
    summary: "Existing commits reviewed",
    builder_notes: "Most of the issue was already done; this pass only tightened the review evidence and one test.",
  });

  const out = buildReviewerContextContract({
    reviewEvidencePath: evidencePath,
    worktreeDir: repo,
    issueNumber: "462",
    branch: "wave/462",
  });

  assert.equal(out.ok, true);
  assert.equal(out.context.builder_notes, "Most of the issue was already done; this pass only tightened the review evidence and one test.");
});

test("buildReviewerContextContract policy merge: no repo override keeps global values", () => {
  const repo = initReviewerBaseRepo();

  const evidencePath = join(repo, ".hatch", "review", "461.json");
  writeJson(evidencePath, {
    issue_number: "461",
    issue_body_excerpt: "Policy merge test",
    branch: "wave/461",
    changed_files: ["README.md"],
    issue_changed_files: ["README.md"],
    commits_ahead: "0",
    issue_commits: "0",
    snapshot_sha: "",
    summary: "policy merge",
  });

  const globalPolicyPath = join(repo, "global-policy.json");
  const repoPolicyPath = join(repo, "repo-policy.json");
  writePolicyJson(globalPolicyPath, {
    review: { qa_required: true, scope_mode: "strict" },
    thresholds: { max_findings: 5 },
  });
  writePolicyJson(repoPolicyPath, {});

  const out = buildReviewerContextContract({
    reviewEvidencePath: evidencePath,
    worktreeDir: repo,
    issueNumber: "461",
    branch: "wave/461",
    skillPolicyPath: globalPolicyPath,
    repoPolicyPath,
  });

  assert.equal(out.ok, true);
  assert.equal(out.context.effective_policy.values.review.qa_required, true);
  assert.equal(out.context.effective_policy.values.review.scope_mode, "strict");
  assert.equal(out.context.effective_policy.values.thresholds.max_findings, 5);
});

test("buildReviewerContextContract policy merge: repo overrides exact conflicting keys", () => {
  const repo = initReviewerBaseRepo();

  const evidencePath = join(repo, ".hatch", "review", "461.json");
  writeJson(evidencePath, {
    issue_number: "461",
    issue_body_excerpt: "Policy merge override",
    branch: "wave/461",
    changed_files: ["README.md"],
    issue_changed_files: ["README.md"],
    commits_ahead: "0",
    issue_commits: "0",
    snapshot_sha: "",
    summary: "policy override",
  });

  const globalPolicyPath = join(repo, "global-policy.json");
  const repoPolicyPath = join(repo, "repo-policy.json");
  writePolicyJson(globalPolicyPath, {
    review: { qa_required: true, scope_mode: "strict" },
    thresholds: { max_findings: 5 },
  });
  writePolicyJson(repoPolicyPath, {
    review: { qa_required: false },
  });

  const out = buildReviewerContextContract({
    reviewEvidencePath: evidencePath,
    worktreeDir: repo,
    issueNumber: "461",
    branch: "wave/461",
    skillPolicyPath: globalPolicyPath,
    repoPolicyPath,
  });

  assert.equal(out.ok, true);
  assert.equal(out.context.effective_policy.values.review.qa_required, false);
  assert.equal(out.context.effective_policy.values.review.scope_mode, "strict");
  assert.equal(out.context.effective_policy.values.thresholds.max_findings, 5);
});

test("buildReviewerContextContract handles malformed/missing issue fields deterministically", () => {
  const repo = initReviewerBaseRepo();

  const evidencePath = join(repo, ".hatch", "review", "missing-fields.json");
  writeJson(evidencePath, {
    issue_number: null,
    issue_body_excerpt: null,
    branch: null,
    changed_files: "not-an-array",
    summary: null,
  });

  const out = buildReviewerContextContract({
    reviewEvidencePath: evidencePath,
    worktreeDir: repo,
    issueNumber: "461",
    branch: "wave/461",
  });

  assert.equal(out.ok, true);
  assert.equal(out.context.issue_number, "461");
  assert.equal(out.context.branch, "wave/461");
  assert.equal(out.context.issue_excerpt, "(missing issue excerpt)");
  assert.deepEqual(out.context.changed_files, []);
});

test("buildReviewerContextContract preserves empty issue_changed_files fixture", () => {
  const repo = initReviewerBaseRepo();

  const evidence = fixture("empty-issue-changed-files.evidence.json");
  const evidencePath = join(repo, ".hatch", "review", "empty-issue-files.json");
  writeJson(evidencePath, { ...evidence, worktree_dir: repo });

  const out = buildReviewerContextContract({ reviewEvidencePath: evidencePath, worktreeDir: repo, issueNumber: "461", branch: evidence.branch });
  assert.equal(out.ok, true);
  assert.deepEqual(out.context.changed_files, []);
  assert.equal(out.context.diff_summary.scope_mode, "snapshot_scoped");
  assert.equal(out.context.diff_summary.issue_changed_files_count, "0");
  assert.deepEqual(out.diagnostics, []);
});

test("buildReviewerContextContract preserves issue-scoped emptiness when snapshot diff is empty", () => {
  const repo = initReviewerBaseRepo();

  const evidencePath = join(repo, ".hatch", "review", "fallback.json");
  writeJson(evidencePath, {
    issue_number: "606",
    issue_body_excerpt: "Snapshot fallback",
    branch: "wave/goal-1-wave-1",
    changed_files: ["alpha.txt", "beta.txt"],
    issue_changed_files_count: "0",
    issue_changed_files: [],
    commits_ahead: "1",
    issue_commits: "1",
    snapshot_sha: "deadbeef",
    snapshot_scope_status: "snapshot_empty_fallback",
    scope_diagnostics: [{
      code: "STALE_BRANCH_MISSING_COMMIT",
      commits_ahead: "1",
      issue_commits: "1",
      issue_changed_files_count: "0",
      graph_path: "docs/contracts/workflow-ir/mothership/goal_issue_execute.dot",
      message: "STALE_BRANCH_MISSING_COMMIT: snapshot-scoped issue delta is empty or mismatched; review evidence fell back to branch-scoped files. See docs/contracts/workflow-ir/mothership/goal_issue_execute.dot.",
      rerun_command: "node packages/factory-ops/src/cli.ts goal-issue write-review-evidence --worktree-dir /tmp/w --repo /tmp/r --issue 606 --branch wave/goal-1-wave-1 --snapshot-sha deadbeef",
    }],
    review_evidence_note: "STALE_BRANCH_MISSING_COMMIT: snapshot-scoped issue delta is empty or mismatched; review evidence fell back to branch-scoped files. See docs/contracts/workflow-ir/mothership/goal_issue_execute.dot. Rerun: node packages/factory-ops/src/cli.ts goal-issue write-review-evidence --worktree-dir /tmp/w --repo /tmp/r --issue 606 --branch wave/goal-1-wave-1 --snapshot-sha deadbeef",
    diagnostics: [
      {
        code: "review_evidence_snapshot_empty_fallback",
        severity: "warning",
        action: "rerun_history_scan_before_stale_branch",
        issue_number: "606",
        branch: "wave/goal-1-wave-1",
        snapshot_sha: "deadbeef",
        snapshot_scope_status: "snapshot_empty_fallback",
        commits_ahead: "1",
        issue_commits: "1",
        changed_files_count: "2",
        issue_changed_files_count: "0",
        message: "snapshot_scope_status=snapshot_empty_fallback; rerun history scanning before stale-branch classification.",
      },
    ],
    summary: "fallback",
  });

  const out = buildReviewerContextContract({ reviewEvidencePath: evidencePath, worktreeDir: repo, issueNumber: "606", branch: "wave/goal-1-wave-1" });
  assert.equal(out.ok, true);
  assert.deepEqual(out.context.changed_files, []);
  assert.equal(out.context.diff_summary.scope_mode, "snapshot_scoped");
  assert.equal(out.context.diff_summary.changed_files_count, "2");
  assert.equal(out.context.diff_summary.issue_changed_files_count, "0");
  assert.deepEqual(out.diagnostics, [
    {
      action: "rerun_history_scan_before_stale_branch",
      branch: "wave/goal-1-wave-1",
      changed_files_count: "2",
      code: "review_evidence_snapshot_empty_fallback",
      commits_ahead: "1",
      issue_changed_files_count: "0",
      issue_commits: "1",
      issue_number: "606",
      message: "snapshot_scope_status=snapshot_empty_fallback; rerun history scanning before stale-branch classification.",
      severity: "warning",
      snapshot_scope_status: "snapshot_empty_fallback",
      snapshot_sha: "deadbeef",
    },
  ]);
});

function writeZeroDiffContext({ repo, contextFixture, evidenceFixture }) {
  const contextPath = join(repo, ".hatch", "review", "context", "645.json");
  const evidencePath = join(repo, ".hatch", "review", "645.json");

  const context = fixture(contextFixture);
  const evidence = fixture(evidenceFixture);

  const globalPolicyPath = join(repo, "policy-global.json");
  const repoPolicyPath = join(repo, "policy-repo.json");

  const resolvedContext = {
    ...context,
    evidence_artifact_path: evidencePath,
    policy_refs: context.policy_refs.map((entry) => ({
      ...entry,
      path: entry.id === "global_policy" ? globalPolicyPath : repoPolicyPath,
      sha256: "deadbeef",
    })),
    policy_sources: context.policy_sources.map((entry) => ({
      ...entry,
      path: entry.id === "global_policy" ? globalPolicyPath : repoPolicyPath,
      sha256: "deadbeef",
    })),
  };

  writeJson(evidencePath, evidence);
  writePolicyJson(globalPolicyPath, { review: { qa_required: true } });
  writePolicyJson(repoPolicyPath, { review: { qa_required: true } });

  const encoded = `${JSON.stringify(resolvedContext, null, 2)}\n`;
  mkdirSync(dirname(contextPath), { recursive: true });
  writeFileSync(contextPath, encoded, "utf8");

  return { contextPath, encoded };
}

test("validateReviewContextCompleteness does not gate on QA failure + zero diff (QA is not review)", () => {
  const repo = initRepo();
  const { contextPath, encoded } = writeZeroDiffContext({
    repo,
    contextFixture: "zero-diff-qa-failure.context.json",
    evidenceFixture: "zero-diff-qa-failure.evidence.json",
  });

  const out = validateReviewContextCompleteness({
    reviewContextPath: contextPath,
    reviewContextSha256: sha256(encoded),
    reviewContextValid: "true",
    reviewContextError: "",
  });

  // QA failure + zero diff must NOT produce the old zero_diff_qa_failure gate code.
  // The fixture may fail on other structural checks (stale SHA etc) — that's fine.
  // What matters is QA status is no longer a review gate.
  assert.notEqual(out.review_context_gate_code, "review_context_zero_diff_qa_failure");
});

test("buildReviewerContextContract enforces snapshot_sha scoped commit subjects on shared branches", () => {
  const repo = initRepo();

  writeFileSync(join(repo, "README.md"), "base\n", "utf8");
  sh(["git", "add", "README.md"], repo);
  sh(["git", "commit", "-m", "base"], repo);

  writeFileSync(join(repo, "sibling.txt"), "sibling\n", "utf8");
  sh(["git", "add", "sibling.txt"], repo);
  sh(["git", "commit", "-m", "feat: sibling issue commit (#450)"], repo);

  const snapshotSha = sh(["git", "rev-parse", "HEAD"], repo);

  writeFileSync(join(repo, "factories-intents.txt"), "contract\n", "utf8");
  sh(["git", "add", "factories-intents.txt"], repo);
  sh(["git", "commit", "-m", "feat: reviewer context contract (#461)"], repo);

  writeFileSync(join(repo, "wave-graph.dot"), "digraph x {}\n", "utf8");
  sh(["git", "add", "wave-graph.dot"], repo);
  sh(["git", "commit", "-m", "test: wire review context into wave graph (#461)"], repo);

  const evidence = fixture("shared-branch-snapshot.evidence.json");
  evidence.snapshot_sha = snapshotSha;
  const evidencePath = join(repo, ".hatch", "review", "shared.json");
  writeJson(evidencePath, { ...evidence, worktree_dir: repo });

  const out = buildReviewerContextContract({
    reviewEvidencePath: evidencePath,
    worktreeDir: repo,
    issueNumber: evidence.issue_number,
    branch: evidence.branch,
  });

  assert.equal(out.ok, true);
  assert.deepEqual(out.context.changed_files, evidence.issue_changed_files);
  assert.deepEqual(out.context.issue_commit_subjects, [
    "feat: reviewer context contract (#461)",
    "test: wire review context into wave graph (#461)",
  ]);
  assert.equal(out.context.diff_summary.scope_mode, "snapshot_scoped");
  assert.equal(out.context.policy_refs[0].id, "global_policy");
  assert.equal(out.context.policy_refs[1].id, "repo_policy");
});

// writeReviewEvidence test removed — goal-issue-state.mjs was deleted in goal migration.

test("reviewer context contract remains deterministic when empty issue scope scenario stays missing", () => {
  const repo = initReviewerBaseRepo();

  const evidencePath = join(repo, ".hatch", "review", "judge-context-scenarios-missing.json");
  writeJson(evidencePath, {
    issue_number: "901",
    issue_body_excerpt: "Mirror empty-scope missing-context routing before judge_context_scenarios_missing.",
    branch: "wave/goal-901-wave-1",
    changed_files: [],
    issue_changed_files_count: "0",
    issue_changed_files: [],
    commits_ahead: "0",
    issue_commits: "0",
    snapshot_sha: "deadbeef",
    snapshot_scope_status: "snapshot_scoped",
    summary: "No issue-scoped file delta",
  });

  const out = buildReviewerContextContract({
    reviewEvidencePath: evidencePath,
    worktreeDir: repo,
    issueNumber: "901",
    branch: "wave/goal-901-wave-1",
  });

  assert.equal(out.ok, true);
  assert.deepEqual(out.context.changed_files, []);
  assert.equal(out.context.diff_summary.issue_changed_files_count, "0");
  assert.deepEqual(out.diagnostics, []);
});

test("buildAndPersistReviewerContextContract writes context artifact with deterministic hash", () => {
  const repo = initReviewerBaseRepo();

  const evidence = fixture("valid.evidence.json");
  const evidencePath = join(repo, ".hatch", "review", "461.json");
  writeJson(evidencePath, { ...evidence, worktree_dir: repo });

  const out = buildAndPersistReviewerContextContract({
    reviewEvidencePath: evidencePath,
    worktreeDir: repo,
    issueNumber: "461",
    branch: "wave/461",
  });

  assert.equal(out.review_context_valid, "true");
  assert.match(out.review_context_path, /\.hatch\/review\/context\/461\.json$/);
  assert.match(out.review_context_sha256, /^[a-f0-9]{64}$/);

  const saved = JSON.parse(readFileSync(out.review_context_path, "utf8"));
  const validation = validateReviewerContextContract(saved);
  assert.equal(validation.ok, true);
});

test("buildAndPersistReviewerContextContract falls back to default review evidence path when flag is missing", () => {
  const repo = initReviewerBaseRepo();

  const issueNumber = "777";
  const evidence = fixture("valid.evidence.json");
  const evidencePath = join(repo, ".hatch", "review", `${issueNumber}.json`);
  writeJson(evidencePath, {
    ...evidence,
    issue_number: issueNumber,
    branch: `wave/${issueNumber}`,
    worktree_dir: repo,
  });

  const out = buildAndPersistReviewerContextContract({
    reviewEvidencePath: "",
    worktreeDir: repo,
    issueNumber,
    branch: `wave/${issueNumber}`,
  });

  assert.equal(out.review_context_valid, "true");
  assert.match(out.review_context_path, /\.hatch\/review\/context\/777\.json$/);

  const saved = JSON.parse(readFileSync(out.review_context_path, "utf8"));
  assert.equal(saved.evidence_artifact_path, evidencePath);
});

test("validateReviewContextCompleteness fails when policy source becomes stale after build", () => {
  const { repoPolicyPath, built } = buildPolicySourceFixture();

  writePolicyJson(repoPolicyPath, { review: { qa_required: true } });

  const out = validateReviewContextCompleteness({
    reviewContextPath: built.review_context_path,
    reviewContextSha256: built.review_context_sha256,
    reviewContextValid: built.review_context_valid,
    reviewContextError: built.review_context_error,
  });

  assert.equal(out.review_context_gate_pass, "false");
  assert.equal(out.disposition, "reject");
  assert.equal(out.recommended_transition, "revise");
  assert.deepEqual(out.reason_codes, [REVIEW_CONTEXT_PRIMARY_REASON_CODE]);
  assert.equal(out.review_context_error, "review_context_policy_source_stale");
});

test("validateReviewContextCompleteness fails when repo policy source is missing", () => {
  const { repoPolicyPath, built } = buildPolicySourceFixture();

  rmSync(repoPolicyPath);

  const out = validateReviewContextCompleteness({
    reviewContextPath: built.review_context_path,
    reviewContextSha256: built.review_context_sha256,
    reviewContextValid: built.review_context_valid,
    reviewContextError: built.review_context_error,
  });

  assert.equal(out.review_context_gate_pass, "false");
  assert.equal(out.disposition, "reject");
  assert.equal(out.recommended_transition, "revise");
  assert.deepEqual(out.reason_codes, [REVIEW_CONTEXT_PRIMARY_REASON_CODE]);
  assert.equal(out.review_context_error, "review_context_policy_source_missing");
});

test("buildAndPersistReviewerContextContract fails deterministically when repo policy source cannot load", () => {
  const repo = initReviewerBaseRepo();

  const evidence = fixture("valid.evidence.json");
  const evidencePath = join(repo, ".hatch", "review", "461.json");
  writeJson(evidencePath, { ...evidence, worktree_dir: repo });

  const out = buildAndPersistReviewerContextContract({
    reviewEvidencePath: evidencePath,
    worktreeDir: repo,
    issueNumber: "461",
    branch: "wave/461",
    repoPolicyPath: join(repo, "missing-repo-policy.md"),
  });

  assert.equal(out.review_context_valid, "false");
  assert.equal(out.review_context_path, "");
  assert.equal(out.review_context_sha256, "");
  assert.equal(out.review_context_error, "repo_policy_policy_not_found");
});

function initReviewerBaseRepo() {
  const repo = initRepo();
  writeFileSync(join(repo, "README.md"), "base\n", "utf8");
  sh(["git", "add", "README.md"], repo);
  sh(["git", "commit", "-m", "base"], repo);
  return repo;
}

function buildPolicySourceFixture() {
  const repo = initReviewerBaseRepo();

  const evidence = fixture("valid.evidence.json");
  const evidencePath = join(repo, ".hatch", "review", "461.json");
  writeJson(evidencePath, { ...evidence, worktree_dir: repo });

  const globalPolicyPath = join(repo, "global-policy.json");
  const repoPolicyPath = join(repo, "repo-policy.json");
  writePolicyJson(globalPolicyPath, { review: { qa_required: true } });
  writePolicyJson(repoPolicyPath, { review: { qa_required: false } });

  const built = buildAndPersistReviewerContextContract({
    reviewEvidencePath: evidencePath,
    worktreeDir: repo,
    issueNumber: "461",
    branch: "wave/461",
    skillPolicyPath: globalPolicyPath,
    repoPolicyPath,
  });
  assert.equal(built.review_context_valid, "true");

  return { repoPolicyPath, built };
}
