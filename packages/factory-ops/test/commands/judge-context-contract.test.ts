import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  JUDGE_CONTEXT_PACKET_TYPE,
  JUDGE_CONTEXT_PRIMARY_REASON_CODE,
  JUDGE_CONTEXT_REQUIRED_KEYS,
  JUDGE_CONTEXT_SCHEMA_VERSION,
  JUDGE_SCENARIO_BASIS_SCHEMA_VERSION,
  JUDGE_SCENARIO_SELECTION_SCHEMA_VERSION,
  buildAndPersistJudgeContextContract,
  buildJudgeContextContract,
  resolveJudgeScenarioSelectionBasis,
  validateJudgeContextCompleteness,
  validateJudgeContextContract,
} from "../../src/commands/judge-context-contract.ts";
import {
  assertDeterministicGateFailure,
  b64,
  makeTempDir,
  runOpsCliJson,
  seedScenario,
  sha256,
} from "./helpers/command-test-helpers.mjs";

const waveDefaults = {
  judgeKind: "wave_execution_post_merge",
  scenarioSelector: "astrochicken",
  objectiveId: "post_merge_alignment",
  judgeRubric: "alignment.default",
  judgeContextScopeIdentity: "wave_execute",
  ghRepo: "recallnet/astrochicken",
};

function makeJudgeContextTempDir() {
  return makeTempDir("judge-context-");
}

function writeEvidence(root, payload = { ok: true }) {
  const evidencePath = join(root, "evidence.json");
  const evidenceRaw = `${JSON.stringify(payload, null, 2)}\n`;
  writeFileSync(evidencePath, evidenceRaw, "utf8");
  return { evidencePath, evidenceRaw, evidenceSha: sha256(evidenceRaw) };
}

function buildWaveContext({ root, registry, judgeContextRaw, evidence, subjectId, milestoneTitle, overrides = {} }) {
  return buildAndPersistJudgeContextContract({
    ...waveDefaults,
    judgeContextRaw,
    scenarioRegistryRoot: registry,
    judgeEvidencePath: evidence.evidencePath,
    judgeEvidenceSha256: evidence.evidenceSha,
    subjectId,
    milestoneTitle,
    worktreeDir: root,
    ...overrides,
  });
}

function validateWaveContext({ built, judgeContextRaw, registry, evidence, overrides = {} }) {
  return validateJudgeContextCompleteness({
    ...waveDefaults,
    judgeContextPath: built.judge_context_path,
    judgeContextSha256: built.judge_context_sha256,
    judgeContextValid: built.judge_context_valid,
    judgeContextError: built.judge_context_error,
    judgeContextRaw,
    scenarioRegistryRoot: registry,
    judgeEvidencePath: evidence.evidencePath,
    judgeEvidenceSha256: evidence.evidenceSha,
    ...overrides,
  });
}

function createIssueSpecFixture({ seedScenarioPath = "astrochicken/scope/a", buildOverrides = {} } = {}) {
  const root = makeJudgeContextTempDir();
  const registry = join(root, "registry");
  if (seedScenarioPath) {
    seedScenario(registry, seedScenarioPath);
  }
  const evidence = writeEvidence(root);
  const judgeContextRaw = JSON.stringify({ issue_title: "Spec" });
  const built = buildAndPersistJudgeContextContract({
    judgeKind: "issue_spec",
    judgeContextRaw,
    scenarioSelector: "astrochicken",
    scenarioRegistryRoot: registry,
    judgeEvidencePath: evidence.evidencePath,
    judgeEvidenceSha256: evidence.evidenceSha,
    subjectId: "issue-spec",
    worktreeDir: root,
    ...buildOverrides,
  });
  return { root, registry, evidence, judgeContextRaw, built };
}

function validateIssueSpecFixture(fixture, overrides = {}) {
  return validateJudgeContextCompleteness({
    judgeKind: "issue_spec",
    judgeContextPath: fixture.built.judge_context_path,
    judgeContextSha256: fixture.built.judge_context_sha256,
    judgeContextValid: "true",
    judgeContextError: "",
    judgeContextRaw: fixture.judgeContextRaw,
    scenarioSelector: "astrochicken",
    scenarioRegistryRoot: fixture.registry,
    judgeEvidencePath: fixture.evidence.evidencePath,
    judgeEvidenceSha256: fixture.evidence.evidenceSha,
    ...overrides,
  });
}

