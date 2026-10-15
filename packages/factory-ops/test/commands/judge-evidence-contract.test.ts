import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  JUDGE_EVIDENCE_PRIMARY_REASON_CODE,
  JUDGE_EVIDENCE_PACKET_TYPE,
  JUDGE_EVIDENCE_SCHEMA_VERSION,
  buildAndPersistJudgeEvidenceContract,
  validateJudgeEvidenceContract,
  validateJudgeEvidenceCompleteness,
} from "../../src/commands/judge-evidence-contract.ts";
import {
  assertDeterministicGateFailure,
  b64,
  buildWaveJudgeContext,
  makeTempDir,
  runOpsCliJson,
  sha256,
  writeReviewEvidence,
} from "./helpers/command-test-helpers.ts";

function assertJudgeEvidenceFailure(validated, expectedCode, options = {}) {
  assertDeterministicGateFailure({
    validated,
    gatePassKey: "judge_evidence_gate_pass",
    gateCodeKey: "judge_evidence_gate_code",
    expectedCode,
    expectedTransition: "repair_judge_evidence_contract",
    ...options,
  });
}

function assertJudgeEvidencePass(validated, options = {}) {
  assert.equal(validated.judge_evidence_gate_pass, "true");
  assert.equal(validated.judge_evidence_gate_code, "ok");
  assert.equal(validated.judge_route_code, "");
  if (options.disposition) {
    assert.equal(validated.disposition, options.disposition);
  }
  if (options.recommendedTransition) {
    assert.equal(validated.recommended_transition, options.recommendedTransition);
  }
}

function validateBuiltEvidence({
  contextRaw,
  built,
  judgeKind = "wave_execution_post_merge",
  requireQaMarkers = "true",
}) {
  return validateJudgeEvidenceCompleteness({
    judgeKind,
    judgeContextRaw: contextRaw,
    judgeEvidencePath: built.judge_evidence_path,
    judgeEvidenceSha256: built.judge_evidence_sha256,
    judgeEvidenceValid: built.judge_evidence_valid,
    judgeEvidenceError: built.judge_evidence_error,
    requireQaMarkers,
  });
}

function buildWaveEvidenceFixture({
  issueNumber,
  qaStatus,
  qaCommand,
  judgeKind = "wave_execution_post_merge",
  requireQaMarkers = "true",
  context,
}) {
  const root = makeTempDir("judge-evidence-");
  const worktree = join(root, `wt-${issueNumber}`);
  mkdirSync(worktree, { recursive: true });
  writeReviewEvidence({ worktreeDir: worktree, issueNumber, qaStatus, qaCommand });

  const resolvedContext = context || buildWaveJudgeContext(worktree, issueNumber);
  const contextRaw = JSON.stringify(resolvedContext);
  const built = buildAndPersistJudgeEvidenceContract({
    judgeKind,
    judgeContextRaw: contextRaw,
    worktreeDir: root,
    requireQaMarkers,
    subjectId: `goal-${issueNumber}-wave-1`,
  });

  return { root, worktree, contextRaw, built };
}

test("judge evidence contract: build + validate passes with qa markers present", () => {
  const fixture = buildWaveEvidenceFixture({
    issueNumber: "420",
    qaStatus: "pass",
    qaCommand: "npm run test",
  });

  assert.equal(fixture.built.judge_evidence_valid, "true");
  assert.match(fixture.built.judge_evidence_sha256, /^[a-f0-9]{64}$/);
  assert.ok(existsSync(fixture.built.judge_evidence_path));

  const artifact = JSON.parse(readFileSync(fixture.built.judge_evidence_path, "utf8"));
  assert.equal(artifact.schema_version, JUDGE_EVIDENCE_SCHEMA_VERSION);
  assert.equal(artifact.packet_type, JUDGE_EVIDENCE_PACKET_TYPE);
  assert.match(String(artifact.packet_id || ""), /^judge_evidence_packet_/);
  assert.equal(artifact.packet_state, "open");
  assert.equal(validateJudgeEvidenceContract(artifact).ok, true);

  const validated = validateBuiltEvidence({
    contextRaw: fixture.contextRaw,
    built: fixture.built,
  });

  assertJudgeEvidencePass(validated);
});

