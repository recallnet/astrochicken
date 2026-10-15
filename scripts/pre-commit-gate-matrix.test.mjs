import { seedMissingManifestGateStubs } from "./test/helpers/fixture-files.mjs";
import assert from "node:assert/strict";
import { GATE_MANIFEST } from "./lib/gate-manifest.ts";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { formatLintDotSummary, LINT_DOT_MARKER_PREFIX, LINT_DOT_RESULT } from "./lib/lint-dot-contract.ts";
import { classifyStagedPaths, resolveSelectiveSuiteBucket } from "./pre-commit-staged-file-classifier.mjs";
import { defaultStagedFileContent } from "./test/helpers/control-plane-fixture-content.mjs";

import { ensureFile, simpleStub } from "./test/helpers/fixture-files.mjs";
import { baselineFixtureCommit, initFixtureRepo, runFixtureGit } from "./test/helpers/git-fixture.mjs";

// The restored manifest runs 63 preflights; measured serial DOT fixtures take 21–26s.
// Keep a bounded deadline while allowing every gate to execute.
const CASE_TIMEOUT_MS = 45_000;
const SUITE_BUDGET_MS = 1_200_000;
const suiteStartMs = Date.now();

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");
const sourceHookPath = join(repoRoot, ".githooks", "pre-commit");
const sourceClassifierPath = join(repoRoot, "scripts", "pre-commit-staged-file-classifier.mjs");
const sourceRunGatesPath = join(repoRoot, "scripts", "run-gates.mjs");
const sourcePlatformInvariantRunnerPath = join(repoRoot, "scripts", "run-platform-invariant-gates.mjs");
const sourceLineLimitCheckerPath = join(repoRoot, "scripts", "check-line-limit.ts");
const sourceHatchArtifactBoundaryCheckerPath = join(repoRoot, "scripts", "check-hatch-artifact-boundary.ts");
const sourceModuleBoundaryCheckerPath = join(repoRoot, "scripts", "check-module-boundaries.ts");
const sourceTestBoundaryCheckerPath = join(repoRoot, "scripts", "check-test-boundaries.ts");
const sourceTestClassificationCheckerPath = join(repoRoot, "scripts", "check-test-classification.ts");
const sourceTestTopologyCheckerPath = join(repoRoot, "scripts", "check-test-topology.mjs");
const sourceFixtureOwnershipCheckerPath = join(repoRoot, "scripts", "check-fixture-ownership.ts");
const sourceSharedSurfaceOwnershipCheckerPath = join(repoRoot, "scripts", "check-shared-surface-ownership.ts");
const sourceDailyLensCollectorOwnershipCheckerPath = join(repoRoot, "scripts", "check-daily-lens-collector-ownership.ts");
const sourceSubsystemOwnershipCheckerPath = join(repoRoot, "scripts", "check-subsystem-ownership.ts");
const sourceTestClassificationBaselinePath = join(repoRoot, "scripts", "test-classification-baseline.json");
const sourceIrreversibleNodeCoverageCheckerPath = join(repoRoot, "scripts", "check-irreversible-node-coverage.ts");
const sourceIrreversibleNodeCoverageExclusionsPath = join(repoRoot, "scripts", "lib", "irreversible-node-coverage-exclusions.ts");
const sourceIrreversibleNodeCoverageManifestPath = join(repoRoot, "scripts", "lib", "irreversible-node-coverage-manifest.ts");
const sourceWorkspaceExportCoverageCheckerPath = join(repoRoot, "scripts", "check-workspace-export-coverage.mjs");
const sourceCoveragePolicyCheckerPath = join(repoRoot, "scripts", "check-coverage-policy-ratchet.ts");
const sourceCoveragePolicyBaselinePath = join(repoRoot, "scripts", "coverage-policy-ratchet-baseline.json");
const sourceRuntimeStartupProbePath = join(repoRoot, "scripts", "check-runtime-startup-probe.ts");
const sourceBenchmarkJobIdRegistryCheckerPath = join(repoRoot, "scripts", "check-benchmark-job-id-registry.ts");
const sourceContextPropagationCheckerPath = join(repoRoot, "scripts", "check-context-propagation-contract.ts");
const sourcePipelineSegmentCoverageCheckerPath = join(repoRoot, "scripts", "check-pipeline-segment-coverage.ts");
const sourceDegenerateStateGuardCheckerPath = join(repoRoot, "scripts", "check-degenerate-state-guards.ts");
const sourceScenarioRegistryBudgetCheckerPath = join(repoRoot, "scripts", "check-scenario-registry-budget.ts");
const sourceScenarioRegistryBudgetConfigPath = join(repoRoot, "scripts", "config", "scenario-registry.json");
const sourceDegenerateStateGuardBaselinePath = join(repoRoot, "scripts", "degenerate-state-guard-baseline.json");
const sourceHandlerContextContractPath = join(repoRoot, "scripts", "handler-context-contract.json");
const sourceDocsPolicyValidatorPath = join(repoRoot, "scripts", "lib", "docs-policy-validator.ts");
const sourceDocsTemplateFrameworkPath = join(repoRoot, "scripts", "lib", "docs-template-framework.ts");
const sourceLiveDocAssetsManifestPath = join(repoRoot, "scripts", "lib", "live-doc-assets-manifest.ts");
const sourcePlatformInvariantManifestPath = join(repoRoot, "scripts", "lib", "platform-invariant-manifest.ts");
const sourceRoutingConfigPath = join(repoRoot, "scripts", "lib", "pre-commit-routing-config.ts");
const sourceSuiteRoutingConfigPath = join(repoRoot, "scripts", "lib", "suite-routing-config.ts");
const sourceGateManifestPath = join(repoRoot, "scripts", "lib", "gate-manifest.ts"), sourcePhase1GateScopeContractPath = join(repoRoot, "scripts", "lib", "phase1-gate-scope-contract.ts");
const sourceOtelTaxonomyContractCheckerPath = join(repoRoot, "scripts", "check-otel-taxonomy-contract.ts"), sourceOtelTaxonomyContractLibPath = join(repoRoot, "scripts", "lib", "otel-taxonomy-contract.ts"), sourceOtelTaxonomySourceJsonPath = join(repoRoot, "packages", "factory-telemetry", "src", "otel-contract.json");
const sourceWorkflowInstrumentationHelperCheckerPath = join(repoRoot, "scripts", "check-workflow-instrumentation-helper-contract.mjs"), sourceWorkflowInstrumentationHelperLibPath = join(repoRoot, "scripts", "lib", "workflow-instrumentation-helper-contract.ts");
const sourceReactorCollectorCheckerPath = join(repoRoot, "scripts", "check-reactor-collector-contract.ts"), sourceReactorCollectorLibPath = join(repoRoot, "scripts", "lib", "reactor-collector-contract.ts");
const sourceReactorInstrumentationPath = join(repoRoot, "apps", "hatch", "src", "pipeline", "reactor-instrumentation.ts");
const sourceOtelRuntimePath = join(repoRoot, "packages", "factory-telemetry", "src", "otel-stdout.ts");
const sourceCollectorProfilePath = join(repoRoot, "packages", "factory-telemetry", "config", "otel-collector.yaml");
const sourceDocsPolicyPath = join(repoRoot, "docs", "docs-policy.json");
const sourceDocsPolicySchemaPath = join(repoRoot, "docs", "docs-policy.schema.json");
const sourceSuiteRoutingJsonPath = join(repoRoot, "config", "testing", "suite-routing.json");
const sourceTopologyEnforcementJsonPath = join(repoRoot, "config", "testing", "topology-enforcement.json");
const sourceSharedSurfaceOwnershipJsonPath = join(repoRoot, "config", "testing", "shared-surface-ownership.json");
const sourceSubsystemOwnershipJsonPath = join(repoRoot, "config", "testing", "subsystem-ownership.json");
const npmStubBinDir = join(repoRoot, "scripts", "test", "fixtures", "pre-commit-quality-gates", "bin");
const sourceCoverageCheckerPath = join(repoRoot, "scripts", "check-export-coverage.ts");
const FACTORY_OPS_WORKSPACE = "packages/factory-ops";
const MOTHERSHIP_WAVE_EXECUTE_DOT = "docs/contracts/workflow-ir/mothership/wave_execute.dot";
const RELEASE_QUALITY_NPM_SCRIPTS = Object.freeze([
  "test:platform:cli-context-portability",
  "test:platform:supervisor-recovery",
  "test:platform:scaffold-contract",
  "test:platform:factory-portability",
  "test:platform:external-factory-portability-matrix",
  "test:platform:docs-skills-templates",
]);