function assertJudgeContextFailure(validated, expectedCode, options = {}) {
  assertDeterministicGateFailure({
    validated,
    gatePassKey: "judge_context_gate_pass",
    gateCodeKey: "judge_context_gate_code",
    expectedCode,
    expectedTransition: "repair_judge_context_contract",
    ...options,
  });
}

function validateIssueSpecArtifactPath({ root, judgeContextPath, judgeContextSha256 }) {
  return validateJudgeContextCompleteness({
    judgeContextPath,
    judgeContextSha256,
    judgeContextValid: "true",
    judgeContextError: "",
    judgeKind: "issue_spec",
    judgeContextRaw: JSON.stringify({ issue_title: "Spec" }),
    scenarioSelector: "astrochicken",
    scenarioRegistryRoot: join(root, "registry"),
    judgeEvidencePath: "/tmp/evidence.json",
    judgeEvidenceSha256: "deadbeef",
  });
}

test("judge context contract exports deterministic schema metadata", () => {
  assert.equal(JUDGE_SCENARIO_BASIS_SCHEMA_VERSION, "scenario_selection_basis/v1");
  assert.equal(Array.isArray(JUDGE_CONTEXT_REQUIRED_KEYS), true);
  assert.equal(JUDGE_CONTEXT_REQUIRED_KEYS.includes("scenario_basis"), true);
});

test("validateJudgeContextContract fails closed for empty payload", () => {
  const out = validateJudgeContextContract({});
  assert.equal(out.ok, false);
  assert.equal(out.missing_keys.includes("schema_version"), true);
  assert.equal(out.diagnostics.some((diag) => diag.code === "invalid_scope"), true);
});

test("buildJudgeContextContract reports deterministic input-missing code", () => {
  const out = buildJudgeContextContract({});
  assert.equal(out.ok, false);
  assert.equal(out.code, "judge_context_input_missing");
});

test("judge context contract: build + validate passes with deterministic scenario basis and evidence binding", () => {
  const root = makeJudgeContextTempDir();
  const registry = join(root, "registry");
  seedScenario(registry, "astrochicken/post-merge/a");
  seedScenario(registry, "astrochicken/post-merge/b");

  const evidence = writeEvidence(root);
  const judgeContextRaw = JSON.stringify([{ issue_number: "501", branch: "wave/501" }]);

  const built = buildWaveContext({
    root,
    registry,
    judgeContextRaw,
    evidence,
    subjectId: "goal-501-wave-1",
    milestoneTitle: "goal-501-wave-1",
  });

  assert.equal(built.judge_context_valid, "true");
  assert.match(built.judge_context_sha256, /^[a-f0-9]{64}$/);
  assert.match(built.judge_scenario_selection_sha256, /^[a-f0-9]{64}$/);
  assert.match(built.judge_scenario_selection_signature_sha256, /^[a-f0-9]{64}$/);
  assert.ok(existsSync(built.judge_context_path));
  assert.ok(existsSync(built.judge_scenario_selection_path));

  const contract = JSON.parse(readFileSync(built.judge_context_path, "utf8"));
  const selection = JSON.parse(readFileSync(built.judge_scenario_selection_path, "utf8"));

  assert.equal(contract.schema_version, JUDGE_CONTEXT_SCHEMA_VERSION);
  assert.equal(contract.packet_type, JUDGE_CONTEXT_PACKET_TYPE);
  assert.match(String(contract.packet_id || ""), /^judge_context_packet_/);
  assert.equal(contract.packet_state, "open");
  assert.deepEqual(contract.scenario_paths, [
    "astrochicken/post-merge/a/SCENARIO.md",
    "astrochicken/post-merge/b/SCENARIO.md",
  ]);
  assert.equal(contract.objective_id, "post_merge_alignment");
  assert.equal(contract.judge_rubric, "alignment.default");
  assert.equal(contract.judge_evidence_path, evidence.evidencePath);
  assert.equal(contract.judge_evidence_sha256, evidence.evidenceSha);
  assert.equal(contract.judge_scenario_selection_path, built.judge_scenario_selection_path);
  assert.equal(contract.judge_scenario_selection_sha256, built.judge_scenario_selection_sha256);
  assert.equal(contract.scenario_signature_sha256, built.judge_scenario_selection_signature_sha256);

  assert.equal(selection.schema_version, JUDGE_SCENARIO_SELECTION_SCHEMA_VERSION);
  assert.equal(selection.configured, "true");
  assert.deepEqual(selection.scenario_paths, contract.scenario_paths);
  assert.equal(selection.scenario_signature_sha256, contract.scenario_signature_sha256);

  const validated = validateWaveContext({
    built,
    judgeContextRaw,
    registry,
    evidence,
  });

  assert.equal(validated.judge_context_gate_pass, "true");
  assert.equal(validated.judge_context_gate_code, "ok");
  assert.equal(validated.judge_route_code, "");
  assert.equal(validated.judge_scenario_selection_path, built.judge_scenario_selection_path);
  assert.equal(validated.judge_scenario_selection_sha256, built.judge_scenario_selection_sha256);
  assert.equal(validated.judge_scenario_selection_signature_sha256, built.judge_scenario_selection_signature_sha256);
});

