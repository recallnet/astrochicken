import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

export function registerWaveJudgeContractCases({ variant = "unit" } = {}) {
const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../..");
const cliPath = join(repoRoot, "packages/factory-ops/src/cli.ts");
const fixtureA92Root = join(testDir, "fixtures", "wave-judge-failure-a92c830c");
const fixture0932Root = join(testDir, "fixtures", "wave-judge-failure-0932c093");

function resolveRepoScenarioRegistryRoot({ scenarioSelector = "astrochicken", scenarioContext = "post-merge" } = {}) {
  const candidates = [
    join(repoRoot, "factories", "mothership", "scenarios"),
    join(repoRoot, "factories", "intents", "scenarios"),
  ];

  const matchingCandidate = candidates.find((candidate) => {
    if (!existsSync(candidate)) return false;
    if (!String(scenarioSelector || "").trim()) return true;
    const selectorPath = String(scenarioContext || "").trim()
      ? join(candidate, scenarioSelector, scenarioContext)
      : join(candidate, scenarioSelector);
    return existsSync(selectorPath);
  });

  return matchingCandidate || candidates.find((candidate) => existsSync(candidate)) || "";
}

function b64(value) {
  return Buffer.from(String(value || ""), "utf8").toString("base64");
}

function runJudgeCli(args, { cwd = repoRoot, env = {} } = {}) {
  const run = spawnSync("node", [cliPath, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });

  assert.equal(run.status, 0, `judge CLI failed: ${run.stderr || run.stdout}`);
  const stdout = String(run.stdout || "").trim();
  assert.ok(stdout.length > 0, `judge CLI produced empty stdout for args: ${args.join(" ")}`);

  try {
    return JSON.parse(stdout);
  } catch {
    assert.fail(`judge CLI stdout was not JSON: ${stdout}`);
  }
}

function writeReviewEvidenceFixture({ fixturePath, worktreeRoot, issueNumber = "1014" }) {
  const reviewDir = join(worktreeRoot, ".hatch", "review");
  mkdirSync(reviewDir, { recursive: true });
  writeFileSync(
    join(reviewDir, `${String(issueNumber)}.json`),
    readFileSync(fixturePath, "utf8"),
    "utf8",
  );
}

function writeReviewEvidenceFixtureDirectory({ fixtureReviewDir, worktreeRoot }) {
  const fixtureFiles = readdirSync(fixtureReviewDir)
    .filter((name) => /^issue-\d+\.json$/.test(name))
    .sort((a, b) => a.localeCompare(b));

  assert.ok(fixtureFiles.length > 0, `no issue-*.json fixtures found in ${fixtureReviewDir}`);

  const fixtureJudgeNotes = [];
  for (const file of fixtureFiles) {
    const issueNumber = String(file.match(/^issue-(\d+)\.json$/)?.[1] || "").trim();
    assert.ok(issueNumber, `unable to derive issue number from fixture file: ${file}`);

    const fixturePath = join(fixtureReviewDir, file);
    writeReviewEvidenceFixture({
      fixturePath,
      worktreeRoot,
      issueNumber,
    });

    try {
      const parsed = JSON.parse(readFileSync(fixturePath, "utf8"));
      const note = String(parsed?.judge_notes || "").trim();
      if (note) fixtureJudgeNotes.push(note);
    } catch {
      // Fixture integrity is asserted elsewhere; keep this helper resilient.
    }
  }

  return { fixtureJudgeNotes };
}

function runWaveJudgeContractFlow({
  mergeCandidatesRaw,
  worktreeDir,
  scenarioRegistryRoot = "",
  scenarioSelector = "astrochicken",
  scenarioContext = "",
  scope = "",
  judgeContextScopeIdentity = "",
  subjectId = "goal-1-wave-1",
  milestoneTitle = "goal-1-wave-1",
  env = {},
}) {
  const builtEvidence = runJudgeCli([
    "judge",
    "build-evidence-contract",
    "--judge-kind",
    "wave_execution_post_merge",
    "--worktree-dir",
    worktreeDir,
    "--subject-id",
    subjectId,
    "--require-qa-markers",
    "true",
    "--judge-context-b64",
    b64(mergeCandidatesRaw),
  ], { env });

  const buildContextArgs = [
    "judge",
    "build-context-contract",
    "--judge-kind",
    "wave_execution_post_merge",
    "--judge-context-b64",
    b64(mergeCandidatesRaw),
    "--subject-id",
    subjectId,
    "--milestone-title",
    milestoneTitle,
    "--objective-id",
    "post_merge_alignment",
    "--judge-rubric",
    "alignment.default",
    "--scenario-selector",
    scenarioSelector,
    "--scenario-registry-root",
    scenarioRegistryRoot,
    "--judge-evidence-path",
    builtEvidence.judge_evidence_path,
    "--judge-evidence-sha256",
    builtEvidence.judge_evidence_sha256,
    "--gh-repo",
    "recallnet/astrochicken",
    "--worktree-dir",
    worktreeDir,
  ];
  if (String(scenarioContext || "").trim()) {
    buildContextArgs.push("--scenario-context", scenarioContext);
  }
  if (String(scope || "").trim()) {
    buildContextArgs.push("--scope", scope);
  }
  if (String(judgeContextScopeIdentity || "").trim()) {
    buildContextArgs.push("--judge-context-scope-identity", judgeContextScopeIdentity);
  }
  const builtContext = runJudgeCli(buildContextArgs, { env });

  const validateContextArgs = [
    "judge",
    "validate-context-contract",
    "--judge-kind",
    "wave_execution_post_merge",
    "--judge-context-b64",
    b64(mergeCandidatesRaw),
    "--scenario-selector",
    scenarioSelector,
    "--scenario-registry-root",
    scenarioRegistryRoot,
    "--objective-id",
    "post_merge_alignment",
    "--judge-rubric",
    "alignment.default",
    "--judge-context-path",
    builtContext.judge_context_path,
    "--judge-context-sha256",
    builtContext.judge_context_sha256,
    "--judge-context-valid",
    builtContext.judge_context_valid,
    "--judge-context-error",
    builtContext.judge_context_error,
    "--judge-evidence-path",
    builtEvidence.judge_evidence_path,
    "--judge-evidence-sha256",
    builtEvidence.judge_evidence_sha256,
  ];
  if (String(scenarioContext || "").trim()) {
    validateContextArgs.push("--scenario-context", scenarioContext);
  }
  if (String(scope || "").trim()) {
    validateContextArgs.push("--scope", scope);
  }
  if (String(judgeContextScopeIdentity || "").trim()) {
    validateContextArgs.push("--judge-context-scope-identity", judgeContextScopeIdentity);
  }
  const validatedContext = runJudgeCli(validateContextArgs, { env });

  const validatedEvidence = runJudgeCli([
    "judge",
    "validate-evidence-contract",
    "--judge-kind",
    "wave_execution_post_merge",
    "--require-qa-markers",
    "true",
    "--judge-context-b64",
    b64(mergeCandidatesRaw),
    "--judge-evidence-path",
    builtEvidence.judge_evidence_path,
    "--judge-evidence-sha256",
    builtEvidence.judge_evidence_sha256,
    "--judge-evidence-valid",
    builtEvidence.judge_evidence_valid,
    "--judge-evidence-error",
    builtEvidence.judge_evidence_error,
  ], { env });

  return {
    builtEvidence,
    builtContext,
    validatedContext,
    validatedEvidence,
  };
}

test("wave judge contract fixture reproduces run a92c830c failure signature and deterministic pass path", () => {
  // Regression provenance: run a92c830c / bug #1014 / milestone goal-1-wave-1.
  const mergeCandidatesRaw = readFileSync(join(fixtureA92Root, "merge_candidates.json"), "utf8").trim();

  const failingRoot = mkdtempSync(join(tmpdir(), "wave-judge-a92c830c-fail-"));
  writeReviewEvidenceFixture({
    fixturePath: join(fixtureA92Root, "review_evidence", "issue-1014.failing.json"),
    worktreeRoot: failingRoot,
  });

  const failing = runWaveJudgeContractFlow({
    mergeCandidatesRaw,
    worktreeDir: failingRoot,
    scenarioRegistryRoot: join(fixtureA92Root, "scenario_registry"),
    judgeContextScopeIdentity: "",
  });

  assert.equal(failing.builtEvidence.judge_evidence_valid, "true");
  assert.equal(failing.builtContext.judge_context_valid, "false");
  assert.equal(failing.builtContext.judge_context_error, "judge_context_scope_identity_missing");
  assert.equal(failing.validatedContext.judge_context_gate_pass, "false");
  assert.equal(failing.validatedContext.judge_context_gate_code, "judge_context_scope_identity_missing");
  assert.equal(failing.validatedContext.judge_route_code, "judge_context_scope_identity_missing");
  if (variant === "unit") assert.equal(failing.validatedContext.disposition, "escalate");
  assert.match(failing.validatedContext.notes, /JUDGE_CONTEXT_INVALID: judge_context_scope_identity_missing/);
  assert.equal(failing.validatedEvidence.judge_evidence_gate_pass, "true");
  assert.equal(failing.validatedEvidence.judge_evidence_gate_code, "ok");

  const passingRoot = mkdtempSync(join(tmpdir(), "wave-judge-a92c830c-pass-"));
  writeReviewEvidenceFixture({
    fixturePath: join(fixtureA92Root, "review_evidence", "issue-1014.passing.json"),
    worktreeRoot: passingRoot,
  });

  const passing = runWaveJudgeContractFlow({
    mergeCandidatesRaw,
    worktreeDir: passingRoot,
    scenarioRegistryRoot: join(fixtureA92Root, "scenario_registry"),
    judgeContextScopeIdentity: "wave_execute",
  });

  assert.equal(passing.builtEvidence.judge_evidence_valid, "true");
  assert.equal(passing.builtContext.judge_context_valid, "true");
  assert.equal(passing.validatedContext.judge_context_gate_pass, "true");
  assert.equal(passing.validatedContext.judge_context_gate_code, "ok");

  assert.ok(passing.validatedEvidence);
  assert.equal(passing.validatedEvidence?.judge_evidence_gate_pass, "true");
  assert.equal(passing.validatedEvidence?.judge_evidence_gate_code, "ok");

  const passTelemetry = JSON.stringify(passing);
  assert.doesNotMatch(passTelemetry, /judge_context_scope_identity_missing/);
  assert.doesNotMatch(passTelemetry, /JUDGE_CONTEXT_INVALID/);
});

test("wave judge regression (bug #1042, run 0932c093) fails without scenario registry root and passes with repo registry", () => {
  const mergeCandidatesRaw = readFileSync(join(fixture0932Root, "merge_candidates.json"), "utf8").trim();
  const scenarioRegistryRoot = resolveRepoScenarioRegistryRoot({
    scenarioSelector: "astrochicken",
    scenarioContext: "post-merge",
  });

  assert.ok(scenarioRegistryRoot, "repo scenario registry root must exist (factories/mothership/scenarios or factories/mothership/scenarios)");

  const failingRoot = mkdtempSync(join(tmpdir(), "wave-judge-0932c093-fail-"));
  const { fixtureJudgeNotes } = writeReviewEvidenceFixtureDirectory({
    fixtureReviewDir: join(fixture0932Root, "review_evidence"),
    worktreeRoot: failingRoot,
  });

  const isolatedHome = mkdtempSync(join(tmpdir(), "wave-judge-0932c093-home-"));
  const failing = runWaveJudgeContractFlow({
    mergeCandidatesRaw,
    worktreeDir: failingRoot,
    scenarioRegistryRoot: "",
    scenarioSelector: "astrochicken",
    scenarioContext: "post-merge",
    scope: "judge",
    subjectId: "goal-324-wave-3",
    milestoneTitle: "goal-324-wave-3",
    env: { HOME: isolatedHome },
  });

  assert.equal(failing.builtEvidence.judge_evidence_valid, "true");
  assert.equal(failing.builtContext.judge_context_valid, "false");
  assert.equal(failing.builtContext.judge_context_error, "judge_context_scenario_registry_root_missing");
  assert.equal(failing.validatedContext.judge_context_gate_pass, "false");
  assert.equal(failing.validatedContext.judge_context_gate_code, "judge_context_scenario_registry_root_missing");
  assert.equal(failing.validatedContext.judge_route_code, "judge_context_scenario_registry_root_missing");
  if (variant === "unit") assert.equal(failing.validatedContext.disposition, "escalate");
  assert.match(failing.validatedContext.notes, /JUDGE_CONTEXT_INVALID/);
  assert.equal(failing.validatedEvidence.judge_evidence_gate_pass, "true");
  assert.equal(failing.validatedEvidence.judge_evidence_gate_code, "ok");

  const failureSignature = [
    `signature=wave-judge-failure run=0932c093`,
    `judge_context_gate_code=${failing.validatedContext.judge_context_gate_code}`,
    `judge_route_code=${failing.validatedContext.judge_route_code}`,
    `judge_notes=${failing.validatedContext.notes}`,
    ...fixtureJudgeNotes,
  ].join(" | ");

  assert.match(failureSignature, /JUDGE_CONTEXT_INVALID/);
  assert.match(failureSignature, /judge_context_scope_identity_missing/);
  assert.match(failureSignature, /wave-judge-failure/);

  const passingRoot = mkdtempSync(join(tmpdir(), "wave-judge-0932c093-pass-"));
  writeReviewEvidenceFixtureDirectory({
    fixtureReviewDir: join(fixture0932Root, "review_evidence"),
    worktreeRoot: passingRoot,
  });

  const passing = runWaveJudgeContractFlow({
    mergeCandidatesRaw,
    worktreeDir: passingRoot,
    scenarioRegistryRoot,
    scenarioSelector: "astrochicken",
    scenarioContext: "post-merge",
    scope: "judge",
    judgeContextScopeIdentity: "wave_execute",
    subjectId: "goal-324-wave-3",
    milestoneTitle: "goal-324-wave-3",
    env: { HOME: isolatedHome },
  });

  assert.equal(passing.builtEvidence.judge_evidence_valid, "true");
  assert.equal(passing.builtContext.judge_context_valid, "true");
  assert.equal(passing.validatedContext.judge_context_gate_pass, "true");
  assert.equal(passing.validatedContext.judge_context_gate_code, "ok");
  assert.ok(passing.validatedEvidence);
  assert.equal(passing.validatedEvidence?.judge_evidence_gate_pass, "true");
  assert.equal(passing.validatedEvidence?.judge_evidence_gate_code, "ok");

  const passingTelemetry = JSON.stringify({
    builtContext: passing.builtContext,
    validatedContext: passing.validatedContext,
    validatedEvidence: passing.validatedEvidence,
  });
  assert.doesNotMatch(passingTelemetry, /judge_context_scenario_registry_root_missing/);
  assert.doesNotMatch(passingTelemetry, /JUDGE_CONTEXT_INVALID/);
  assert.doesNotMatch(passingTelemetry, /wave-judge-failure/);

  const fixtureReadme = readFileSync(join(fixture0932Root, "README.md"), "utf8");
  assert.match(fixtureReadme, /bug #1042/i);
  assert.match(fixtureReadme, /run `0932c093`/);
  assert.match(fixtureReadme, /judge_context_scope_identity_missing/);
  assert.match(fixtureReadme, /wave-judge-failure/);
});

}