// Release families own supervisor recovery; platform retains only unmatched commands.
const DOT_DOTFILE_PLATFORM_INVARIANT_NPM_SCRIPTS = Object.freeze([
  "test:platform:managed-factory-mutation-boundaries",
]);
function writeIrreversibleCoverageFixture(repoDir) {
  const graphPath = "factories/test/graphs/test.dot";
  const commandPath = "packages/factory-ops/src/commands/test-command.mjs";
  const contractTestPath = "packages/factory-ops/test/test-node.contract.test.mjs";
  const executableTestPath = "packages/factory-ops/test/test-node.integration.test.mjs";
  const manifestPath = "scripts/lib/test-irreversible-node-coverage-manifest.mjs";

  ensureFile(
    repoDir,
    graphPath,
    'digraph test { sample [type="tool" governance="irreversible" prompt="test-irreversible-command"]; }\n',
  );
  ensureFile(repoDir, commandPath, "export function runTestIrreversibleCommand() {}\n");
  ensureFile(
    repoDir,
    contractTestPath,
    `const graph = "${graphPath}";\nconst marker = "test-irreversible-command";\nvoid graph; void marker;\n`,
  );
  ensureFile(
    repoDir,
    executableTestPath,
    'import { runTestIrreversibleCommand } from "../src/commands/test-command.mjs";\nvoid runTestIrreversibleCommand;\n',
  );
  ensureFile(
    repoDir,
    manifestPath,
    `export const IRREVERSIBLE_NODE_COVERAGE_MANIFEST = [
  {
    graph: "${graphPath}",
    node: "sample",
    command_module: "${commandPath}",
    prompt_pattern: "test-irreversible-command",
    contract_tests: ["${contractTestPath}"],
    executable_tests: ["${executableTestPath}"],
  },
];
export const IRREVERSIBLE_NODE_COVERAGE_EXCLUSIONS = [];
export const IRREVERSIBLE_NODE_COVERAGE_GRAPH_INVENTORY = ["${graphPath}"];\n`,
  );
}