test("judge context build+validate passes when canonical selection order differs from lexicographic scenario path order", () => {
  const root = makeJudgeContextTempDir();
  const registry = join(root, "registry");
  seedScenario(registry, "astrochicken/zeta/high-priority", { id: "zz-high", priority: "high" });
  seedScenario(registry, "astrochicken/alpha/medium-priority", { id: "aa-medium", priority: "medium" });

  const evidence = writeEvidence(root);
  const judgeContextRaw = JSON.stringify([{ issue_number: "611", branch: "wave/611" }]);

  const built = buildWaveContext({
    root,
    registry,
    judgeContextRaw,
    evidence,
    subjectId: "goal-611-wave-1",
    milestoneTitle: "goal-611-wave-1",
  });

  assert.equal(built.judge_context_valid, "true");

  const contract = JSON.parse(readFileSync(built.judge_context_path, "utf8"));
  const selection = JSON.parse(readFileSync(built.judge_scenario_selection_path, "utf8"));

  assert.deepEqual(contract.scenario_paths, [
    "astrochicken/zeta/high-priority/SCENARIO.md",
    "astrochicken/alpha/medium-priority/SCENARIO.md",
  ]);
  assert.deepEqual(selection.scenario_paths, contract.scenario_paths);

  const validated = validateWaveContext({
    built,
    judgeContextRaw,
    registry,
    evidence,
  });

  assert.equal(validated.judge_context_gate_pass, "true");
  assert.equal(validated.judge_context_gate_code, "ok");

  const rerun = buildWaveContext({
    root,
    registry,
    judgeContextRaw,
    evidence,
    subjectId: "goal-611-wave-1",
    milestoneTitle: "goal-611-wave-1",
  });

  assert.equal(rerun.judge_context_sha256, built.judge_context_sha256);
  assert.equal(rerun.judge_scenario_selection_sha256, built.judge_scenario_selection_sha256);
  assert.equal(rerun.judge_scenario_selection_signature_sha256, built.judge_scenario_selection_signature_sha256);
});

