import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");
const fixtureRoot = join(repoRoot, "scripts", "test", "fixtures", "pre-commit-quality-gates");
const classifierPath = join(repoRoot, "scripts", "pre-commit-staged-file-classifier.mjs");
const npmStubBinDir = join(fixtureRoot, "bin");
const FACTORY_GRAPHS_ONLY_SCENARIO = "test-suites-factories-graphs-only";

function loadScenario(name) {
  return JSON.parse(
    readFileSync(join(fixtureRoot, "scenarios", `${name}.json`), "utf8"),
  );
}

function toNulDelimitedBuffer(paths) {
  if (!paths.length) {
    return Buffer.alloc(0);
  }
  return Buffer.from(`${paths.join("\0")}\0`, "utf8");
}

function runScenario({ name, mode }) {
  const scenario = loadScenario(name);
  const tempDir = mkdtempSync(join(tmpdir(), "pre-commit-gates-"));
  const stagedListPath = join(tempDir, "staged-files.list");
  const pnpmLogPath = join(tempDir, "npm.log");
  writeFileSync(stagedListPath, toNulDelimitedBuffer(scenario.stagedPaths));

  const env = {
    ...process.env,
    PATH: `${npmStubBinDir}${delimiter}${process.env.PATH ?? ""}`,
    PRE_COMMIT_REAL_NODE: process.execPath,
    PRE_COMMIT_RUNTIME_STARTUP_PROBE_STUB: "1",
    PRE_COMMIT_RUNTIME_STARTUP_PROBE_EXIT: String(scenario.runtimeStartupProbeExit ?? 0),
    PRE_COMMIT_NPM_STUB_LOG: pnpmLogPath,
    PRE_COMMIT_BUILD_EXIT: String(scenario.buildExit ?? 0),
    PRE_COMMIT_TYPECHECK_EXIT: String(scenario.typecheckExit ?? 0),
    PRE_COMMIT_TEST_GUARD_GATES_EXIT: String(scenario.testGuardGatesExit ?? 0),
    PRE_COMMIT_TEST_WAVE_CLAIM_GATES_EXIT: String(scenario.testWaveClaimGatesExit ?? 0),
  };

  const run = spawnSync(
    "node",
    [
      classifierPath,
      "--staged-file-list",
      stagedListPath,
      mode === "quality" ? "--run-quality-gates" : "--run-test-suites",
    ],
    {
      cwd: repoRoot,
      env,
      encoding: "utf8",
    },
  );

  const pnpmInvocations = existsSync(pnpmLogPath)
    ? readFileSync(pnpmLogPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
    : [];

  return {
    scenario,
    run,
    pnpmInvocations,
    stdout: run.stdout,
    stderr: run.stderr,
    output: `${run.stdout}${run.stderr}`,
  };
}

function assertNpmInvocationContract(invocations, expectedScripts, expectedCwd = repoRoot) {
  assert.deepEqual(invocations.map((entry) => entry.script), expectedScripts);
  for (const invocation of invocations) {
    assert.equal(invocation.executable, "pnpm");
    assert.equal(invocation.cwd, expectedCwd);
    assert.ok(
      invocation.argv[0] === invocation.script || invocation.argv[1] === invocation.script,
      `expected pnpm argv to include script ${invocation.script}: ${invocation.argv.join(" ")}`,
    );
    assert.equal(invocation.command, `pnpm ${invocation.argv.join(" ")}`);
  }
}

// ---------- non-test quality gates ----------

test("build failure aborts with canonical gate failure output and suppresses typecheck", () => {
  const { scenario, run, pnpmInvocations, output } = runScenario({ name: "build-fail", mode: "quality" });

  assert.equal(run.status, scenario.expectedStatus);
  assertNpmInvocationContract(pnpmInvocations, scenario.expectedNpmCalls);
  assert.match(output, /\[pre-commit\] gate_pass gate=lockfile_sync command="node scripts\/check-lockfile-sync\.ts" exit=0/);
  assert.match(output, /\[pre-commit\] gate_start gate=build command="pnpm build[^"]*"/);
  assert.match(output, /\[pre-commit\] gate_failed gate=build command="pnpm build[^"]*" exit=17/);
  assert.match(output, /\[pre-commit\] first_failure phase=quality_gate target=build command="pnpm build[^"]*" exit=17/);
  assert.doesNotMatch(output, /gate_start gate=runtime_startup_probe/);
  assert.doesNotMatch(output, /gate_start gate=typecheck/);
});

test("typecheck failure runs after successful build with deterministic ordering", () => {
  const { scenario, run, pnpmInvocations, output } = runScenario({ name: "typecheck-fail", mode: "quality" });

  assert.equal(run.status, scenario.expectedStatus);
  assertNpmInvocationContract(pnpmInvocations, scenario.expectedNpmCalls);
  assert.match(output, /\[pre-commit\] gate_pass gate=lockfile_sync command="node scripts\/check-lockfile-sync\.ts" exit=0/);
  assert.match(output, /\[pre-commit\] gate_pass gate=build command="pnpm build[^"]*" exit=0/);
  assert.match(output, /\[pre-commit\] gate_pass gate=runtime_startup_probe command="node scripts\/check-runtime-startup-probe\.ts" exit=0/);
  assert.match(output, /\[pre-commit\] gate_start gate=typecheck command="pnpm typecheck[^"]*"/);
  assert.match(output, /\[pre-commit\] gate_failed gate=typecheck command="pnpm typecheck[^"]*" exit=23/);
  assert.match(output, /\[pre-commit\] first_failure phase=quality_gate target=typecheck command="pnpm typecheck[^"]*" exit=23/);

  const lockfileStart = output.indexOf("gate_start gate=lockfile_sync");
  const buildStart = output.indexOf("gate_start gate=build");
  const startupProbeStart = output.indexOf("gate_start gate=runtime_startup_probe");
  const typecheckStart = output.indexOf("gate_start gate=typecheck");
  assert.ok(lockfileStart >= 0, "missing lockfile_sync gate_start output");
  assert.ok(buildStart >= 0, "missing build gate_start output");
  assert.ok(startupProbeStart >= 0, "missing runtime_startup_probe gate_start output");
  assert.ok(typecheckStart >= 0, "missing typecheck gate_start output");
  assert.ok(lockfileStart < buildStart, "lockfile_sync gate must run before build gate");
  assert.ok(buildStart < startupProbeStart, "build gate must run before runtime_startup_probe gate");
  assert.ok(startupProbeStart < typecheckStart, "runtime_startup_probe gate must run before typecheck gate");
});

test("all quality gates pass with zero exit and no failure line", () => {
  const { scenario, run, pnpmInvocations, output } = runScenario({ name: "both-pass", mode: "quality" });

  assert.equal(run.status, scenario.expectedStatus);
  assertNpmInvocationContract(pnpmInvocations, scenario.expectedNpmCalls);
  assert.match(output, /\[pre-commit\] gate_pass gate=lockfile_sync command="node scripts\/check-lockfile-sync\.ts" exit=0/);
  assert.match(output, /\[pre-commit\] gate_pass gate=build command="pnpm build[^"]*" exit=0/);
  assert.match(output, /\[pre-commit\] gate_pass gate=runtime_startup_probe command="node scripts\/check-runtime-startup-probe\.ts" exit=0/);
  assert.match(output, /\[pre-commit\] gate_pass gate=typecheck command="pnpm typecheck[^"]*" exit=0/);
  assert.doesNotMatch(output, /\[pre-commit\] gate_failed gate=/);
  assert.doesNotMatch(output, /\[pre-commit\] first_failure /);
});

test("docs-only path still runs mandatory non-test quality gates", () => {
  const { scenario, run, pnpmInvocations, output } = runScenario({ name: "docs-only-skip", mode: "quality" });

  assert.equal(run.status, scenario.expectedStatus);
  assertNpmInvocationContract(pnpmInvocations, scenario.expectedNpmCalls);
  assert.match(output, /\[pre-commit\] gate_start gate=lockfile_sync command="node scripts\/check-lockfile-sync\.ts"/);
  assert.match(output, /\[pre-commit\] gate_start gate=build command="pnpm build[^"]*"/);
  assert.match(output, /\[pre-commit\] gate_start gate=runtime_startup_probe command="node scripts\/check-runtime-startup-probe\.ts"/);
  assert.match(output, /\[pre-commit\] gate_start gate=typecheck command="pnpm typecheck[^"]*"/);
  assert.doesNotMatch(output, /\[pre-commit\] gates_skipped/);
});

test("fallback_other branch still runs mandatory quality gates", () => {
  const { scenario, run, pnpmInvocations, output } = runScenario({ name: "fallback-other-runs", mode: "quality" });

  assert.equal(run.status, scenario.expectedStatus);
  assertNpmInvocationContract(pnpmInvocations, scenario.expectedNpmCalls);
  assert.match(output, /\[pre-commit\] gate_start gate=lockfile_sync command="node scripts\/check-lockfile-sync\.ts"/);
  assert.match(output, /\[pre-commit\] gate_start gate=build command="pnpm build[^"]*"/);
  assert.match(output, /\[pre-commit\] gate_start gate=runtime_startup_probe command="node scripts\/check-runtime-startup-probe\.ts"/);
  assert.match(output, /\[pre-commit\] gate_start gate=typecheck command="pnpm typecheck[^"]*"/);
});

// ---------- test suite routing ----------

test("no-staged policy deterministically skips test suites", () => {
  const { run, pnpmInvocations, stdout } = runScenario({ name: "test-suites-no-staged", mode: "tests" });

  assert.equal(run.status, 0);
  assertNpmInvocationContract(pnpmInvocations, []);
  assert.match(stdout, /\[pre-commit\] test_suites_decision action=skip reason=no_staged_paths/);
  assert.match(stdout, /test_suite_skip suite=test:guard-gates reason=no_staged_paths/);
  assert.match(stdout, /test_suite_skip suite=test:wave-claim-gates reason=no_staged_paths/);
});

test("docs-only skip emits deterministic skip lines for both test suites", () => {
  const { scenario, run, pnpmInvocations, stdout } = runScenario({ name: "test-suites-docs-only", mode: "tests" });

  assert.equal(run.status, scenario.expectedStatus);
  assertNpmInvocationContract(pnpmInvocations, scenario.expectedNpmCalls);
  assert.match(stdout, /\[pre-commit\] test_suites_decision action=skip reason=docs_only/);
  assert.match(stdout, /\[pre-commit\] test_suite_skip suite=test:guard-gates reason=docs_only/);
  assert.match(stdout, /\[pre-commit\] test_suite_skip suite=test:wave-claim-gates reason=docs_only/);
});

test("dot-only skip emits deterministic skip lines for both test suites", () => {
  const { scenario, run, pnpmInvocations, stdout } = runScenario({ name: "test-suites-dot-only", mode: "tests" });

  assert.equal(run.status, scenario.expectedStatus);
  assertNpmInvocationContract(pnpmInvocations, scenario.expectedNpmCalls);
  assert.match(stdout, /\[pre-commit\] test_suites_decision action=skip reason=dot_only/);
  assert.match(stdout, /test_suite_skip suite=test:guard-gates reason=dot_only/);
  assert.match(stdout, /test_suite_skip suite=test:wave-claim-gates reason=dot_only/);
});

test("mixed docs+dot skip branch uses docs_or_dot_only reason", () => {
  const { scenario, run, pnpmInvocations, stdout } = runScenario({ name: "test-suites-docs-dot-mixed", mode: "tests" });

  assert.equal(run.status, scenario.expectedStatus);
  assertNpmInvocationContract(pnpmInvocations, scenario.expectedNpmCalls);
  assert.match(stdout, /\[pre-commit\] test_suites_decision action=skip reason=docs_or_dot_only/);
  assert.match(stdout, /test_suite_skip suite=test:guard-gates reason=docs_or_dot_only/);
  assert.match(stdout, /test_suite_skip suite=test:wave-claim-gates reason=docs_or_dot_only/);
});

test("mixed docs+code keeps docs neutral and routes to guard-only bucket", () => {
  const { scenario, run, pnpmInvocations, stdout } = runScenario({ name: "test-suites-mixed-docs-code", mode: "tests" });

  assert.equal(run.status, scenario.expectedStatus);
  assertNpmInvocationContract(pnpmInvocations, scenario.expectedNpmCalls);
  assert.match(stdout, /test_suites_decision action=run reason=bucket_guard_only bucket=guard_only selection=guard_only/);
  assert.match(stdout, /test_suite_route path="docs\/guide\.md" pattern="excluded_docs_or_dot" bucket=neutral/);
  assert.match(stdout, /test_suite_route path="apps\/hatch\/src\/cli\.ts" pattern="apps\/hatch\/\*\*" bucket=guard_only/);
  assert.match(stdout, /test_suite_start suite=test:guard-gates command="pnpm test:guard-gates[^"]*"/);
  assert.match(stdout, /test_suite_skip suite=test:wave-claim-gates reason=not_selected_by_bucket bucket=guard_only/);
  assert.doesNotMatch(stdout, /test_suite_start suite=test:wave-claim-gates/);
});

test("guard-only bucket runs only guard suite and skips wave suite with explicit reason", () => {
  const { scenario, run, pnpmInvocations, stdout } = runScenario({ name: "test-suites-guard-only", mode: "tests" });

  assert.equal(run.status, scenario.expectedStatus);
  assertNpmInvocationContract(pnpmInvocations, scenario.expectedNpmCalls);
  assert.match(stdout, /test_suites_decision action=run reason=bucket_guard_only bucket=guard_only selection=guard_only/);
  assert.match(stdout, /test_suite_route path="apps\/hatch\/src\/cli\.ts" pattern="apps\/hatch\/\*\*" bucket=guard_only/);
  assert.match(stdout, /test_suite_start suite=test:guard-gates command="pnpm test:guard-gates[^"]*" context="turbo run test:guard-gates --filter=hatch[^"]*"/);
  assert.match(stdout, /test_suite_skip suite=test:wave-claim-gates reason=not_selected_by_bucket bucket=guard_only/);
  assert.doesNotMatch(stdout, /test_suite_start suite=test:wave-claim-gates/);
});

test("factories/mothership/graphs path maps to hatch-only guard suite", () => {
  const { scenario, run, pnpmInvocations, stdout } = runScenario({ name: FACTORY_GRAPHS_ONLY_SCENARIO, mode: "tests" });

  assert.equal(run.status, scenario.expectedStatus);
  assertNpmInvocationContract(pnpmInvocations, scenario.expectedNpmCalls);
  assert.match(stdout, /test_suites_decision action=run reason=bucket_guard_only bucket=guard_only selection=guard_only/);
  assert.match(stdout, /test_suite_route path="factories\/mothership\/graphs\/wave_execute\.meta\.json" pattern="factories\/mothership\/graphs\/\*\*" bucket=guard_only/);
  assert.match(stdout, /test_suite_start suite=test:guard-gates command="pnpm test:guard-gates[^"]*"/);
  assert.doesNotMatch(stdout, /test_suite_start suite=test:wave-claim-gates/);
});

test("wave-only bucket runs only wave suite and preserves glob command context", () => {
  const { scenario, run, pnpmInvocations, stdout } = runScenario({ name: "test-suites-wave-only", mode: "tests" });

  assert.equal(run.status, scenario.expectedStatus);
  assertNpmInvocationContract(pnpmInvocations, scenario.expectedNpmCalls);
  assert.match(stdout, /test_suites_decision action=run reason=bucket_wave_claim_only bucket=wave_claim_only selection=wave_claim_only/);
  assert.match(stdout, /test_suite_route path="packages\/factory-ops\/src\/cli\/commands\/wave\.mjs" pattern="packages\/factory-ops\/src\/cli\/commands\/wave\.mjs" bucket=wave_claim_only/);
  assert.match(stdout, /test_suite_start suite=test:wave-claim-gates command="pnpm test:wave-claim-gates[^"]*" context="turbo run test:wave-claim-gates --filter=@hatch\/factory-ops --output-logs=errors-only"/);
  assert.match(stdout, /test_suite_skip suite=test:guard-gates reason=not_selected_by_bucket bucket=wave_claim_only/);
  assert.doesNotMatch(stdout, /test_suite_start suite=test:guard-gates/);
});

test("overlap bucket executes both suites in fixed order", () => {
  const { scenario, run, pnpmInvocations, stdout } = runScenario({ name: "test-suites-overlap", mode: "tests" });

  assert.equal(run.status, scenario.expectedStatus);
  assertNpmInvocationContract(pnpmInvocations, scenario.expectedNpmCalls);
  assert.match(stdout, /test_suites_decision action=run reason=bucket_overlap_guard_wave bucket=all_suites selection="?guard_only\+wave_claim_only"?/);
  assert.match(stdout, /test_suite_start suite=test:guard-gates/);
  assert.match(stdout, /test_suite_start suite=test:wave-claim-gates/);

  const guardStart = stdout.indexOf("test_suite_start suite=test:guard-gates");
  const waveStart = stdout.indexOf("test_suite_start suite=test:wave-claim-gates");
  assert.ok(guardStart >= 0, "missing guard-gates start");
  assert.ok(waveStart >= 0, "missing wave-claim-gates start");
  assert.ok(guardStart < waveStart, "guard-gates must execute before wave-claim-gates");
});

test("factory portability paths skip selective suites with platform invariant reason", () => {
  const { scenario, run, pnpmInvocations, stdout } = runScenario({ name: "test-suites-factory-portability-only", mode: "tests" });

  assert.equal(run.status, scenario.expectedStatus);
  assertNpmInvocationContract(pnpmInvocations, scenario.expectedNpmCalls);
  assert.match(stdout, /test_suites_decision action=skip reason=platform_invariant_trigger/);
  assert.match(stdout, /test_suite_skip suite=test:guard-gates reason=platform_invariant_trigger/);
  assert.match(stdout, /test_suite_skip suite=test:wave-claim-gates reason=platform_invariant_trigger/);
  assert.doesNotMatch(stdout, /reason=bucket_wave_claim_only|reason=bucket_neither_change/);
});

test("platform-trigger branch skips suites for scripts paths with explicit platform reason", () => {
  const { scenario, run, pnpmInvocations, stdout } = runScenario({ name: "test-suites-fallback-all", mode: "tests" });

  assert.equal(run.status, scenario.expectedStatus);
  assertNpmInvocationContract(pnpmInvocations, scenario.expectedNpmCalls);
  assert.match(stdout, /test_suites_decision action=skip reason=platform_invariant_trigger/);
  assert.match(stdout, /test_suite_skip suite=test:guard-gates reason=platform_invariant_trigger/);
  assert.match(stdout, /test_suite_skip suite=test:wave-claim-gates reason=platform_invariant_trigger/);
});


test("guard failure aborts before wave and emits a single first_failure event", () => {
  const { scenario, run, pnpmInvocations, output } = runScenario({ name: "test-suites-guard-fail", mode: "tests" });

  assert.equal(run.status, scenario.expectedStatus);
  assertNpmInvocationContract(pnpmInvocations, scenario.expectedNpmCalls);
  assert.match(output, /test_suite_failed suite=test:guard-gates command="pnpm test:guard-gates[^"]*"/);
  assert.match(output, /\[pre-commit\] first_failure phase=test_suite target=test:guard-gates command="pnpm test:guard-gates[^"]*" exit=31/);
  assert.doesNotMatch(output, /test_suite_start suite=test:wave-claim-gates/);
  const firstFailureCount = (output.match(/\[pre-commit\] first_failure /g) ?? []).length;
  assert.equal(firstFailureCount, 1);
});

test("second suite failure reports explicit command context and fail-fast exit", () => {
  const { scenario, run, pnpmInvocations, output } = runScenario({ name: "test-suites-second-fail", mode: "tests" });

  assert.equal(run.status, scenario.expectedStatus);
  assertNpmInvocationContract(pnpmInvocations, scenario.expectedNpmCalls);
  assert.match(output, /test_suite_pass suite=test:guard-gates command="pnpm test:guard-gates[^"]*" exit=0/);
  assert.match(output, /test_suite_failed suite=test:wave-claim-gates command="pnpm test:wave-claim-gates[^"]*" context="turbo run test:wave-claim-gates --filter=@hatch\/factory-ops --output-logs=errors-only" exit=29/);
  assert.match(output, /\[pre-commit\] first_failure phase=test_suite target=test:wave-claim-gates command="pnpm test:wave-claim-gates[^"]*" exit=29/);

  const firstFailureCount = (output.match(/\[pre-commit\] first_failure /g) ?? []).length;
  assert.equal(firstFailureCount, 1);
});