function setupRepo({ stagedPaths, fileContents = {} }) {
  const repoDir = mkdtempSync(join(tmpdir(), "pre-commit-matrix-"));

  mkdirSync(join(repoDir, ".githooks"), { recursive: true });
  mkdirSync(join(repoDir, "config", "testing"), { recursive: true });
  mkdirSync(join(repoDir, "docs"), { recursive: true });
  mkdirSync(join(repoDir, "scripts", "lib"), { recursive: true });
  mkdirSync(join(repoDir, "scripts", "config"), { recursive: true });
  mkdirSync(join(repoDir, "node_modules", ".bin"), { recursive: true }); mkdirSync(join(repoDir, "packages", "factory-telemetry", "src"), { recursive: true });

  copyFileSync(sourceHookPath, join(repoDir, ".githooks", "pre-commit"));
  chmodSync(join(repoDir, ".githooks", "pre-commit"), 0o755);
  copyFileSync(sourceClassifierPath, join(repoDir, "scripts", "pre-commit-staged-file-classifier.mjs"));
  copyFileSync(sourceRunGatesPath, join(repoDir, "scripts", "run-gates.mjs"));
  copyFileSync(sourcePlatformInvariantRunnerPath, join(repoDir, "scripts", "run-platform-invariant-gates.mjs"));
  copyFileSync(sourceLineLimitCheckerPath, join(repoDir, "scripts", "check-line-limit.ts"));
  copyFileSync(sourceHatchArtifactBoundaryCheckerPath, join(repoDir, "scripts", "check-hatch-artifact-boundary.ts"));
  copyFileSync(sourceModuleBoundaryCheckerPath, join(repoDir, "scripts", "check-module-boundaries.ts"));
  copyFileSync(sourceTestBoundaryCheckerPath, join(repoDir, "scripts", "check-test-boundaries.ts"));
  copyFileSync(sourceTestClassificationCheckerPath, join(repoDir, "scripts", "check-test-classification.ts"));
  copyFileSync(sourceTestTopologyCheckerPath, join(repoDir, "scripts", "check-test-topology.mjs"));
  copyFileSync(sourceFixtureOwnershipCheckerPath, join(repoDir, "scripts", "check-fixture-ownership.ts"));
  copyFileSync(sourceSharedSurfaceOwnershipCheckerPath, join(repoDir, "scripts", "check-shared-surface-ownership.ts"));
  copyFileSync(sourceDailyLensCollectorOwnershipCheckerPath, join(repoDir, "scripts", "check-daily-lens-collector-ownership.ts"));
  copyFileSync(sourceSubsystemOwnershipCheckerPath, join(repoDir, "scripts", "check-subsystem-ownership.ts"));
  copyFileSync(sourceTestClassificationBaselinePath, join(repoDir, "scripts", "test-classification-baseline.json"));
  copyFileSync(sourceIrreversibleNodeCoverageCheckerPath, join(repoDir, "scripts", "check-irreversible-node-coverage.ts"));
  copyFileSync(sourceIrreversibleNodeCoverageExclusionsPath, join(repoDir, "scripts", "lib", "irreversible-node-coverage-exclusions.ts"));
  copyFileSync(sourceIrreversibleNodeCoverageManifestPath, join(repoDir, "scripts", "lib", "irreversible-node-coverage-manifest.ts"));
  copyFileSync(sourceWorkspaceExportCoverageCheckerPath, join(repoDir, "scripts", "check-workspace-export-coverage.mjs"));
  copyFileSync(sourceCoveragePolicyCheckerPath, join(repoDir, "scripts", "check-coverage-policy-ratchet.ts"));
  copyFileSync(sourceCoveragePolicyBaselinePath, join(repoDir, "scripts", "coverage-policy-ratchet-baseline.json"));
  copyFileSync(sourceRuntimeStartupProbePath, join(repoDir, "scripts", "check-runtime-startup-probe.ts"));
  copyFileSync(sourceBenchmarkJobIdRegistryCheckerPath, join(repoDir, "scripts", "check-benchmark-job-id-registry.ts"));
  copyFileSync(sourceContextPropagationCheckerPath, join(repoDir, "scripts", "check-context-propagation-contract.ts"));
  copyFileSync(sourcePipelineSegmentCoverageCheckerPath, join(repoDir, "scripts", "check-pipeline-segment-coverage.ts"));
  copyFileSync(sourceDegenerateStateGuardCheckerPath, join(repoDir, "scripts", "check-degenerate-state-guards.ts"));
  copyFileSync(sourceDegenerateStateGuardBaselinePath, join(repoDir, "scripts", "degenerate-state-guard-baseline.json"));
  copyFileSync(sourceHandlerContextContractPath, join(repoDir, "scripts", "handler-context-contract.json"));
  copyFileSync(sourceDocsPolicyValidatorPath, join(repoDir, "scripts", "lib", "docs-policy-validator.ts"));
  copyFileSync(sourceDocsTemplateFrameworkPath, join(repoDir, "scripts", "lib", "docs-template-framework.ts"));
  copyFileSync(sourceLiveDocAssetsManifestPath, join(repoDir, "scripts", "lib", "live-doc-assets-manifest.ts"));
  copyFileSync(sourcePlatformInvariantManifestPath, join(repoDir, "scripts", "lib", "platform-invariant-manifest.ts"));
  copyFileSync(sourceRoutingConfigPath, join(repoDir, "scripts", "lib", "pre-commit-routing-config.ts"));
  copyFileSync(sourceSuiteRoutingConfigPath, join(repoDir, "scripts", "lib", "suite-routing-config.ts"));
  copyFileSync(sourceGateManifestPath, join(repoDir, "scripts", "lib", "gate-manifest.ts")); copyFileSync(sourcePhase1GateScopeContractPath, join(repoDir, "scripts", "lib", "phase1-gate-scope-contract.ts"));
  copyFileSync(sourceOtelTaxonomyContractCheckerPath, join(repoDir, "scripts", "check-otel-taxonomy-contract.ts")); copyFileSync(sourceOtelTaxonomyContractLibPath, join(repoDir, "scripts", "lib", "otel-taxonomy-contract.ts")); copyFileSync(sourceOtelTaxonomySourceJsonPath, join(repoDir, "packages", "factory-telemetry", "src", "otel-contract.json"));
  copyFileSync(sourceWorkflowInstrumentationHelperCheckerPath, join(repoDir, "scripts", "check-workflow-instrumentation-helper-contract.mjs")); copyFileSync(sourceWorkflowInstrumentationHelperLibPath, join(repoDir, "scripts", "lib", "workflow-instrumentation-helper-contract.ts"));
  copyFileSync(sourceReactorCollectorCheckerPath, join(repoDir, "scripts", "check-reactor-collector-contract.ts")); copyFileSync(sourceReactorCollectorLibPath, join(repoDir, "scripts", "lib", "reactor-collector-contract.ts"));
  mkdirSync(join(repoDir, "apps", "hatch", "src", "pipeline"), { recursive: true });
  mkdirSync(join(repoDir, "packages", "factory-telemetry", "src"), { recursive: true });
  mkdirSync(join(repoDir, "packages", "factory-telemetry", "config"), { recursive: true });
  copyFileSync(sourceReactorInstrumentationPath, join(repoDir, "apps", "hatch", "src", "pipeline", "reactor-instrumentation.ts"));
  copyFileSync(sourceOtelRuntimePath, join(repoDir, "packages", "factory-telemetry", "src", "otel-stdout.ts"));
  copyFileSync(sourceCollectorProfilePath, join(repoDir, "packages", "factory-telemetry", "config", "otel-collector.yaml"));
  copyFileSync(sourceScenarioRegistryBudgetCheckerPath, join(repoDir, "scripts", "check-scenario-registry-budget.ts"));
  copyFileSync(sourceScenarioRegistryBudgetConfigPath, join(repoDir, "scripts", "config", "scenario-registry.json"));
  copyFileSync(sourceDocsPolicyPath, join(repoDir, "docs", "docs-policy.json"));
  copyFileSync(sourceDocsPolicySchemaPath, join(repoDir, "docs", "docs-policy.schema.json"));
  copyFileSync(sourceSuiteRoutingJsonPath, join(repoDir, "config", "testing", "suite-routing.json"));
  copyFileSync(sourceTopologyEnforcementJsonPath, join(repoDir, "config", "testing", "topology-enforcement.json"));
  copyFileSync(sourceSharedSurfaceOwnershipJsonPath, join(repoDir, "config", "testing", "shared-surface-ownership.json"));
  copyFileSync(sourceSubsystemOwnershipJsonPath, join(repoDir, "config", "testing", "subsystem-ownership.json"));
  writeIrreversibleCoverageFixture(repoDir);

  ensureFile(
    repoDir,
    "node_modules/.bin/hatch",
    "#!/usr/bin/env bash\nset -euo pipefail\nif [ -n \"${PRE_COMMIT_HATCH_STUB_LOG:-}\" ]; then\n  echo \"$*\" >> \"$PRE_COMMIT_HATCH_STUB_LOG\"\nfi\nexit \"${PRE_COMMIT_HATCH_EXIT:-0}\"\n",
  );
  chmodSync(join(repoDir, "node_modules", ".bin", "hatch"), 0o755);

  ensureFile(
    repoDir,
    "scripts/check-export-coverage.ts",
    "#!/usr/bin/env node\n" +
    "const exit = Number.parseInt(process.env.PRE_COMMIT_EXPORT_COVERAGE_EXIT || '0', 10);\n" +
    "if (process.env.PRE_COMMIT_EXPORT_COVERAGE_STUB_LOG) {\n" +
    "  const { appendFileSync } = await import('node:fs');\n" +
    "  appendFileSync(process.env.PRE_COMMIT_EXPORT_COVERAGE_STUB_LOG, 'check-export-coverage\\n');\n" +
    "}\n" +
    "console.log('[export-coverage] result=' + (exit ? 'fail' : 'ok') + ' new_gaps=0');\n" +
    "process.exit(exit);\n",
  );
  chmodSync(join(repoDir, "scripts", "check-export-coverage.ts"), 0o755);

  ensureFile(
    repoDir,
    "scripts/check-workspace-export-coverage.mjs",
    "#!/usr/bin/env node\n" +
    "const exit = Number.parseInt(process.env.PRE_COMMIT_WORKSPACE_EXPORT_COVERAGE_EXIT || '0', 10);\n" +
    "if (process.env.PRE_COMMIT_WORKSPACE_EXPORT_COVERAGE_STUB_LOG) {\n" +
    "  const { appendFileSync } = await import('node:fs');\n" +
    "  appendFileSync(process.env.PRE_COMMIT_WORKSPACE_EXPORT_COVERAGE_STUB_LOG, 'check-workspace-export-coverage\\n');\n" +
    "}\n" +
    "console.log('[workspace-export-coverage] result=' + (exit ? 'fail' : 'ok') + ' new_gaps=0');\n" +
    "process.exit(exit);\n",
  );
  chmodSync(join(repoDir, "scripts", "check-workspace-export-coverage.mjs"), 0o755);

  ensureFile(
    repoDir,
    "scripts/check-coverage-policy-ratchet.ts",
    "#!/usr/bin/env node\n" +
    "const exit = Number.parseInt(process.env.PRE_COMMIT_COVERAGE_POLICY_EXIT || '0', 10);\n" +
    "if (process.env.PRE_COMMIT_COVERAGE_POLICY_STUB_LOG) {\n" +
    "  const { appendFileSync } = await import('node:fs');\n" +
    "  appendFileSync(process.env.PRE_COMMIT_COVERAGE_POLICY_STUB_LOG, 'check-coverage-policy-ratchet\\n');\n" +
    "}\n" +
    "console.log('[coverage-policy] result=' + (exit ? 'fail' : 'ok') + ' violations=0');\n" +
    "process.exit(exit);\n",
  );
  chmodSync(join(repoDir, "scripts", "check-coverage-policy-ratchet.ts"), 0o755);

  ensureFile(
    repoDir,
    "scripts/check-runtime-startup-probe.ts",
    "#!/usr/bin/env node\n" +
    "const exit = Number.parseInt(process.env.PRE_COMMIT_RUNTIME_STARTUP_PROBE_EXIT || '0', 10);\n" +
    "if (process.env.PRE_COMMIT_RUNTIME_STARTUP_PROBE_STUB_LOG) {\n" +
    "  const { appendFileSync } = await import('node:fs');\n" +
    "  appendFileSync(process.env.PRE_COMMIT_RUNTIME_STARTUP_PROBE_STUB_LOG, 'check-runtime-startup-probe\\n');\n" +
    "}\n" +
    "console.log('[runtime-startup-probe] result=' + (exit ? 'fail' : 'ok') + ' probes=3');\n" +
    "process.exit(exit);\n",
  );
  chmodSync(join(repoDir, "scripts", "check-runtime-startup-probe.ts"), 0o755);

  ensureFile(
    repoDir,
    "scripts/check-benchmark-job-id-registry.ts",
    "#!/usr/bin/env node\n" +
    "const exit = Number.parseInt(process.env.PRE_COMMIT_BENCHMARK_JOB_ID_REGISTRY_EXIT || '0', 10);\n" +
    "if (process.env.PRE_COMMIT_BENCHMARK_JOB_ID_REGISTRY_STUB_LOG) {\n" +
    "  const { appendFileSync } = await import('node:fs');\n" +
    "  appendFileSync(process.env.PRE_COMMIT_BENCHMARK_JOB_ID_REGISTRY_STUB_LOG, 'check-benchmark-job-id-registry\\n');\n" +
    "}\n" +
    "console.log('[benchmark-job-id-registry] result=' + (exit ? 'fail' : 'ok') + ' checked=1 job_ids=1');\n" +
    "process.exit(exit);\n",
  );
  chmodSync(join(repoDir, "scripts", "check-benchmark-job-id-registry.ts"), 0o755);

  ensureFile(
    repoDir,
    "scripts/check-context-propagation-contract.ts",
    "#!/usr/bin/env node\n" +
    "const exit = Number.parseInt(process.env.PRE_COMMIT_CONTEXT_PROPAGATION_CONTRACT_EXIT || '0', 10);\n" +
    "if (process.env.PRE_COMMIT_CONTEXT_PROPAGATION_CONTRACT_STUB_LOG) {\n" +
    "  const { appendFileSync } = await import('node:fs');\n" +
    "  appendFileSync(process.env.PRE_COMMIT_CONTEXT_PROPAGATION_CONTRACT_STUB_LOG, process.argv.slice(2).join(' ') + '\\n');\n" +
    "}\n" +
    "console.log('[context_propagation_contract] result=' + (exit ? 'fail' : 'ok') + ' checked=1 violations=' + (exit ? 1 : 0));\n" +
    "process.exit(exit);\n",
  );
  chmodSync(join(repoDir, "scripts", "check-context-propagation-contract.ts"), 0o755);

  ensureFile(
    repoDir,
    "scripts/lint-dot.mjs",
    "#!/usr/bin/env node\nif (process.env.PRE_COMMIT_LINT_DOT_STUB_LOG) {\n  const { appendFileSync } = await import('node:fs');\n  appendFileSync(process.env.PRE_COMMIT_LINT_DOT_STUB_LOG, process.argv.slice(2).join(' ') + '\\n');\n}\nif (process.env.PRE_COMMIT_LINT_DOT_STDOUT) {\n  process.stdout.write(process.env.PRE_COMMIT_LINT_DOT_STDOUT + '\\n');\n}\nif (process.env.PRE_COMMIT_LINT_DOT_STDERR) {\n  process.stderr.write(process.env.PRE_COMMIT_LINT_DOT_STDERR + '\\n');\n} else {\n  process.stderr.write(process.env.PRE_COMMIT_LINT_DOT_DEFAULT_MARKER + '\\n');\n}\nprocess.exit(Number.parseInt(process.env.PRE_COMMIT_LINT_DOT_EXIT || '0', 10));\n",
  );
  chmodSync(join(repoDir, "scripts", "lint-dot.mjs"), 0o755);


  ensureFile(
    repoDir,
    "scripts/check-lockfile-sync.ts",
    "#!/usr/bin/env node\n" +
      "const exit = Number.parseInt(process.env.PRE_COMMIT_LOCKFILE_SYNC_EXIT || '0', 10);\n" +
      "if (process.env.PRE_COMMIT_LOCKFILE_SYNC_STUB_LOG) {\n" +
      "  const { appendFileSync } = await import('node:fs');\n" +
      "  appendFileSync(process.env.PRE_COMMIT_LOCKFILE_SYNC_STUB_LOG, 'check-lockfile-sync\\n');\n" +
      "}\n" +
      "process.exit(exit);\n",
  );
  chmodSync(join(repoDir, "scripts", "check-lockfile-sync.ts"), 0o755);

  ensureFile(repoDir, "scripts/eslint-gate.mjs", simpleStub("PRE_COMMIT_ESLINT_EXIT", "[eslint]", " files=1"));
  chmodSync(join(repoDir, "scripts", "eslint-gate.mjs"), 0o755);
  ensureFile(
    repoDir,
    "scripts/check-degenerate-state-guards.ts",
    "#!/usr/bin/env node\n" +
      "const exit = Number.parseInt(process.env.PRE_COMMIT_DEGENERATE_STATE_GUARDS_EXIT || '0', 10);\n" +
      "if (process.env.PRE_COMMIT_DEGENERATE_STATE_GUARDS_STUB_LOG) {\n" +
      "  const { appendFileSync } = await import('node:fs');\n" +
      "  appendFileSync(process.env.PRE_COMMIT_DEGENERATE_STATE_GUARDS_STUB_LOG, process.argv.slice(2).join(' ') + '\\n');\n" +
      "}\n" +
      "console.log('[degenerate_state_guards] result=' + (exit ? 'fail' : 'ok') + ' guarded=3 unguarded=' + (exit ? 1 : 0));\n" +
      "process.exit(exit);\n",
  );
  chmodSync(join(repoDir, "scripts", "check-degenerate-state-guards.ts"), 0o755);
  ensureFile(repoDir, "scripts/check-internal-cli-transport.ts", simpleStub("PRE_COMMIT_INTERNAL_CLI_TRANSPORT_EXIT", "[internal-cli-transport]", " checked=0 graph=0 runtime=0 opted_in_graph=0"));
  chmodSync(join(repoDir, "scripts", "check-internal-cli-transport.ts"), 0o755);
  ensureFile(repoDir, "scripts/check-active-surface-manifest.ts", simpleStub("PRE_COMMIT_ACTIVE_SURFACE_MANIFEST_EXIT", "[active-surface-manifest]", " checked=0 graph=0 runtime=0 command=0 diagnostics=0"));
  chmodSync(join(repoDir, "scripts", "check-active-surface-manifest.ts"), 0o755);
  ensureFile(repoDir, "scripts/check-active-surface-inventory.ts", simpleStub("PRE_COMMIT_ACTIVE_SURFACE_INVENTORY_EXIT", "[active-surface-inventory]", " roots=0 graphs=0 runtime=0 commands=0 diagnostics=0"));
  chmodSync(join(repoDir, "scripts", "check-active-surface-inventory.ts"), 0o755);
  ensureFile(repoDir, "scripts/check-phase1-gate-readiness.ts", simpleStub("PRE_COMMIT_PHASE1_GATE_READINESS_EXIT", "[phase1-gate-readiness]", " graph=0 runtime=0 command=0 diagnostics=0")); chmodSync(join(repoDir, "scripts", "check-phase1-gate-readiness.ts"), 0o755);
  ensureFile(repoDir, "scripts/check-phase1-ownership-map.ts", simpleStub("PRE_COMMIT_PHASE1_OWNERSHIP_MAP_EXIT", "[phase1-ownership-map]", " active=0 legacy=0 diagnostics=0")); chmodSync(join(repoDir, "scripts", "check-phase1-ownership-map.ts"), 0o755);
  ensureFile(repoDir, "scripts/check-phase1-burndown-finalization.ts", simpleStub("PRE_COMMIT_PHASE1_BURNDOWN_FINALIZATION_EXIT", "[phase1-burndown-finalization]", " phase1_targets=0 out_of_scope=0 diagnostics=0")); chmodSync(join(repoDir, "scripts", "check-phase1-burndown-finalization.ts"), 0o755);
  ensureFile(repoDir, "scripts/check-command-thinness-enforcement.ts", simpleStub("PRE_COMMIT_COMMAND_THINNESS_EXIT", "[command-thinness-enforcement]", " checked=0 violations=0"));
  chmodSync(join(repoDir, "scripts", "check-command-thinness-enforcement.ts"), 0o755);
  ensureFile(repoDir, "scripts/check-runtime-internal-cli-enforcement.ts", simpleStub("PRE_COMMIT_RUNTIME_INTERNAL_CLI_EXIT", "[runtime-internal-cli]", " checked=0 violations=0"));
  chmodSync(join(repoDir, "scripts", "check-runtime-internal-cli-enforcement.ts"), 0o755);
  ensureFile(repoDir, "scripts/check-structured-io-enforcement.ts", simpleStub("PRE_COMMIT_STRUCTURED_IO_EXIT", "[structured-io-enforcement]", " checked=0 violations=0"));
  chmodSync(join(repoDir, "scripts", "check-structured-io-enforcement.ts"), 0o755);
  ensureFile(repoDir, "scripts/check-shared-ownership-enforcement.ts", simpleStub("PRE_COMMIT_SHARED_OWNERSHIP_EXIT", "[shared-ownership-enforcement]", " checked=0 violations=0"));
  chmodSync(join(repoDir, "scripts", "check-shared-ownership-enforcement.ts"), 0o755);

  seedMissingManifestGateStubs(repoDir);
  initFixtureRepo(repoDir);
  baselineFixtureCommit(repoDir, "fixture baseline");

  for (const stagedPath of stagedPaths) {
    const content = fileContents[stagedPath] ?? defaultStagedFileContent(stagedPath);
    ensureFile(repoDir, stagedPath, content);
  }

  runFixtureGit(repoDir, ["add", "."]);
  return repoDir;
}