test("judge context + scenario-selection artifacts are byte-stable across reruns with identical inputs", () => {
  const root = makeJudgeContextTempDir();
  const registry = join(root, "registry");
  seedScenario(registry, "astrochicken/post-merge/a", { id: "alpha", priority: "high" });
  seedScenario(registry, "astrochicken/post-merge/b", { id: "beta", priority: "medium" });

  const evidence = writeEvidence(root);
  const judgeContextRaw = JSON.stringify([{ issue_number: "777", branch: "wave/777" }]);

  const first = buildWaveContext({
    root,
    registry,
    judgeContextRaw,
    evidence,
    subjectId: "goal-777-wave-1",
    milestoneTitle: "goal-777-wave-1",
  });
  const second = buildWaveContext({
    root,
    registry,
    judgeContextRaw,
    evidence,
    subjectId: "goal-777-wave-1",
    milestoneTitle: "goal-777-wave-1",
  });

  assert.equal(first.judge_context_path, second.judge_context_path);
  assert.equal(first.judge_context_sha256, second.judge_context_sha256);
  assert.equal(first.judge_scenario_selection_path, second.judge_scenario_selection_path);
  assert.equal(first.judge_scenario_selection_sha256, second.judge_scenario_selection_sha256);

  assert.equal(
    readFileSync(first.judge_context_path, "utf8"),
    readFileSync(second.judge_context_path, "utf8"),
  );
  assert.equal(
    readFileSync(first.judge_scenario_selection_path, "utf8"),
    readFileSync(second.judge_scenario_selection_path, "utf8"),
  );
});

test("judge scenario selection basis is normalized, ordered, and hash-stable", () => {
  const root = makeJudgeContextTempDir();
  const registry = join(root, "registry");
  seedScenario(registry, "astrochicken/c/a");
  seedScenario(registry, "astrochicken/a/c");

  const basis = resolveJudgeScenarioSelectionBasis({
    scenarioSelector: "astrochicken/c,astrochicken/a",
    scenarioRegistryRoot: registry,
  });

  assert.equal(basis.ok, true);
  assert.deepEqual(basis.selector_paths, ["astrochicken/a", "astrochicken/c"]);
  assert.deepEqual(basis.scenario_paths, [
    "astrochicken/c/a/SCENARIO.md",
    "astrochicken/a/c/SCENARIO.md",
  ]);
  assert.match(basis.scenario_signature_sha256, /^[a-f0-9]{64}$/);

  const rerun = resolveJudgeScenarioSelectionBasis({
    scenarioSelector: "astrochicken/c,astrochicken/a",
    scenarioRegistryRoot: registry,
  });
  assert.equal(rerun.scenario_signature_sha256, basis.scenario_signature_sha256);
});

test("judge scenario selection basis emits deterministic empty payload when scenarios are unconfigured", () => {
  const root = makeJudgeContextTempDir();
  const registry = join(root, "registry");

  const first = resolveJudgeScenarioSelectionBasis({
    scenarioSelector: "",
    scenarioRegistryRoot: registry,
  });
  const second = resolveJudgeScenarioSelectionBasis({
    scenarioSelector: "",
    scenarioRegistryRoot: registry,
  });

  assert.equal(first.ok, true);
  assert.equal(first.code, "ok");
  assert.equal(first.configured, "false");
  assert.deepEqual(first.selector_paths, []);
  assert.deepEqual(first.scenario_paths, []);
  assert.deepEqual(first.selected_scenarios, []);
  assert.equal(first.scenario_count, "0");
  assert.match(first.scenario_signature_sha256, /^[a-f0-9]{64}$/);
  assert.equal(second.scenario_signature_sha256, first.scenario_signature_sha256);
});

test("judge scenario selection basis allows configured selectors to resolve to zero scenarios", () => {
  const root = makeJudgeContextTempDir();
  const registry = join(root, "registry");

  const basis = resolveJudgeScenarioSelectionBasis({
    scenarioSelector: "astrochicken",
    scenarioRegistryRoot: registry,
  });

  assert.equal(basis.ok, true);
  assert.equal(basis.code, "ok");
  assert.equal(basis.configured, "true");
  assert.deepEqual(basis.selector_paths, ["astrochicken"]);
  assert.deepEqual(basis.scenario_paths, []);
  assert.deepEqual(basis.selected_scenarios, []);
  assert.equal(basis.scenario_count, "0");
  assert.match(basis.scenario_signature_sha256, /^[a-f0-9]{64}$/);
});