test("judge evidence contract supports issue-spec contexts without qa markers", () => {
  const root = makeTempDir("judge-evidence-");
  const contextRaw = JSON.stringify({ issue_title: "Spec", issue_body: "Body" });

  const built = buildAndPersistJudgeEvidenceContract({
    judgeKind: "issue_spec",
    judgeContextRaw: contextRaw,
    worktreeDir: root,
    requireQaMarkers: "false",
    subjectId: "issue-spec",
  });

  assert.equal(built.judge_evidence_valid, "true");

  const validated = validateBuiltEvidence({
    contextRaw,
    built,
    judgeKind: "issue_spec",
    requireQaMarkers: "false",
  });

  assertJudgeEvidencePass(validated);
});

test("validateJudgeEvidenceContract fails closed for empty payload", () => {
  const out = validateJudgeEvidenceContract({});
  assert.equal(out.ok, false);
  assert.ok(out.errors.includes("judge_evidence_missing_required_fields"));
});

for (const deterministicCase of [
  {
    name: "judge evidence validator fails deterministically for missing evidence path",
    input: {
      judgeKind: "issue_execution_post_merge",
      judgeContextRaw: JSON.stringify([{ issue_number: "1" }]),
      judgeEvidencePath: "",
      judgeEvidenceSha256: "deadbeef",
      judgeEvidenceValid: "true",
      judgeEvidenceError: "",
      requireQaMarkers: "true",
    },
    code: "judge_evidence_path_missing",
    notesPattern: new RegExp(JUDGE_EVIDENCE_PRIMARY_REASON_CODE),
  },
  {
    name: "judge evidence validator propagates build-stage deterministic error codes",
    input: {
      judgeKind: "issue_execution_post_merge",
      judgeContextRaw: JSON.stringify([{ issue_number: "1" }]),
      judgeEvidencePath: "",
      judgeEvidenceSha256: "",
      judgeEvidenceValid: "false",
      judgeEvidenceError: "judge_review_evidence_not_found",
      requireQaMarkers: "true",
    },
    code: "judge_review_evidence_not_found",
  },
  {
    name: "judge evidence validator fails deterministically for missing evidence artifact file",
    input: {
      judgeKind: "issue_execution_post_merge",
      judgeContextRaw: JSON.stringify([{ issue_number: "421" }]),
      judgeEvidencePath: "/tmp/non-existent-judge-evidence.json",
      judgeEvidenceSha256: "deadbeef",
      judgeEvidenceValid: "true",
      judgeEvidenceError: "",
      requireQaMarkers: "true",
    },
    code: "judge_evidence_not_found",
  },
]) {
  test(deterministicCase.name, () => {
    const validated = validateJudgeEvidenceCompleteness(deterministicCase.input);
    assertJudgeEvidenceFailure(validated, deterministicCase.code, {
      notesPattern: deterministicCase.notesPattern,
    });
  });
}

test("judge evidence validator fails deterministically for sha mismatch", () => {
  const fixture = buildWaveEvidenceFixture({
    issueNumber: "421",
    qaStatus: "pass",
    qaCommand: "npm test",
    judgeKind: "issue_execution_post_merge",
  });

  const validated = validateJudgeEvidenceCompleteness({
    judgeKind: "issue_execution_post_merge",
    judgeContextRaw: fixture.contextRaw,
    judgeEvidencePath: fixture.built.judge_evidence_path,
    judgeEvidenceSha256: "cafebabe",
    judgeEvidenceValid: "true",
    judgeEvidenceError: "",
    requireQaMarkers: "true",
  });

  assertJudgeEvidenceFailure(validated, "judge_evidence_sha256_mismatch", {
    expectedDisposition: undefined,
    expectedTransition: undefined,
  });
});