function parseJsonLines(path) {
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function runHookCase({ name, stagedPaths, envOverrides = {}, fileContents = {} }) {
  const repoDir = setupRepo({ stagedPaths, fileContents });
  const tempDir = mkdtempSync(join(tmpdir(), "pre-commit-matrix-logs-"));
  const pnpmLogPath = join(tempDir, "npm.log");
  const hatchLogPath = join(tempDir, "hatch.log");
  const lintDotLogPath = join(tempDir, "lint-dot.log");
  const coverageLogPath = join(tempDir, "coverage.log");
  const workspaceCoverageLogPath = join(tempDir, "workspace-coverage.log");
  const coveragePolicyLogPath = join(tempDir, "coverage-policy.log");
  const runtimeStartupProbeLogPath = join(tempDir, "runtime-startup-probe.log");
  const benchmarkJobIdRegistryLogPath = join(tempDir, "benchmark-job-id-registry.log");
  const contextPropagationContractLogPath = join(tempDir, "context-propagation-contract.log");
  const pipelineSegmentCoverageLogPath = join(tempDir, "pipeline-segment-coverage.log");
  const degenerateStateGuardsLogPath = join(tempDir, "degenerate-state-guards.log");

  const env = {
    ...process.env,
    PATH: `${npmStubBinDir}${delimiter}${process.env.PATH ?? ""}`,
    PRE_COMMIT_NPM_STUB_LOG: pnpmLogPath,
    PRE_COMMIT_HATCH_STUB_LOG: hatchLogPath,
    PRE_COMMIT_LINT_DOT_STUB_LOG: lintDotLogPath,
    PRE_COMMIT_BUILD_EXIT: "0",
    PRE_COMMIT_TYPECHECK_EXIT: "0",
    PRE_COMMIT_TEST_GUARD_GATES_EXIT: "0",
    PRE_COMMIT_TEST_WAVE_CLAIM_GATES_EXIT: "0",
    PRE_COMMIT_DOCS_CHECK_EXIT: "0",
    PRE_COMMIT_HATCH_EXIT: "0",
    PRE_COMMIT_LOCKFILE_SYNC_EXIT: "0",
    PRE_COMMIT_EXPORT_COVERAGE_EXIT: "0",
    PRE_COMMIT_EXPORT_COVERAGE_STUB_LOG: coverageLogPath,
    PRE_COMMIT_WORKSPACE_EXPORT_COVERAGE_EXIT: "0",
    PRE_COMMIT_WORKSPACE_EXPORT_COVERAGE_STUB_LOG: workspaceCoverageLogPath,
    PRE_COMMIT_COVERAGE_POLICY_EXIT: "0",
    PRE_COMMIT_COVERAGE_POLICY_STUB_LOG: coveragePolicyLogPath,
    PRE_COMMIT_RUNTIME_STARTUP_PROBE_EXIT: "0",
    PRE_COMMIT_RUNTIME_STARTUP_PROBE_STUB_LOG: runtimeStartupProbeLogPath,
    PRE_COMMIT_BENCHMARK_JOB_ID_REGISTRY_EXIT: "0",
    PRE_COMMIT_BENCHMARK_JOB_ID_REGISTRY_STUB_LOG: benchmarkJobIdRegistryLogPath,
    PRE_COMMIT_CONTEXT_PROPAGATION_CONTRACT_EXIT: "0",
    PRE_COMMIT_CONTEXT_PROPAGATION_CONTRACT_STUB_LOG: contextPropagationContractLogPath,
    PIPELINE_SEGMENT_COVERAGE_FORCE_EXIT: "0",
    PRE_COMMIT_PIPELINE_SEGMENT_COVERAGE_STUB_LOG: pipelineSegmentCoverageLogPath,
    PRE_COMMIT_DEGENERATE_STATE_GUARDS_EXIT: "0",
    PRE_COMMIT_DEGENERATE_STATE_GUARDS_STUB_LOG: degenerateStateGuardsLogPath,
    PRE_COMMIT_LINT_DOT_EXIT: "0",
    PRE_COMMIT_LINT_DOT_STDOUT: "",
    PRE_COMMIT_LINT_DOT_STDERR: "",
    PRE_COMMIT_LINT_DOT_DEFAULT_MARKER: formatLintDotSummary({
      result: LINT_DOT_RESULT.ok,
      target: "",
      diagnostics: 0,
      errors: 0,
      warnings: 0,
    }),
    IRREVERSIBLE_NODE_COVERAGE_MANIFEST: join(repoDir, "scripts", "lib", "test-irreversible-node-coverage-manifest.mjs"),
    ...envOverrides,
  };

  const started = process.hrtime.bigint();
  const run = spawnSync("bash", [".githooks/pre-commit"], {
    cwd: repoDir,
    env,
    encoding: "utf8",
    timeout: CASE_TIMEOUT_MS,
  });
  const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;

  assert.notEqual(
    run.error?.code,
    "ETIMEDOUT",
    `Case '${name}' exceeded timeout budget of ${CASE_TIMEOUT_MS}ms`,
  );
  assert.ok(
    durationMs <= CASE_TIMEOUT_MS,
    `Case '${name}' exceeded runtime budget (${durationMs.toFixed(2)}ms > ${CASE_TIMEOUT_MS}ms)`,
  );

  const pnpmInvocations = parseJsonLines(pnpmLogPath);
  const hatchCalls = existsSync(hatchLogPath)
    ? readFileSync(hatchLogPath, "utf8").trim().split("\n").filter(Boolean)
    : [];
  const lintDotCalls = existsSync(lintDotLogPath)
    ? readFileSync(lintDotLogPath, "utf8").trim().split("\n").filter(Boolean)
    : [];
  const coverageCalls = existsSync(coverageLogPath)
    ? readFileSync(coverageLogPath, "utf8").trim().split("\n").filter(Boolean)
    : [];
  const workspaceCoverageCalls = existsSync(workspaceCoverageLogPath)
    ? readFileSync(workspaceCoverageLogPath, "utf8").trim().split("\n").filter(Boolean)
    : [];
  const coveragePolicyCalls = existsSync(coveragePolicyLogPath)
    ? readFileSync(coveragePolicyLogPath, "utf8").trim().split("\n").filter(Boolean)
    : [];
  const contextPropagationContractCalls = existsSync(contextPropagationContractLogPath)
    ? readFileSync(contextPropagationContractLogPath, "utf8").trim().split("\n").filter(Boolean)
    : [];
  const pipelineSegmentCoverageCalls = existsSync(pipelineSegmentCoverageLogPath)
    ? readFileSync(pipelineSegmentCoverageLogPath, "utf8").trim().split("\n").filter(Boolean)
    : [];
  const degenerateStateGuardsCalls = existsSync(degenerateStateGuardsLogPath)
    ? readFileSync(degenerateStateGuardsLogPath, "utf8").trim().split("\n").filter(Boolean)
    : [];

  const hookLogPath = join(repoDir, ".hook-logs", "pre-commit.log");
  const hookLog = existsSync(hookLogPath)
    ? readFileSync(hookLogPath, "utf8")
    : "";

  return {
    run,
    repoDir,
    pnpmInvocations,
    hatchCalls,
    lintDotCalls,
    coverageCalls,
    workspaceCoverageCalls,
    coveragePolicyCalls,
    contextPropagationContractCalls,
    pipelineSegmentCoverageCalls,
    degenerateStateGuardsCalls,
    stdout: `${hookLog}${run.stdout}`,
    stderr: `${hookLog}${run.stderr}`,
    output: `${hookLog}${run.stdout}${run.stderr}`,
  };
}

function assertNpmScripts(invocations, expectedScripts, expectedCwd) {
  assert.deepEqual(invocations.map((entry) => entry.script), expectedScripts);
  for (const invocation of invocations) {
    assert.equal(invocation.executable, "pnpm");
    assert.equal(realpathSync(invocation.cwd), realpathSync(expectedCwd));
    assert.ok(
      JSON.stringify(invocation.argv) === JSON.stringify(invocation.script.startsWith("test:platform:")
        ? ["run", "--silent", invocation.script]
        : GATE_MANIFEST.find((gate) => gate.command === "pnpm" && gate.args.includes(invocation.script))?.args),
      `expected pnpm argv to include script ${invocation.script}: ${invocation.argv.join(" ")}`,
    );
  }
}

function assertOutputOrder(output, orderedMarkers) {
  let previousIndex = -1;
  for (const marker of orderedMarkers) {
    const index = output.indexOf(marker);
    assert.ok(index >= 0, `Missing output marker: ${marker}`);
    assert.ok(index > previousIndex, `Output marker out of order: ${marker}`);
    previousIndex = index;
  }
}

// Contract guard: issue #409 wiring must remain present for the matrix suite.
test("prerequisite: packages/factory-ops package exposes a typecheck script", () => {
  const opsPackagePath = join(repoRoot, FACTORY_OPS_WORKSPACE, "package.json");
  const pkg = JSON.parse(readFileSync(opsPackagePath, "utf8"));
  const script = pkg?.scripts?.typecheck;

  assert.equal(
    typeof script,
    "string",
    `Missing prerequisite: ${FACTORY_OPS_WORKSPACE}/package.json scripts.typecheck`,
  );
  assert.match(
    script,
    /node --check/,
    `Missing prerequisite: ${FACTORY_OPS_WORKSPACE} typecheck must run a deterministic node --check contract`,
  );
});

// Contract message strings are intentionally strict. Update only with explicit contract changes.
test("matrix case 1: docs-only stays docs-only and skips test suites deterministically", () => {
  const result = runHookCase({
    name: "docs_only",
    stagedPaths: ["docs/guide.md"],
  });

  assert.equal(result.run.status, 0);
  assertNpmScripts(result.pnpmInvocations, ["docs:check", "build", "typecheck"], result.repoDir);
  assert.deepEqual(result.hatchCalls, []);
  assertOutputOrder(result.stdout, [
    "Checking docs policy scope",
    "gate_start gate=build",
    "gate_start gate=typecheck",
    "test_suites_decision action=skip reason=docs_only",
  ]);
  assert.match(result.stdout, /test_suite_skip suite=test:guard-gates reason=docs_only/);
  assert.match(result.stdout, /test_suite_skip suite=test:wave-claim-gates reason=docs_only/);
});

test("matrix case 2: dot-only validates DOT, runs lint-dot, then skips suites with dot_only reason", () => {
  const result = runHookCase({
    name: "dot_only",
    stagedPaths: [MOTHERSHIP_WAVE_EXECUTE_DOT],
  });

  assert.equal(result.run.status, 0);
  assertNpmScripts(result.pnpmInvocations, ["build", ...DOT_DOTFILE_PLATFORM_INVARIANT_NPM_SCRIPTS, ...RELEASE_QUALITY_NPM_SCRIPTS, "typecheck"], result.repoDir);
  assert.match(result.stdout, /\[pre-commit\] gate_start gate=release_quality family=recovery_graph_invariants/);
  assert.equal(result.hatchCalls.length, 1);
  assert.match(result.hatchCalls[0], /^validate docs\/contracts\/workflow-ir\/mothership\/wave_execute\.dot$/);
  assert.equal(result.lintDotCalls.length, 1);
  assert.equal(result.lintDotCalls[0], MOTHERSHIP_WAVE_EXECUTE_DOT);
  assert.equal(result.contextPropagationContractCalls.length, 1);
  assert.match(result.contextPropagationContractCalls[0], /--staged-file-list\s+\S*staged-files\.list/);
  assert.match(result.stderr, new RegExp(`\\${LINT_DOT_MARKER_PREFIX} result=${LINT_DOT_RESULT.ok}`));
  assert.match(result.stdout, /test_suites_decision action=skip reason=dot_only/);
  assert.match(result.stdout, /test_suite_skip suite=test:guard-gates reason=dot_only/);
  assert.match(result.stdout, /test_suite_skip suite=test:wave-claim-gates reason=dot_only/);
});

test("matrix case 3: docs+dot-only runs dot preflight and skips suites with docs_or_dot_only", () => {
  const result = runHookCase({
    name: "docs_dot_only",
    stagedPaths: ["docs/guide.md", MOTHERSHIP_WAVE_EXECUTE_DOT],
  });

  assert.equal(result.run.status, 0);
  assertNpmScripts(result.pnpmInvocations, ["docs:check", "build", ...DOT_DOTFILE_PLATFORM_INVARIANT_NPM_SCRIPTS, ...RELEASE_QUALITY_NPM_SCRIPTS, "typecheck"], result.repoDir);
  assert.match(result.stdout, /\[pre-commit\] gate_start gate=release_quality family=recovery_graph_invariants/);
  assert.equal(result.hatchCalls.length, 1);
  assert.equal(result.lintDotCalls.length, 1);
  assert.equal(result.contextPropagationContractCalls.length, 1);
  assert.match(result.contextPropagationContractCalls[0], /--staged-file-list\s+\S*staged-files\.list/);
  assert.match(result.stdout, /test_suites_decision action=skip reason=docs_or_dot_only/);
  assert.match(result.stdout, /test_suite_skip suite=test:guard-gates reason=docs_or_dot_only/);
  assert.match(result.stdout, /test_suite_skip suite=test:wave-claim-gates reason=docs_or_dot_only/);
});

test("matrix case 4: policy-scoped docs run docs:check then mandatory quality gates", () => {
  const result = runHookCase({
    name: "state_machine_docs",
    stagedPaths: ["docs/state-machines.md"],
  });

  assert.equal(result.run.status, 0);
  assertNpmScripts(result.pnpmInvocations, ["docs:check", "build", "typecheck"], result.repoDir);
  assert.match(result.stdout, /Checking docs policy scope/);
  assert.match(result.stdout, /test_suites_decision action=skip reason=docs_only/);
  assertOutputOrder(result.stdout, [
    "Checking docs policy scope",
    "gate_start gate=build",
    "gate_start gate=typecheck",
  ]);
});

test("matrix case 4b: malformed docs policy stages still fail through docs_check telemetry", () => {
  const result = runHookCase({
    name: "malformed_docs_policy",
    stagedPaths: ["docs/docs-policy.json"],
    fileContents: {
      "docs/docs-policy.json": "{\n  \"docs_policy/v1\": {\n",
    },
    envOverrides: {
      PRE_COMMIT_DOCS_CHECK_EXIT: "14",
    },
  });

  assert.equal(result.run.status, 14);
  assertNpmScripts(result.pnpmInvocations, ["docs:check"], result.repoDir);
  assert.match(result.stdout, /Checking docs policy scope/);
  assert.match(result.stderr, /first_failure phase=docs_check target=docs:check exit=14/);
  assert.doesNotMatch(result.output, /gate_start gate=build/);
});

test("matrix case 4f: docs policy validator source changes trigger docs:check + platform invariants", () => {
  const result = runHookCase({
    name: "docs_policy_validator_dependency",
    stagedPaths: ["scripts/lib/docs-policy-validator.ts"],
    fileContents: {
      "scripts/lib/docs-policy-validator.ts": `${readFileSync(sourceDocsPolicyValidatorPath, "utf8")}\n// staged change\n`,
    },
  });

  assert.equal(result.run.status, 0);
  assertNpmScripts(result.pnpmInvocations, ["docs:check", "build", ...RELEASE_QUALITY_NPM_SCRIPTS, "typecheck"], result.repoDir);
  assert.match(result.stdout, /Checking docs policy scope/);
  assert.match(result.stdout, /\[pre-commit\] gate_start gate=release_quality family=core_invariants/);
  assert.match(result.stdout, /test_suites_decision action=skip reason=platform_invariant_trigger/);
});

test("matrix case 4e: policy-scoped root docs path triggers docs:check", () => {
  const result = runHookCase({
    name: "policy_root_docs_path",
    stagedPaths: ["AGENTS.md"],
  });

  assert.equal(result.run.status, 0);
  assertNpmScripts(result.pnpmInvocations, ["docs:check", "build", "typecheck"], result.repoDir);
  assert.match(result.stdout, /Checking docs policy scope/);
  assert.match(result.stdout, /test_suites_decision action=skip reason=docs_only/);
});

test("matrix case 5: hatch-scoped code change routes to guard-only suite", () => {
  const result = runHookCase({
    name: "guard_only_bucket",
    stagedPaths: ["apps/hatch/src/cli.ts"],
  });

  assert.equal(result.run.status, 0);
  assertNpmScripts(result.pnpmInvocations, ["build", "typecheck", "test:guard-gates"], result.repoDir);
  assert.match(result.stdout, /test_suites_decision action=run reason=bucket_guard_only bucket=guard_only selection=guard_only/);
  assert.match(result.stdout, /test_suite_start suite=test:guard-gates command="pnpm test:guard-gates[^"]*"/);
  assert.match(result.stdout, /test_suite_skip suite=test:wave-claim-gates reason=not_selected_by_bucket bucket=guard_only/);
});

test("matrix case 6: mixed hatch+ops change runs both suites (no short-circuit)", () => {
  const result = runHookCase({
    name: "overlap_bucket",
    stagedPaths: ["apps/hatch/src/cli.ts", `${FACTORY_OPS_WORKSPACE}/src/cli/commands/wave.ts`],
  });

  assert.equal(result.run.status, 0);
  assertNpmScripts(
    result.pnpmInvocations,
    ["build", "typecheck", "test:guard-gates", "test:wave-claim-gates"],
    result.repoDir,
  );
  assert.match(result.stdout, /test_suites_decision action=run reason=bucket_overlap_guard_wave bucket=all_suites/);
  assertOutputOrder(result.stdout, [
    "gate_start gate=build",
    "gate_start gate=typecheck",
    "test_suite_start suite=test:guard-gates",
    "test_suite_start suite=test:wave-claim-gates",
  ]);
});

test("matrix case 6a: non-wave factory-ops change routes to guard-only suite", () => {
  const result = runHookCase({
    name: "factory_ops_non_wave_guard_bucket",
    stagedPaths: [`${FACTORY_OPS_WORKSPACE}/src/cli.ts`],
  });

  assert.equal(result.run.status, 0);
  assertNpmScripts(result.pnpmInvocations, ["build", "typecheck", "test:guard-gates"], result.repoDir);
  assert.match(result.stdout, /test_suites_decision action=run reason=bucket_guard_only bucket=guard_only selection=guard_only/);
  assert.match(result.stdout, /test_suite_start suite=test:guard-gates/);
  assert.match(result.stdout, /test_suite_skip suite=test:wave-claim-gates reason=not_selected_by_bucket bucket=guard_only/);
});

test("matrix case 6b: factory portability path runs invariant gate and skips selective suites", () => {
  const result = runHookCase({
    name: "factory_portability_platform_bucket",
    stagedPaths: ["packages/factory-ops/src/lib/factory-context-resolver.ts"],
  });

  assert.equal(result.run.status, 0);
  assertNpmScripts(result.pnpmInvocations, ["build", ...RELEASE_QUALITY_NPM_SCRIPTS, "typecheck"], result.repoDir);
  assert.match(result.stdout, /\[pre-commit\] gate_start gate=release_quality family=external_factory_portability/);
  assert.match(result.stdout, /test_suites_decision action=skip reason=platform_invariant_trigger/);
  assert.match(result.stdout, /test_suite_skip suite=test:guard-gates reason=platform_invariant_trigger/);
  assert.match(result.stdout, /test_suite_skip suite=test:wave-claim-gates reason=platform_invariant_trigger/);
});

test("matrix case 7: no staged paths emits deterministic skip-all markers", () => {
  const result = runHookCase({
    name: "no_staged_paths",
    stagedPaths: [],
  });

  assert.equal(result.run.status, 0);
  assertNpmScripts(result.pnpmInvocations, [], result.repoDir);
  assert.deepEqual(result.hatchCalls, []);
  assert.match(result.stdout, /gates_skipped branch=empty reason=no_staged_paths/);
  assert.match(result.stdout, /test_suites_decision action=skip reason=no_staged_paths/);
  assert.match(result.stdout, /test_suite_skip suite=test:guard-gates reason=no_staged_paths/);
  assert.match(result.stdout, /test_suite_skip suite=test:wave-claim-gates reason=no_staged_paths/);
});

test("matrix case 8: deterministic dot validation failure is fail-stop", () => {
  const result = runHookCase({
    name: "dot_validation_failure",
    stagedPaths: [MOTHERSHIP_WAVE_EXECUTE_DOT],
    envOverrides: {
      PRE_COMMIT_HATCH_EXIT: "13",
    },
  });

  assert.equal(result.run.status, 13);
  assertNpmScripts(result.pnpmInvocations, [], result.repoDir);
  assert.match(result.stderr, /first_failure phase=dot_validate target=docs\/contracts\/workflow-ir\/mothership\/wave_execute\.dot exit=13/);
  assert.doesNotMatch(result.output, /gate_start gate=build/);
  assert.doesNotMatch(result.output, /test_suite_start suite=/);
});

test("matrix case 9: deterministic lint-dot failure is fail-stop", () => {
  const result = runHookCase({
    name: "lint_dot_failure",
    stagedPaths: [MOTHERSHIP_WAVE_EXECUTE_DOT],
    envOverrides: {
      PRE_COMMIT_LINT_DOT_STDERR: formatLintDotSummary({
        result: LINT_DOT_RESULT.fail,
        target: MOTHERSHIP_WAVE_EXECUTE_DOT,
        diagnostics: 1,
        errors: 1,
        warnings: 0,
      }),
      PRE_COMMIT_LINT_DOT_EXIT: "19",
    },
  });

  assert.equal(result.run.status, 19);
  assertNpmScripts(result.pnpmInvocations, [], result.repoDir);
  assert.match(result.stderr, new RegExp(`\\${LINT_DOT_MARKER_PREFIX} result=${LINT_DOT_RESULT.fail}`));
  assert.match(result.stderr, /first_failure phase=dot_validate target=docs\/contracts\/workflow-ir\/mothership\/wave_execute\.dot exit=19/);
  assert.doesNotMatch(result.output, /gate_start gate=build/);
  assert.doesNotMatch(result.output, /test_suite_start suite=/);
});

test("matrix case 10: lint-dot warning-only output remains non-blocking", () => {
  const warningPayload = JSON.stringify([
    {
      file: MOTHERSHIP_WAVE_EXECUTE_DOT,
      severity: "warning",
      rule_id: "context_flow.unused_output_key",
      message: "warning-only test",
      line: 3,
      column: 1,
      node: "n1",
    },
  ]);

  const result = runHookCase({
    name: "lint_dot_warning_only",
    stagedPaths: [MOTHERSHIP_WAVE_EXECUTE_DOT],
    envOverrides: {
      PRE_COMMIT_LINT_DOT_STDOUT: warningPayload,
      PRE_COMMIT_LINT_DOT_STDERR: formatLintDotSummary({
        result: LINT_DOT_RESULT.warningOnly,
        target: MOTHERSHIP_WAVE_EXECUTE_DOT,
        diagnostics: 1,
        errors: 0,
        warnings: 1,
      }),
      PRE_COMMIT_LINT_DOT_EXIT: "0",
    },
  });

  assert.equal(result.run.status, 0, result.output);
  assertNpmScripts(result.pnpmInvocations, ["build", ...DOT_DOTFILE_PLATFORM_INVARIANT_NPM_SCRIPTS, ...RELEASE_QUALITY_NPM_SCRIPTS, "typecheck"], result.repoDir);
  assert.match(result.stdout, /\[pre-commit\] gate_start gate=release_quality family=recovery_graph_invariants/);
  assert.match(result.stderr, new RegExp(`\\${LINT_DOT_MARKER_PREFIX} result=${LINT_DOT_RESULT.warningOnly}`));
  assert.match(result.stdout, /test_suites_decision action=skip reason=dot_only/);
  assert.doesNotMatch(result.stderr, /first_failure phase=dot_validate/);
});

test("matrix case 10b: benchmark job_id registry gate runs after dot validation when triggered", () => {
  const result = runHookCase({
    name: "benchmark_job_id_registry_trigger",
    stagedPaths: [MOTHERSHIP_WAVE_EXECUTE_DOT],
  });

  assert.equal(result.run.status, 0, result.output);
  assert.match(result.output, /Checking benchmark job_id registry/);
  assert.match(result.output, /\[benchmark-job-id-registry\] result=ok/);
  assertOutputOrder(result.output, [
    "Validating docs/contracts/workflow-ir/mothership/wave_execute.dot",
    "[context_propagation_contract] result=ok",
    "Checking benchmark job_id registry",
    "gate_start gate=platform_invariants",
  ]);
});

test("matrix case 10d: handler source path triggers context propagation contract without dot edits", () => {
  const result = runHookCase({
    name: "context_propagation_contract_handler_trigger",
    stagedPaths: ["apps/hatch/src/pipeline/handler/worktree.ts"],
  });

  assert.equal(result.run.status, 0, result.output);
  assert.equal(result.contextPropagationContractCalls.length, 1);
  assert.match(result.contextPropagationContractCalls[0], /--staged-file-list\s+\S*staged-files\.list/);
  assert.match(result.output, /\[context_propagation_contract\] result=ok/);
  assert.doesNotMatch(result.output, /Validating factories\/mothership\/graphs\//);
});

test("matrix case 10e: context propagation contract failure records first_failure and skips non-preflight gates", () => {
  const result = runHookCase({
    name: "context_propagation_contract_failure",
    stagedPaths: [MOTHERSHIP_WAVE_EXECUTE_DOT],
    envOverrides: {
      PRE_COMMIT_CONTEXT_PROPAGATION_CONTRACT_EXIT: "33",
    },
  });

  assert.equal(result.run.status, 33, result.output);
  assert.match(result.stderr, /first_failure phase=context_propagation_contract target=check-context-propagation-contract exit=33/);
  assert.match(result.output, /\[pipeline_segment_coverage\] result=ok/);
  assert.match(result.output, /Checking benchmark job_id registry/);
  assert.doesNotMatch(result.output, /gate_start gate=platform_invariants/);
});

test("matrix case 10f: pipeline segment coverage gate runs for packages paths", () => {
  const result = runHookCase({
    name: "pipeline_segment_coverage_packages_trigger",
    stagedPaths: ["packages/factory-ops/test/wave-claim-gates.integration.test.mjs"],
  });

  assert.equal(result.run.status, 0, result.output);
  assert.equal(result.pipelineSegmentCoverageCalls.length, 1);
  assert.match(result.pipelineSegmentCoverageCalls[0], /--staged-file-list\s+\S*staged-files\.list/);
  assert.match(result.output, /\[pipeline_segment_coverage\] result=ok covered=0 uncovered=0 mode=stub/);
  assert.equal(result.degenerateStateGuardsCalls.length, 1);
  assert.match(result.degenerateStateGuardsCalls[0], /--staged-file-list\s+\S*staged-files\.list/);
  assert.match(result.output, /\[degenerate_state_guards\] result=ok guarded=3 unguarded=0/);
  assertOutputOrder(result.output, [
    "[pipeline_segment_coverage] result=ok",
    "[degenerate_state_guards] result=ok",
    "gate_start gate=build",
  ]);
});

test("matrix case 10g: pipeline segment coverage gate runs for dot paths", () => {
  const result = runHookCase({
    name: "pipeline_segment_coverage_dot_trigger",
    stagedPaths: [MOTHERSHIP_WAVE_EXECUTE_DOT],
  });

  assert.equal(result.run.status, 0, result.output);
  assert.equal(result.pipelineSegmentCoverageCalls.length, 1);
  assert.match(result.pipelineSegmentCoverageCalls[0], /--staged-file-list\s+\S*staged-files\.list/);
  assert.match(result.output, /\[pipeline_segment_coverage\] result=ok covered=0 uncovered=0 mode=stub/);
  assert.equal(result.degenerateStateGuardsCalls.length, 1);
  assert.match(result.degenerateStateGuardsCalls[0], /--staged-file-list\s+\S*staged-files\.list/);
  assert.match(result.output, /\[degenerate_state_guards\] result=ok guarded=3 unguarded=0/);
});

test("matrix case 10h: pipeline segment coverage failure records first_failure and skips non-preflight gates", () => {
  const result = runHookCase({
    name: "pipeline_segment_coverage_failure",
    stagedPaths: ["packages/factory-ops/test/wave-claim-gates.integration.test.mjs"],
    envOverrides: {
      PIPELINE_SEGMENT_COVERAGE_FORCE_EXIT: "34",
    },
  });

  assert.equal(result.run.status, 34, result.output);
  assert.match(result.output, /\[pipeline_segment_coverage\] result=fail covered=0 uncovered=0 mode=stub/);
  assert.match(result.stderr, /first_failure phase=pipeline_segment_coverage target=check-pipeline-segment-coverage exit=34/);
  assert.equal(result.degenerateStateGuardsCalls.length, 1);
  assert.doesNotMatch(result.output, /gate_start gate=build/);
  assert.doesNotMatch(result.output, /gate_start gate=platform_invariants/);
});

test("matrix case 10i: degenerate_state_guards failure is fail-stop before build", () => {
  const result = runHookCase({
    name: "degenerate_state_guards_failure",
    stagedPaths: ["packages/factory-ops/src/commands/wave-split-results.ts"],
    envOverrides: {
      PRE_COMMIT_DEGENERATE_STATE_GUARDS_EXIT: "35",
    },
  });

  assert.equal(result.run.status, 35, result.output);
  assert.equal(result.degenerateStateGuardsCalls.length, 1);
  assert.match(result.output, /\[degenerate_state_guards\] result=fail guarded=3 unguarded=1/);
  assert.match(result.stderr, /first_failure phase=degenerate_state_guards target=check-degenerate-state-guards exit=35/);
  assert.doesNotMatch(result.output, /gate_start gate=build/);
});

test("matrix case 10c: benchmark job_id registry failure is fail-stop", () => {
  const result = runHookCase({
    name: "benchmark_job_id_registry_failure",
    stagedPaths: ["docs/contracts/benchmark-job-id-registry.json"],
    fileContents: {
      "docs/contracts/benchmark-job-id-registry.json": "{}\n",
    },
    envOverrides: {
      PRE_COMMIT_BENCHMARK_JOB_ID_REGISTRY_EXIT: "23",
    },
  });

  assert.equal(result.run.status, 23, result.output);
  assert.match(result.output, /Checking benchmark job_id registry/);
  assert.match(result.stderr, /first_failure phase=benchmark_job_id_registry target=check-benchmark-job-id-registry exit=23/);
  assert.doesNotMatch(result.output, /gate_start gate=build/);
});

test("matrix case 11: mixed dot+code runs dot preflight and routes by code bucket", () => {
  const result = runHookCase({
    name: "dot_plus_code_guard_bucket",
    stagedPaths: [MOTHERSHIP_WAVE_EXECUTE_DOT, "apps/hatch/src/cli.ts"],
  });

  assert.equal(result.run.status, 0, result.output);
  assert.equal(result.hatchCalls.length, 1);
  assert.equal(result.lintDotCalls.length, 1);
  assert.equal(result.contextPropagationContractCalls.length, 1);
  assert.match(result.contextPropagationContractCalls[0], /--staged-file-list\s+\S*staged-files\.list/);
  assertNpmScripts(result.pnpmInvocations, ["build", ...DOT_DOTFILE_PLATFORM_INVARIANT_NPM_SCRIPTS, ...RELEASE_QUALITY_NPM_SCRIPTS, "typecheck", "test:guard-gates"], result.repoDir);
  assert.match(result.stdout, /test_suites_decision action=run reason=bucket_guard_only bucket=guard_only selection=guard_only/);
  assert.match(result.stdout, /test_suite_skip suite=test:wave-claim-gates reason=not_selected_by_bucket bucket=guard_only/);
});

test("matrix case 12: ops command change triggers export coverage check", () => {
  const result = runHookCase({
    name: "ops_export_coverage",
    stagedPaths: [`${FACTORY_OPS_WORKSPACE}/src/commands/wave-split-results.ts`],
  });

  assert.equal(result.run.status, 0, result.output);
  assert.equal(result.coverageCalls.length, 1, "export coverage check should run");
  assert.match(result.stdout, /Checking export coverage/);
  assertOutputOrder(result.stdout, [
    "Checking export coverage",
    "[export-coverage] result=ok",
    "gate_start gate=build",
    "gate_start gate=typecheck",
  ]);
});

test("matrix case 13: non-ops change does NOT trigger export coverage check", () => {
  const result = runHookCase({
    name: "no_ops_export_coverage",
    stagedPaths: ["apps/hatch/src/cli.ts"],
  });

  assert.equal(result.run.status, 0, result.output);
  assert.equal(result.coverageCalls.length, 0, "export coverage check should NOT run for non-ops paths");
  assert.doesNotMatch(result.stdout, /Checking export coverage/);
});

test("matrix case 14: export coverage failure is fail-stop", () => {
  const result = runHookCase({
    name: "export_coverage_failure",
    stagedPaths: [`${FACTORY_OPS_WORKSPACE}/src/commands/wave-split-results.ts`],
    envOverrides: {
      PRE_COMMIT_EXPORT_COVERAGE_EXIT: "1",
    },
  });

  assert.equal(result.run.status, 1);
  assert.equal(result.coverageCalls.length, 1);
  assert.match(result.stderr, /first_failure phase=export_coverage target=check-export-coverage exit=1/);
  assert.doesNotMatch(result.output, /gate_start gate=build/);
  assert.doesNotMatch(result.output, /test_suite_start suite=/);
});

test("matrix case 15: scripts path triggers release quality and platform skip reason", () => {
  const result = runHookCase({
    name: "platform_scripts_trigger",
    stagedPaths: ["scripts/foo.js"],
  });

  assert.equal(result.run.status, 0, result.output);
  assertNpmScripts(result.pnpmInvocations, ["build", ...RELEASE_QUALITY_NPM_SCRIPTS, "typecheck"], result.repoDir);
  assert.match(result.stdout, /\[pre-commit\] gate_start gate=release_quality family=core_invariants/);
  assert.match(result.stdout, /test_suites_decision action=skip reason=platform_invariant_trigger/);
});

test("matrix case 15a: public-contract path triggers factory_public_contract invariant", () => {
  const result = runHookCase({
    name: "public_contract_trigger",
    stagedPaths: ["docs/contracts/factory-public-contract.v1.json"],
  });

  assert.equal(result.run.status, 0, result.output);
  assertNpmScripts(result.pnpmInvocations, ["docs:check", "build", "test:platform:factory-public-contract", "typecheck"], result.repoDir);
  assert.match(result.stdout, /\[pre-commit\] gate_start gate=platform_invariants invariant=factory_public_contract/);
  assert.doesNotMatch(result.stdout, /\[pre-commit\] gate_start gate=release_quality family=/);
  assert.match(result.stdout, /test_suites_decision action=skip reason=docs_only/);
});
test("matrix case 15b: coverage policy path triggers coverage policy ratchet", () => {
  const result = runHookCase({
    name: "coverage_policy_path",
    stagedPaths: ["apps/hatch/vitest.config.ts"],
  });

  assert.equal(result.run.status, 0, result.output);
  assert.deepEqual(result.coveragePolicyCalls, ["check-coverage-policy-ratchet"]);
  assert.match(result.stdout, /Checking coverage policy/);
  assertOutputOrder(result.stdout, [
    "Checking coverage policy",
    "[coverage-policy] result=ok",
    "gate_start gate=build",
  ]);
});

test("matrix case 15c: coverage policy failure is fail-stop", () => {
  const result = runHookCase({
    name: "coverage_policy_failure",
    stagedPaths: ["packages/factory-ops/package.json"],
    envOverrides: {
      PRE_COMMIT_COVERAGE_POLICY_EXIT: "1",
    },
  });

  assert.equal(result.run.status, 1, result.output);
  assert.deepEqual(result.coveragePolicyCalls, ["check-coverage-policy-ratchet"]);
  assert.match(result.stderr, /first_failure phase=coverage_policy target=check-coverage-policy-ratchet exit=1/);
  assert.doesNotMatch(result.output, /gate_start gate=build/);
});

test("matrix case 16: .githooks changes trigger release quality", () => {
  const result = runHookCase({
    name: "platform_githooks_trigger",
    stagedPaths: [".githooks/pre-commit"],
    fileContents: {
      ".githooks/pre-commit": `${readFileSync(sourceHookPath, "utf8")}\n# staged platform trigger\n`,
    },
  });

  assert.equal(result.run.status, 0, result.output);
  assertNpmScripts(result.pnpmInvocations, ["build", ...RELEASE_QUALITY_NPM_SCRIPTS, "typecheck"], result.repoDir);
  assert.match(result.stdout, /\[pre-commit\] gate_start gate=release_quality family=core_invariants/);
  assert.match(result.stdout, /test_suites_decision action=skip reason=platform_invariant_trigger/);
});

test("matrix case 17: release quality gate failure emits deterministic first_failure telemetry", () => {
  const result = runHookCase({
    name: "platform_gate_failure",
    stagedPaths: ["scripts/foo.js"],
    envOverrides: {
      PRE_COMMIT_TEST_PLATFORM_CLI_CONTEXT_PORTABILITY_EXIT: "27",
    },
  });

  assert.equal(result.run.status, 27);
  assertNpmScripts(result.pnpmInvocations, ["build", "test:platform:cli-context-portability", "test:platform:cli-context-portability"], result.repoDir);
  assert.match(result.stdout, /gate_retry gate=release_quality family=core_invariants attempt=1/);
  assert.match(result.stderr, /first_failure phase=quality_gate target=release_quality family=core_invariants/);
  assertOutputOrder(result.output, ["gate_pass gate=build", "gate_start gate=release_quality"]);
  assert.doesNotMatch(result.output, /gate_start gate=typecheck/);
});

test("contract: AGENTS.md documents release_quality gate in troubleshooting table", { skip: true }, () => {
  const agentsPath = join(repoRoot, "AGENTS.md");
  const agentsMd = readFileSync(agentsPath, "utf8");
  assert.ok(agentsMd.includes("release_quality"), "AGENTS.md must document the release_quality gate (troubleshooting table entry missing)");
  assert.ok(agentsMd.includes("first_failure phase=quality_gate target=release_quality"), "AGENTS.md troubleshooting table must contain the release_quality first_failure signal");
  assert.ok(agentsMd.includes("run-platform-invariant-gates.mjs --gate release_quality"), "AGENTS.md troubleshooting remediation must reference the release_quality gate command");
});

after(() => {
  const elapsedMs = Date.now() - suiteStartMs;
  assert.ok(elapsedMs <= SUITE_BUDGET_MS, `pre-commit gate matrix suite exceeded runtime budget (${elapsedMs}ms > ${SUITE_BUDGET_MS}ms)`);
});