for (const zeroScenarioCase of [
  {
    name: "wave_execution_post_merge context build fails when configured scenarios resolve to zero artifacts",
    buildOverrides: {
      judgeKind: "wave_execution_post_merge",
      judgeContextRaw: JSON.stringify([{ issue_number: "1014", branch: "wave/goal-1-wave-1" }]),
      scenarioSelector: "astrochicken",
      objectiveId: "post_merge_alignment",
      judgeRubric: "alignment.default",
      judgeContextScopeIdentity: "wave_execute",
      subjectId: "goal-1-wave-1",
      milestoneTitle: "goal-1-wave-1",
      ghRepo: "recallnet/astrochicken",
    },
    validateOverrides: {
      judgeKind: "wave_execution_post_merge",
      judgeContextRaw: JSON.stringify([{ issue_number: "1014", branch: "wave/goal-1-wave-1" }]),
      scenarioSelector: "astrochicken",
      objectiveId: "post_merge_alignment",
      judgeRubric: "alignment.default",
      judgeContextScopeIdentity: "wave_execute",
    },
  },
  {
    name: "goal_execution_post_merge context build fails when configured scenarios resolve to zero artifacts",
    buildOverrides: {
      judgeKind: "goal_execution_post_merge",
      judgeContextRaw: JSON.stringify([{ issue_number: "1014", branch: "goal/goal-1" }]),
      scenarioSelector: "astrochicken",
      scenarioContext: "post-merge",
      scope: "judge",
      objectiveId: "post_merge_alignment",
      judgeRubric: "alignment.default",
      judgeContextScopeIdentity: "goal_execute",
      subjectId: "goal-1",
      goalNumber: "1",
      ghRepo: "recallnet/astrochicken",
    },
    validateOverrides: {
      judgeKind: "goal_execution_post_merge",
      judgeContextRaw: JSON.stringify([{ issue_number: "1014", branch: "goal/goal-1" }]),
      scenarioSelector: "astrochicken",
      scenarioContext: "post-merge",
      scope: "judge",
      objectiveId: "post_merge_alignment",
      judgeRubric: "alignment.default",
      judgeContextScopeIdentity: "goal_execute",
    },
  },
]) {
  test(zeroScenarioCase.name, () => {
    const root = makeJudgeContextTempDir();
    const registry = join(root, "registry");
    const evidence = writeEvidence(root);

    const built = buildAndPersistJudgeContextContract({
      ...zeroScenarioCase.buildOverrides,
      scenarioRegistryRoot: registry,
      judgeEvidencePath: evidence.evidencePath,
      judgeEvidenceSha256: evidence.evidenceSha,
      worktreeDir: root,
    });

    assert.equal(built.judge_context_valid, "false");
    assert.equal(built.judge_context_error, "judge_context_scenarios_missing");

    const validated = validateJudgeContextCompleteness({
      ...zeroScenarioCase.validateOverrides,
      judgeContextPath: built.judge_context_path,
      judgeContextSha256: built.judge_context_sha256,
      judgeContextValid: built.judge_context_valid,
      judgeContextError: built.judge_context_error,
      scenarioRegistryRoot: registry,
      judgeEvidencePath: evidence.evidencePath,
      judgeEvidenceSha256: evidence.evidenceSha,
    });

    assertJudgeContextFailure(validated, "judge_context_scenarios_missing", {
      notesPattern: /JUDGE_CONTEXT_INVALID: judge_context_scenarios_missing/,
    });
  });
}

test("judge context build fails closed when scenario registry root is omitted", () => {
  const root = makeJudgeContextTempDir();
  const evidence = writeEvidence(root);

  const built = buildAndPersistJudgeContextContract({
    ...waveDefaults,
    judgeContextRaw: JSON.stringify([{ issue_number: "1015", branch: "wave/goal-1-wave-1" }]),
    scenarioRegistryRoot: "",
    judgeEvidencePath: evidence.evidencePath,
    judgeEvidenceSha256: evidence.evidenceSha,
    subjectId: "goal-1-wave-1",
    milestoneTitle: "goal-1-wave-1",
    worktreeDir: root,
  });

  assert.equal(built.judge_context_valid, "false");
  assert.equal(built.judge_context_error, "judge_context_scenario_registry_root_missing");
});