test("judge evidence validator fails deterministically for malformed JSON evidence", () => {
  const root = makeTempDir("judge-evidence-");
  const evidencePath = join(root, "bad-evidence.json");
  const raw = "{ this-is: not-json";
  writeFileSync(evidencePath, raw, "utf8");

  const validated = validateJudgeEvidenceCompleteness({
    judgeKind: "issue_execution_post_merge",
    judgeContextRaw: JSON.stringify([{ issue_number: "422" }]),
    judgeEvidencePath: evidencePath,
    judgeEvidenceSha256: sha256(raw),
    judgeEvidenceValid: "true",
    judgeEvidenceError: "",
    requireQaMarkers: "true",
  });

  assertJudgeEvidenceFailure(validated, "judge_evidence_invalid_json", {
    expectedDisposition: undefined,
    expectedTransition: undefined,
  });
});

test("judge evidence validator fails deterministically for missing required fields", () => {
  const root = makeTempDir("judge-evidence-");
  const evidencePath = join(root, "missing-fields.json");
  const encoded = `${JSON.stringify({ schema_version: JUDGE_EVIDENCE_SCHEMA_VERSION }, null, 2)}\n`;
  writeFileSync(evidencePath, encoded, "utf8");

  const validated = validateJudgeEvidenceCompleteness({
    judgeKind: "issue_execution_post_merge",
    judgeContextRaw: JSON.stringify([{ issue_number: "423" }]),
    judgeEvidencePath: evidencePath,
    judgeEvidenceSha256: sha256(encoded),
    judgeEvidenceValid: "true",
    judgeEvidenceError: "",
    requireQaMarkers: "true",
  });

  assertJudgeEvidenceFailure(validated, "judge_evidence_missing_required_fields", {
    expectedDisposition: undefined,
    expectedTransition: undefined,
  });
});

for (const passCase of [
  {
    name: "judge evidence validator allows empty issue-scoped deltas",
    issueNumber: "424",
    qaStatus: "pass",
    qaCommand: "npm test",
    buildContext: (worktree) => [{
      issue_number: "424",
      branch: "wave/424",
      worktree_dir: worktree,
      issue_commits: "2",
      issue_changed_files_count: "0",
      issue_changed_files: [],
    }],
    assertOutcome: (validated) => assertJudgeEvidencePass(validated, {
      disposition: "approve",
      recommendedTransition: "judge_ready",
    }),
  },
  {
    name: "judge evidence validator allows non-pass qa.status",
    issueNumber: "425",
    qaStatus: "fail",
    qaCommand: "npm test",
    assertOutcome: (validated) => assertJudgeEvidencePass(validated, {
      disposition: "approve",
      recommendedTransition: "judge_ready",
    }),
  },
  {
    name: "judge evidence validator allows missing qa.command",
    issueNumber: "426",
    qaStatus: "pass",
    qaCommand: "",
    assertOutcome: (validated) => assertJudgeEvidencePass(validated),
  },
]) {
  test(passCase.name, () => {
    const root = makeTempDir("judge-evidence-");
    const worktree = join(root, `wt-${passCase.issueNumber}`);
    mkdirSync(worktree, { recursive: true });
    writeReviewEvidence({
      worktreeDir: worktree,
      issueNumber: passCase.issueNumber,
      qaStatus: passCase.qaStatus,
      qaCommand: passCase.qaCommand,
    });

    const context = passCase.buildContext
      ? passCase.buildContext(worktree)
      : buildWaveJudgeContext(worktree, passCase.issueNumber);
    const contextRaw = JSON.stringify(context);
    const built = buildAndPersistJudgeEvidenceContract({
      judgeKind: "wave_execution_post_merge",
      judgeContextRaw: contextRaw,
      worktreeDir: root,
      requireQaMarkers: "true",
      subjectId: `goal-${passCase.issueNumber}-wave-1`,
    });

    const validated = validateBuiltEvidence({
      contextRaw,
      built,
    });

    passCase.assertOutcome(validated);
  });
}

test("judge evidence validator fails deterministically when any evidence item is missing", () => {
  const root = makeTempDir("judge-evidence-");

  const loadedWorktree = join(root, "wt-430");
  mkdirSync(loadedWorktree, { recursive: true });
  writeReviewEvidence({ worktreeDir: loadedWorktree, issueNumber: "430", qaStatus: "pass", qaCommand: "npm run test" });

  const missingWorktree = join(root, "wt-431");
  mkdirSync(missingWorktree, { recursive: true });

  const context = [
    {
      issue_number: "430",
      branch: "wave/430",
      worktree_dir: loadedWorktree,
    },
    {
      issue_number: "431",
      branch: "wave/431",
      worktree_dir: missingWorktree,
    },
  ];

  const contextRaw = JSON.stringify(context);
  const built = buildAndPersistJudgeEvidenceContract({
    judgeKind: "wave_execution_post_merge",
    judgeContextRaw: contextRaw,
    worktreeDir: root,
    requireQaMarkers: "true",
    subjectId: "goal-430-wave-1",
  });

  assert.equal(built.judge_evidence_valid, "true");

  const validated = validateBuiltEvidence({
    contextRaw,
    built,
  });

  assertJudgeEvidenceFailure(validated, "judge_review_evidence_not_found");
});

test("judge evidence validator fails deterministically when evidence item JSON is malformed", () => {
  const root = makeTempDir("judge-evidence-");
  const worktree = join(root, "wt-432");
  mkdirSync(join(worktree, ".hatch", "review"), { recursive: true });
  writeFileSync(join(worktree, ".hatch", "review", "432.json"), "{bad-json", "utf8");

  const contextRaw = JSON.stringify(buildWaveJudgeContext(worktree, "432"));
  const built = buildAndPersistJudgeEvidenceContract({
    judgeKind: "wave_execution_post_merge",
    judgeContextRaw: contextRaw,
    worktreeDir: root,
    requireQaMarkers: "true",
    subjectId: "goal-432-wave-1",
  });

  assert.equal(built.judge_evidence_valid, "true");

  const validated = validateBuiltEvidence({
    contextRaw,
    built,
  });

  assertJudgeEvidenceFailure(validated, "judge_review_evidence_invalid_json");
});

test("judge CLI wiring exposes build/validate evidence contract commands", () => {
  const root = makeTempDir("judge-evidence-");
  const worktree = join(root, "wt-426");
  mkdirSync(worktree, { recursive: true });
  writeReviewEvidence({ worktreeDir: worktree, issueNumber: "426", qaStatus: "pass", qaCommand: "npm test" });

  const contextRaw = JSON.stringify(buildWaveJudgeContext(worktree, "426"));

  const built = runOpsCliJson([
    "judge",
    "build-evidence-contract",
    "--judge-kind",
    "wave_execution_post_merge",
    "--worktree-dir",
    root,
    "--subject-id",
    "goal-426-wave-1",
    "--require-qa-markers",
    "true",
    "--judge-context-b64",
    b64(contextRaw),
  ]);
  assert.equal(built.judge_evidence_valid, "true");

  const validated = runOpsCliJson([
    "judge",
    "validate-evidence-contract",
    "--judge-kind",
    "wave_execution_post_merge",
    "--require-qa-markers",
    "true",
    "--judge-context-b64",
    b64(contextRaw),
    "--judge-evidence-path",
    built.judge_evidence_path,
    "--judge-evidence-sha256",
    built.judge_evidence_sha256,
    "--judge-evidence-valid",
    built.judge_evidence_valid,
    "--judge-evidence-error",
    built.judge_evidence_error,
  ]);

  assertJudgeEvidencePass(validated);
});