test("judge scenario selection basis caps selected scenarios at two highest-priority entries", () => {
  const root = makeJudgeContextTempDir();
  const registry = join(root, "registry");
  seedScenario(registry, "astrochicken/meta/third-medium", { id: "m3", priority: "medium" });
  seedScenario(registry, "astrochicken/meta/first-critical", { id: "c1", priority: "critical" });
  seedScenario(registry, "astrochicken/meta/second-high", { id: "h2", priority: "high" });

  const basis = resolveJudgeScenarioSelectionBasis({
    scenarioSelector: "astrochicken",
    scenarioRegistryRoot: registry,
  });

  assert.equal(basis.ok, true);
  assert.deepEqual(basis.scenario_paths, [
    "astrochicken/meta/first-critical/SCENARIO.md",
    "astrochicken/meta/second-high/SCENARIO.md",
  ]);
  assert.equal(basis.scenario_count, "2");
  assert.equal(basis.selected_scenarios.length, 2);
});

test("judge context build persists deterministic empty scenario-selection artifact when selector is unconfigured", () => {
  const root = makeJudgeContextTempDir();
  const evidence = writeEvidence(root);

  const built = buildAndPersistJudgeContextContract({
    judgeKind: "issue_spec",
    judgeContextRaw: JSON.stringify({ issue_title: "No scenario selector" }),
    scenarioSelector: "",
    scenarioRegistryRoot: join(root, "registry"),
    judgeEvidencePath: evidence.evidencePath,
    judgeEvidenceSha256: evidence.evidenceSha,
    subjectId: "issue-spec",
    worktreeDir: root,
  });

  assert.equal(built.judge_context_valid, "true");
  assert.ok(existsSync(built.judge_scenario_selection_path));

  const selection = JSON.parse(readFileSync(built.judge_scenario_selection_path, "utf8"));
  assert.equal(selection.schema_version, JUDGE_SCENARIO_SELECTION_SCHEMA_VERSION);
  assert.equal(selection.configured, "false");
  assert.deepEqual(selection.selector_paths, []);
  assert.deepEqual(selection.scenario_paths, []);
  assert.equal(selection.scenario_count, "0");
});

test("judge context validator fails deterministically for missing context path", () => {
  const validated = validateJudgeContextCompleteness({
    judgeContextPath: "",
    judgeContextSha256: "deadbeef",
    judgeContextValid: "true",
    judgeContextError: "",
    judgeKind: "issue_spec",
    judgeContextRaw: JSON.stringify({ issue_title: "Spec" }),
    scenarioSelector: "astrochicken",
    scenarioRegistryRoot: "/tmp/missing-registry",
    judgeEvidencePath: "/tmp/evidence.json",
    judgeEvidenceSha256: "deadbeef",
  });

  assertJudgeContextFailure(validated, "judge_context_path_missing", {
    notesPattern: new RegExp(JUDGE_CONTEXT_PRIMARY_REASON_CODE),
  });
});

test("judge context validator fails deterministically for sha mismatch", () => {
  const fixture = createIssueSpecFixture();
  const validated = validateIssueSpecFixture(fixture, {
    judgeContextSha256: "cafebabe",
  });

  assertJudgeContextFailure(validated, "judge_context_sha256_mismatch", {
    expectedDisposition: undefined,
    expectedTransition: undefined,
  });
});

test("judge context validator fails deterministically for malformed JSON artifact", () => {
  const root = makeJudgeContextTempDir();
  const malformedPath = join(root, "judge-context.json");
  writeFileSync(malformedPath, "{bad-json", "utf8");

  const validated = validateIssueSpecArtifactPath({
    root,
    judgeContextPath: malformedPath,
    judgeContextSha256: sha256("{bad-json"),
  });

  assertJudgeContextFailure(validated, "judge_context_invalid_json", {
    expectedDisposition: undefined,
    expectedTransition: undefined,
  });
});

test("judge context validator fails deterministically for missing required fields", () => {
  const root = makeJudgeContextTempDir();
  const malformedContractPath = join(root, "judge-context.json");
  const encoded = `${JSON.stringify({ schema_version: JUDGE_CONTEXT_SCHEMA_VERSION }, null, 2)}\n`;
  writeFileSync(malformedContractPath, encoded, "utf8");

  const validated = validateIssueSpecArtifactPath({
    root,
    judgeContextPath: malformedContractPath,
    judgeContextSha256: sha256(encoded),
  });

  assertJudgeContextFailure(validated, "judge_context_missing_required_fields", {
    expectedDisposition: undefined,
    expectedTransition: undefined,
  });
});

for (const tamperCase of [
  {
    name: "judge context validator fails deterministically for scenario signature mismatch",
    mutate: ({ built }) => {
      const contract = JSON.parse(readFileSync(built.judge_context_path, "utf8"));
      contract.scenario_signature_sha256 = "deadbeef";
      const tampered = `${JSON.stringify(contract, null, 2)}\n`;
      writeFileSync(built.judge_context_path, tampered, "utf8");
      return { judgeContextPath: built.judge_context_path, judgeContextSha256: sha256(tampered) };
    },
    expectedCode: "judge_context_validation_failed",
  },
  {
    name: "judge context validator fails deterministically for tampered scenario-selection artifact",
    mutate: ({ built }) => {
      writeFileSync(built.judge_scenario_selection_path, `${JSON.stringify({ tampered: true }, null, 2)}\n`, "utf8");
      return { judgeContextPath: built.judge_context_path, judgeContextSha256: built.judge_context_sha256 };
    },
    expectedCode: "judge_context_scenario_selection_sha256_mismatch",
  },
]) {
  test(tamperCase.name, () => {
    const fixture = createIssueSpecFixture();
    const override = tamperCase.mutate(fixture);
    const validated = validateIssueSpecFixture(fixture, override);

    assertJudgeContextFailure(validated, tamperCase.expectedCode, {
      expectedDisposition: undefined,
      expectedTransition: undefined,
    });
  });
}

test("judge context validator fails deterministically for evidence binding mismatch", () => {
  const fixture = createIssueSpecFixture();
  const validated = validateIssueSpecFixture(fixture, {
    judgeEvidencePath: "/tmp/other-evidence.json",
  });

  assertJudgeContextFailure(validated, "judge_context_evidence_path_mismatch", {
    expectedDisposition: undefined,
    expectedTransition: undefined,
  });
});

test("judge CLI wiring exposes build/validate context contract commands", () => {
  const root = makeJudgeContextTempDir();
  const registry = join(root, "registry");
  seedScenario(registry, "astrochicken/scope/a");

  const evidence = writeEvidence(root);
  const judgeContextRaw = JSON.stringify({ issue_title: "Spec" });

  const built = runOpsCliJson([
    "judge",
    "build-context-contract",
    "--judge-kind",
    "issue_spec",
    "--judge-context-b64",
    b64(judgeContextRaw),
    "--scenario-selector",
    "astrochicken",
    "--scenario-registry-root",
    registry,
    "--judge-evidence-path",
    evidence.evidencePath,
    "--judge-evidence-sha256",
    evidence.evidenceSha,
    "--subject-id",
    "issue-spec",
    "--worktree-dir",
    root,
  ]);
  assert.equal(built.judge_context_valid, "true");

  const validated = runOpsCliJson([
    "judge",
    "validate-context-contract",
    "--judge-kind",
    "issue_spec",
    "--judge-context-b64",
    b64(judgeContextRaw),
    "--scenario-selector",
    "astrochicken",
    "--scenario-registry-root",
    registry,
    "--judge-context-path",
    built.judge_context_path,
    "--judge-context-sha256",
    built.judge_context_sha256,
    "--judge-context-valid",
    built.judge_context_valid,
    "--judge-context-error",
    built.judge_context_error,
    "--judge-evidence-path",
    evidence.evidencePath,
    "--judge-evidence-sha256",
    evidence.evidenceSha,
  ]);

  assert.equal(validated.judge_context_gate_pass, "true");
  assert.equal(validated.judge_context_gate_code, "ok");
});
