import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { formatLintDotSummary, LINT_DOT_MARKER_PREFIX, LINT_DOT_RESULT } from "./lib/lint-dot-contract.ts";

import { defaultStagedFileContent } from "./test/helpers/control-plane-fixture-content.mjs";
import { ensureFile, simpleStub } from "./test/helpers/fixture-files.mjs";
import { baselineFixtureCommit, initFixtureRepo, runFixtureGit } from "./test/helpers/git-fixture.mjs";
const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");
const sourceHookPath = join(repoRoot, ".githooks", "pre-commit");
const sourceClassifierPath = join(repoRoot, "scripts", "pre-commit-staged-file-classifier.mjs");
const sourceRunGatesPath = join(repoRoot, "scripts", "run-gates.mjs");
const sourcePlatformInvariantRunnerPath = join(repoRoot, "scripts", "run-platform-invariant-gates.mjs");
const sourceLineLimitCheckerPath = join(repoRoot, "scripts", "check-line-limit.mjs");
const sourceHatchArtifactBoundaryCheckerPath = join(repoRoot, "scripts", "check-hatch-artifact-boundary.mjs");
const sourceModuleBoundaryCheckerPath = join(repoRoot, "scripts", "check-module-boundaries.mjs");
const sourceTestBoundaryCheckerPath = join(repoRoot, "scripts", "check-test-boundaries.mjs");
const sourceTestClassificationCheckerPath = join(repoRoot, "scripts", "check-test-classification.mjs");
const sourceTestTopologyCheckerPath = join(repoRoot, "scripts", "check-test-topology.mjs");
const sourceFixtureOwnershipCheckerPath = join(repoRoot, "scripts", "check-fixture-ownership.mjs");
const sourceSharedSurfaceOwnershipCheckerPath = join(repoRoot, "scripts", "check-shared-surface-ownership.mjs");
const sourceDailyLensCollectorOwnershipCheckerPath = join(repoRoot, "scripts", "check-daily-lens-collector-ownership.mjs");
const sourceSubsystemOwnershipCheckerPath = join(repoRoot, "scripts", "check-subsystem-ownership.mjs");
const sourceTestClassificationBaselinePath = join(repoRoot, "scripts", "test-classification-baseline.json");
const sourceIrreversibleNodeCoverageCheckerPath = join(repoRoot, "scripts", "check-irreversible-node-coverage.mjs");
const sourceIrreversibleNodeCoverageExclusionsPath = join(repoRoot, "scripts", "lib", "irreversible-node-coverage-exclusions.ts");
const sourceIrreversibleNodeCoverageManifestPath = join(repoRoot, "scripts", "lib", "irreversible-node-coverage-manifest.ts");
const sourceWorkspaceExportCoverageCheckerPath = join(repoRoot, "scripts", "check-workspace-export-coverage.mjs");
const sourceCoveragePolicyCheckerPath = join(repoRoot, "scripts", "check-coverage-policy-ratchet.mjs");
const sourceCoveragePolicyBaselinePath = join(repoRoot, "scripts", "coverage-policy-ratchet-baseline.json");
const sourceRuntimeStartupProbePath = join(repoRoot, "scripts", "check-runtime-startup-probe.mjs");
const sourceBenchmarkJobIdRegistryCheckerPath = join(repoRoot, "scripts", "check-benchmark-job-id-registry.mjs");
const sourceContextPropagationCheckerPath = join(repoRoot, "scripts", "check-context-propagation-contract.mjs");
const sourcePipelineSegmentCoverageCheckerPath = join(repoRoot, "scripts", "check-pipeline-segment-coverage.mjs");
const sourceDegenerateStateGuardCheckerPath = join(repoRoot, "scripts", "check-degenerate-state-guards.mjs");
const sourceScenarioRegistryBudgetCheckerPath = join(repoRoot, "scripts", "check-scenario-registry-budget.mjs");
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
const sourceOtelTaxonomyContractCheckerPath = join(repoRoot, "scripts", "check-otel-taxonomy-contract.mjs"), sourceOtelTaxonomyContractLibPath = join(repoRoot, "scripts", "lib", "otel-taxonomy-contract.ts"), sourceOtelTaxonomySourceJsonPath = join(repoRoot, "packages", "factory-telemetry", "src", "otel-contract.json");
const sourceWorkflowInstrumentationHelperCheckerPath = join(repoRoot, "scripts", "check-workflow-instrumentation-helper-contract.mjs"), sourceWorkflowInstrumentationHelperLibPath = join(repoRoot, "scripts", "lib", "workflow-instrumentation-helper-contract.ts");
const sourceReactorCollectorCheckerPath = join(repoRoot, "scripts", "check-reactor-collector-contract.mjs"), sourceReactorCollectorLibPath = join(repoRoot, "scripts", "lib", "reactor-collector-contract.ts");
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
const MOTHERSHIP_WAVE_EXECUTE_DOT = "docs/contracts/workflow-ir/mothership/wave_execute.dot";
const MOTHERSHIP_WAVE_EXECUTE_META_JSON = "factories/mothership/graphs/wave_execute.meta.json";
const RELEASE_QUALITY_NPM_SCRIPTS = Object.freeze([
  "test:platform:cli-context-portability",
  "test:platform:supervisor-recovery",
  "test:platform:scaffold-contract",
  "test:platform:factory-portability",
  "test:platform:external-factory-portability-matrix",
  "test:platform:docs-skills-templates",
]);
const DOT_DOTFILE_PLATFORM_INVARIANT_NPM_SCRIPTS = Object.freeze([
  "test:platform:managed-factory-mutation-boundaries",
  "test:platform:supervisor-recovery",
]);
const DOT_META_PLATFORM_INVARIANT_NPM_SCRIPTS = Object.freeze([
  "test:platform:supervisor-recovery",
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
  return manifestPath;
}

function setupRepo({ stagedPaths, fileContents = {} }) {
  const repoDir = mkdtempSync(join(tmpdir(), "pre-commit-hook-"));

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
  copyFileSync(sourceLineLimitCheckerPath, join(repoDir, "scripts", "check-line-limit.mjs"));
  copyFileSync(sourceHatchArtifactBoundaryCheckerPath, join(repoDir, "scripts", "check-hatch-artifact-boundary.mjs"));
  copyFileSync(sourceModuleBoundaryCheckerPath, join(repoDir, "scripts", "check-module-boundaries.mjs"));
  copyFileSync(sourceTestBoundaryCheckerPath, join(repoDir, "scripts", "check-test-boundaries.mjs"));
  copyFileSync(sourceTestClassificationCheckerPath, join(repoDir, "scripts", "check-test-classification.mjs"));
  copyFileSync(sourceTestTopologyCheckerPath, join(repoDir, "scripts", "check-test-topology.mjs"));
  copyFileSync(sourceFixtureOwnershipCheckerPath, join(repoDir, "scripts", "check-fixture-ownership.mjs"));
  copyFileSync(sourceSharedSurfaceOwnershipCheckerPath, join(repoDir, "scripts", "check-shared-surface-ownership.mjs"));
  copyFileSync(sourceDailyLensCollectorOwnershipCheckerPath, join(repoDir, "scripts", "check-daily-lens-collector-ownership.mjs"));
  copyFileSync(sourceSubsystemOwnershipCheckerPath, join(repoDir, "scripts", "check-subsystem-ownership.mjs"));
  copyFileSync(sourceTestClassificationBaselinePath, join(repoDir, "scripts", "test-classification-baseline.json"));
  copyFileSync(sourceIrreversibleNodeCoverageCheckerPath, join(repoDir, "scripts", "check-irreversible-node-coverage.mjs"));
  copyFileSync(sourceIrreversibleNodeCoverageExclusionsPath, join(repoDir, "scripts", "lib", "irreversible-node-coverage-exclusions.ts"));
  copyFileSync(sourceIrreversibleNodeCoverageManifestPath, join(repoDir, "scripts", "lib", "irreversible-node-coverage-manifest.ts"));
  copyFileSync(sourceWorkspaceExportCoverageCheckerPath, join(repoDir, "scripts", "check-workspace-export-coverage.mjs"));
  copyFileSync(sourceCoveragePolicyCheckerPath, join(repoDir, "scripts", "check-coverage-policy-ratchet.mjs"));
  copyFileSync(sourceCoveragePolicyBaselinePath, join(repoDir, "scripts", "coverage-policy-ratchet-baseline.json"));
  copyFileSync(sourceRuntimeStartupProbePath, join(repoDir, "scripts", "check-runtime-startup-probe.mjs"));
  copyFileSync(sourceBenchmarkJobIdRegistryCheckerPath, join(repoDir, "scripts", "check-benchmark-job-id-registry.mjs"));
  copyFileSync(sourceContextPropagationCheckerPath, join(repoDir, "scripts", "check-context-propagation-contract.mjs"));
  copyFileSync(sourcePipelineSegmentCoverageCheckerPath, join(repoDir, "scripts", "check-pipeline-segment-coverage.mjs"));
  copyFileSync(sourceDegenerateStateGuardCheckerPath, join(repoDir, "scripts", "check-degenerate-state-guards.mjs"));
  copyFileSync(sourceScenarioRegistryBudgetCheckerPath, join(repoDir, "scripts", "check-scenario-registry-budget.mjs"));
  copyFileSync(sourceScenarioRegistryBudgetConfigPath, join(repoDir, "scripts", "config", "scenario-registry.json"));
  copyFileSync(sourceDegenerateStateGuardBaselinePath, join(repoDir, "scripts", "degenerate-state-guard-baseline.json"));
  copyFileSync(sourceHandlerContextContractPath, join(repoDir, "scripts", "handler-context-contract.json"));
  copyFileSync(sourceDocsPolicyValidatorPath, join(repoDir, "scripts", "lib", "docs-policy-validator.ts"));
  copyFileSync(sourceDocsTemplateFrameworkPath, join(repoDir, "scripts", "lib", "docs-template-framework.ts"));
  copyFileSync(sourceLiveDocAssetsManifestPath, join(repoDir, "scripts", "lib", "live-doc-assets-manifest.ts"));
  copyFileSync(sourcePlatformInvariantManifestPath, join(repoDir, "scripts", "lib", "platform-invariant-manifest.ts"));
  copyFileSync(sourceRoutingConfigPath, join(repoDir, "scripts", "lib", "pre-commit-routing-config.ts"));
  copyFileSync(sourceSuiteRoutingConfigPath, join(repoDir, "scripts", "lib", "suite-routing-config.ts"));
  copyFileSync(sourceGateManifestPath, join(repoDir, "scripts", "lib", "gate-manifest.ts")); copyFileSync(sourcePhase1GateScopeContractPath, join(repoDir, "scripts", "lib", "phase1-gate-scope-contract.ts"));
  copyFileSync(sourceOtelTaxonomyContractCheckerPath, join(repoDir, "scripts", "check-otel-taxonomy-contract.mjs")); copyFileSync(sourceOtelTaxonomyContractLibPath, join(repoDir, "scripts", "lib", "otel-taxonomy-contract.ts")); copyFileSync(sourceOtelTaxonomySourceJsonPath, join(repoDir, "packages", "factory-telemetry", "src", "otel-contract.json"));
  copyFileSync(sourceWorkflowInstrumentationHelperCheckerPath, join(repoDir, "scripts", "check-workflow-instrumentation-helper-contract.mjs")); copyFileSync(sourceWorkflowInstrumentationHelperLibPath, join(repoDir, "scripts", "lib", "workflow-instrumentation-helper-contract.ts"));
  copyFileSync(sourceReactorCollectorCheckerPath, join(repoDir, "scripts", "check-reactor-collector-contract.mjs")); copyFileSync(sourceReactorCollectorLibPath, join(repoDir, "scripts", "lib", "reactor-collector-contract.ts"));
  mkdirSync(join(repoDir, "apps", "hatch", "src", "pipeline"), { recursive: true });
  mkdirSync(join(repoDir, "packages", "factory-telemetry", "src"), { recursive: true });
  mkdirSync(join(repoDir, "packages", "factory-telemetry", "config"), { recursive: true });
  copyFileSync(sourceReactorInstrumentationPath, join(repoDir, "apps", "hatch", "src", "pipeline", "reactor-instrumentation.ts"));
  copyFileSync(sourceOtelRuntimePath, join(repoDir, "packages", "factory-telemetry", "src", "otel-stdout.ts"));
  copyFileSync(sourceCollectorProfilePath, join(repoDir, "packages", "factory-telemetry", "config", "otel-collector.yaml"));
  copyFileSync(sourceDocsPolicyPath, join(repoDir, "docs", "docs-policy.json"));
  copyFileSync(sourceDocsPolicySchemaPath, join(repoDir, "docs", "docs-policy.schema.json"));
  copyFileSync(sourceSuiteRoutingJsonPath, join(repoDir, "config", "testing", "suite-routing.json"));
  copyFileSync(sourceTopologyEnforcementJsonPath, join(repoDir, "config", "testing", "topology-enforcement.json"));
  copyFileSync(sourceSharedSurfaceOwnershipJsonPath, join(repoDir, "config", "testing", "shared-surface-ownership.json"));
  copyFileSync(sourceSubsystemOwnershipJsonPath, join(repoDir, "config", "testing", "subsystem-ownership.json"));
  const irreversibleManifestPath = writeIrreversibleCoverageFixture(repoDir);

  ensureFile(
    repoDir,
    "node_modules/.bin/hatch",
    "#!/usr/bin/env bash\nset -euo pipefail\nif [ -n \"${PRE_COMMIT_HATCH_STUB_LOG:-}\" ]; then\n  echo \"$*\" >> \"$PRE_COMMIT_HATCH_STUB_LOG\"\nfi\nexit \"${PRE_COMMIT_HATCH_EXIT:-0}\"\n",
  );
  chmodSync(join(repoDir, "node_modules", ".bin", "hatch"), 0o755);

  ensureFile(
    repoDir,
    "scripts/lint-dot.mjs",
    "#!/usr/bin/env node\nif (process.env.PRE_COMMIT_LINT_DOT_STUB_LOG) {\n  const { appendFileSync } = await import('node:fs');\n  appendFileSync(process.env.PRE_COMMIT_LINT_DOT_STUB_LOG, process.argv.slice(2).join(' ') + '\\n');\n}\nif (process.env.PRE_COMMIT_LINT_DOT_STDOUT) {\n  process.stdout.write(process.env.PRE_COMMIT_LINT_DOT_STDOUT + '\\n');\n}\nif (process.env.PRE_COMMIT_LINT_DOT_STDERR) {\n  process.stderr.write(process.env.PRE_COMMIT_LINT_DOT_STDERR + '\\n');\n} else {\n  process.stderr.write(process.env.PRE_COMMIT_LINT_DOT_DEFAULT_MARKER + '\\n');\n}\nprocess.exit(Number.parseInt(process.env.PRE_COMMIT_LINT_DOT_EXIT || '0', 10));\n",
  );
  chmodSync(join(repoDir, "scripts", "lint-dot.mjs"), 0o755);


  ensureFile(
    repoDir,
    "scripts/check-lockfile-sync.mjs",
    "#!/usr/bin/env node\n" +
      "const exit = Number.parseInt(process.env.PRE_COMMIT_LOCKFILE_SYNC_EXIT || '0', 10);\n" +
      "if (process.env.PRE_COMMIT_LOCKFILE_SYNC_STUB_LOG) {\n" +
      "  const { appendFileSync } = await import('node:fs');\n" +
      "  appendFileSync(process.env.PRE_COMMIT_LOCKFILE_SYNC_STUB_LOG, 'check-lockfile-sync\\n');\n" +
      "}\n" +
      "process.exit(exit);\n",
  );
  chmodSync(join(repoDir, "scripts", "check-lockfile-sync.mjs"), 0o755);

  ensureFile(repoDir, "scripts/eslint-gate.mjs", simpleStub("PRE_COMMIT_ESLINT_EXIT", "[eslint]", " files=1"));
  chmodSync(join(repoDir, "scripts", "eslint-gate.mjs"), 0o755);
  ensureFile(repoDir, "scripts/check-export-coverage.mjs", simpleStub("PRE_COMMIT_EXPORT_COVERAGE_EXIT", "[export-coverage]", " new_gaps=0"));
  chmodSync(join(repoDir, "scripts", "check-export-coverage.mjs"), 0o755);

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
    "scripts/check-coverage-policy-ratchet.mjs",
    "#!/usr/bin/env node\n" +
      "const exit = Number.parseInt(process.env.PRE_COMMIT_COVERAGE_POLICY_EXIT || '0', 10);\n" +
      "if (process.env.PRE_COMMIT_COVERAGE_POLICY_STUB_LOG) {\n" +
      "  const { appendFileSync } = await import('node:fs');\n" +
      "  appendFileSync(process.env.PRE_COMMIT_COVERAGE_POLICY_STUB_LOG, 'check-coverage-policy-ratchet\\n');\n" +
      "}\n" +
      "console.log('[coverage-policy] result=' + (exit ? 'fail' : 'ok') + ' violations=0');\n" +
      "process.exit(exit);\n",
  );
  chmodSync(join(repoDir, "scripts", "check-coverage-policy-ratchet.mjs"), 0o755);

  ensureFile(
    repoDir,
    "scripts/check-runtime-startup-probe.mjs",
    "#!/usr/bin/env node\n" +
      "const exit = Number.parseInt(process.env.PRE_COMMIT_RUNTIME_STARTUP_PROBE_EXIT || '0', 10);\n" +
      "if (process.env.PRE_COMMIT_RUNTIME_STARTUP_PROBE_STUB_LOG) {\n" +
      "  const { appendFileSync } = await import('node:fs');\n" +
      "  appendFileSync(process.env.PRE_COMMIT_RUNTIME_STARTUP_PROBE_STUB_LOG, 'check-runtime-startup-probe\\n');\n" +
      "}\n" +
      "console.log('[runtime-startup-probe] result=' + (exit ? 'fail' : 'ok') + ' probes=3');\n" +
      "process.exit(exit);\n",
  );
  chmodSync(join(repoDir, "scripts", "check-runtime-startup-probe.mjs"), 0o755);

  ensureFile(
    repoDir,
    "scripts/check-benchmark-job-id-registry.mjs",
    "#!/usr/bin/env node\n" +
      "const exit = Number.parseInt(process.env.PRE_COMMIT_BENCHMARK_JOB_ID_REGISTRY_EXIT || '0', 10);\n" +
      "if (process.env.PRE_COMMIT_BENCHMARK_JOB_ID_REGISTRY_STUB_LOG) {\n" +
      "  const { appendFileSync } = await import('node:fs');\n" +
      "  appendFileSync(process.env.PRE_COMMIT_BENCHMARK_JOB_ID_REGISTRY_STUB_LOG, 'check-benchmark-job-id-registry\\n');\n" +
      "}\n" +
      "console.log('[benchmark-job-id-registry] result=' + (exit ? 'fail' : 'ok') + ' checked=1 job_ids=1');\n" +
      "process.exit(exit);\n",
  );
  chmodSync(join(repoDir, "scripts", "check-benchmark-job-id-registry.mjs"), 0o755);

  ensureFile(
    repoDir,
    "scripts/check-context-propagation-contract.mjs",
    "#!/usr/bin/env node\n" +
      "const exit = Number.parseInt(process.env.PRE_COMMIT_CONTEXT_PROPAGATION_CONTRACT_EXIT || '0', 10);\n" +
      "if (process.env.PRE_COMMIT_CONTEXT_PROPAGATION_CONTRACT_STUB_LOG) {\n" +
      "  const { appendFileSync } = await import('node:fs');\n" +
      "  appendFileSync(process.env.PRE_COMMIT_CONTEXT_PROPAGATION_CONTRACT_STUB_LOG, process.argv.slice(2).join(' ') + '\\n');\n" +
      "}\n" +
      "console.log('[context_propagation_contract] result=' + (exit ? 'fail' : 'ok') + ' checked=1 violations=' + (exit ? 1 : 0));\n" +
      "process.exit(exit);\n",
  );
  chmodSync(join(repoDir, "scripts", "check-context-propagation-contract.mjs"), 0o755);

  ensureFile(
    repoDir,
    "scripts/check-degenerate-state-guards.mjs",
    "#!/usr/bin/env node\n" +
      "const exit = Number.parseInt(process.env.PRE_COMMIT_DEGENERATE_STATE_GUARDS_EXIT || '0', 10);\n" +
      "console.log('[degenerate_state_guards] result=' + (exit ? 'fail' : 'ok') + ' guarded=3 unguarded=' + (exit ? 1 : 0));\n" +
      "process.exit(exit);\n",
  );
  chmodSync(join(repoDir, "scripts", "check-degenerate-state-guards.mjs"), 0o755);

  ensureFile(
    repoDir,
    "scripts/check-scenario-registry-budget.mjs",
    "#!/usr/bin/env node\n" +
      "const exit = Number.parseInt(process.env.PRE_COMMIT_SCENARIO_REGISTRY_BUDGET_EXIT || '0', 10);\n" +
      "console.log('[scenario_registry_budget] root=\"factories/mothership/scenarios\" count=6');\n" +
      "console.log('Scenario count: 6 / limit 30');\n" +
      "console.log('[scenario_registry_budget] result=' + (exit ? 'fail' : 'ok') + ' total=6 max=30');\n" +
      "if (exit) {\n" +
      "  console.error('[scenario_registry_budget] error=scenario registry count 6 exceeds configured ceiling 30');\n" +
      "}\n" +
      "process.exit(exit);\n",
  );
  chmodSync(join(repoDir, "scripts", "check-scenario-registry-budget.mjs"), 0o755);
  ensureFile(repoDir, "scripts/check-internal-cli-transport.mjs", simpleStub("PRE_COMMIT_INTERNAL_CLI_TRANSPORT_EXIT", "[internal-cli-transport]", " checked=0 graph=0 runtime=0 opted_in_graph=0"));
  chmodSync(join(repoDir, "scripts", "check-internal-cli-transport.mjs"), 0o755);
  ensureFile(repoDir, "scripts/check-active-surface-manifest.mjs", simpleStub("PRE_COMMIT_ACTIVE_SURFACE_MANIFEST_EXIT", "[active-surface-manifest]", " checked=0 graph=0 runtime=0 command=0 diagnostics=0"));
  chmodSync(join(repoDir, "scripts", "check-active-surface-manifest.mjs"), 0o755);
  ensureFile(repoDir, "scripts/check-active-surface-inventory.mjs", simpleStub("PRE_COMMIT_ACTIVE_SURFACE_INVENTORY_EXIT", "[active-surface-inventory]", " roots=0 graphs=0 runtime=0 commands=0 diagnostics=0"));
  chmodSync(join(repoDir, "scripts", "check-active-surface-inventory.mjs"), 0o755);
  ensureFile(repoDir, "scripts/check-phase1-gate-readiness.mjs", simpleStub("PRE_COMMIT_PHASE1_GATE_READINESS_EXIT", "[phase1-gate-readiness]", " graph=0 runtime=0 command=0 diagnostics=0")); chmodSync(join(repoDir, "scripts", "check-phase1-gate-readiness.mjs"), 0o755);
  ensureFile(repoDir, "scripts/check-phase1-ownership-map.mjs", simpleStub("PRE_COMMIT_PHASE1_OWNERSHIP_MAP_EXIT", "[phase1-ownership-map]", " active=0 legacy=0 diagnostics=0")); chmodSync(join(repoDir, "scripts", "check-phase1-ownership-map.mjs"), 0o755);
  ensureFile(repoDir, "scripts/check-phase1-burndown-finalization.mjs", simpleStub("PRE_COMMIT_PHASE1_BURNDOWN_FINALIZATION_EXIT", "[phase1-burndown-finalization]", " phase1_targets=0 out_of_scope=0 diagnostics=0")); chmodSync(join(repoDir, "scripts", "check-phase1-burndown-finalization.mjs"), 0o755);
  ensureFile(repoDir, "scripts/check-command-thinness-enforcement.mjs", simpleStub("PRE_COMMIT_COMMAND_THINNESS_EXIT", "[command-thinness-enforcement]", " checked=0 violations=0"));
  chmodSync(join(repoDir, "scripts", "check-command-thinness-enforcement.mjs"), 0o755);
  ensureFile(repoDir, "scripts/check-runtime-internal-cli-enforcement.mjs", simpleStub("PRE_COMMIT_RUNTIME_INTERNAL_CLI_EXIT", "[runtime-internal-cli]", " checked=0 violations=0"));
  chmodSync(join(repoDir, "scripts", "check-runtime-internal-cli-enforcement.mjs"), 0o755);
  ensureFile(repoDir, "scripts/check-structured-io-enforcement.mjs", simpleStub("PRE_COMMIT_STRUCTURED_IO_EXIT", "[structured-io-enforcement]", " checked=0 violations=0"));
  chmodSync(join(repoDir, "scripts", "check-structured-io-enforcement.mjs"), 0o755);
  ensureFile(repoDir, "scripts/check-shared-ownership-enforcement.mjs", simpleStub("PRE_COMMIT_SHARED_OWNERSHIP_EXIT", "[shared-ownership-enforcement]", " checked=0 violations=0"));
  chmodSync(join(repoDir, "scripts", "check-shared-ownership-enforcement.mjs"), 0o755);

  initFixtureRepo(repoDir);

  // Commit fixture infrastructure first so staged sets only include scenario paths.
  baselineFixtureCommit(repoDir, "fixture baseline");

  for (const stagedPath of stagedPaths) {
    const content = fileContents[stagedPath] ?? defaultStagedFileContent(stagedPath);
    ensureFile(repoDir, stagedPath, content);
  }

  runFixtureGit(repoDir, ["add", "."]);

  return repoDir;
}

function runHookScenario({ stagedPaths, envOverrides = {}, fileContents = {} }) {
  const repoDir = setupRepo({ stagedPaths, fileContents });
  const tempDir = mkdtempSync(join(tmpdir(), "pre-commit-hook-logs-"));
  const pnpmLogPath = join(tempDir, "npm.log");
  const hatchLogPath = join(tempDir, "hatch.log");
  const lintDotLogPath = join(tempDir, "lint-dot.log");
  const workspaceCoverageLogPath = join(tempDir, "workspace-export-coverage.log");
  const coveragePolicyLogPath = join(tempDir, "coverage-policy.log");
  const runtimeStartupProbeLogPath = join(tempDir, "runtime-startup-probe.log");
  const benchmarkJobIdRegistryLogPath = join(tempDir, "benchmark-job-id-registry.log");
  const contextPropagationContractLogPath = join(tempDir, "context-propagation-contract.log");

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
    PRE_COMMIT_SCENARIO_REGISTRY_BUDGET_EXIT: "0",
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

  const run = spawnSync("bash", [".githooks/pre-commit"], {
    cwd: repoDir,
    env,
    encoding: "utf8",
  });

  const pnpmInvocations = existsSync(pnpmLogPath)
    ? readFileSync(pnpmLogPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
    : [];
  const hatchCalls = existsSync(hatchLogPath)
    ? readFileSync(hatchLogPath, "utf8").trim().split("\n").filter(Boolean)
    : [];
  const lintDotCalls = existsSync(lintDotLogPath)
    ? readFileSync(lintDotLogPath, "utf8").trim().split("\n").filter(Boolean)
    : [];
  const contextPropagationContractCalls = existsSync(contextPropagationContractLogPath)
    ? readFileSync(contextPropagationContractLogPath, "utf8").trim().split("\n").filter(Boolean)
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
    contextPropagationContractCalls,
    stdout: `${hookLog}${run.stdout}`,
    stderr: `${hookLog}${run.stderr}`,
    output: `${hookLog}${run.stdout}${run.stderr}`,
  };
}

function assertNpmInvocationContract(invocations, expectedScripts, expectedCwd) {
  assert.deepEqual(invocations.map((entry) => entry.script), expectedScripts);
  for (const invocation of invocations) {
    assert.equal(invocation.executable, "pnpm");
    assert.equal(realpathSync(invocation.cwd), realpathSync(expectedCwd));
    assert.ok(
      invocation.argv[0] === invocation.script || invocation.argv[1] === invocation.script,
      `expected pnpm argv to include script ${invocation.script}: ${invocation.argv.join(" ")}`,
    );
    assert.equal(invocation.command, `pnpm ${invocation.argv.join(" ")}`);
  }
}

test("docs-only commit skips suites but still runs non-test gates", () => {
  const { run, repoDir, pnpmInvocations, stdout, stderr } = runHookScenario({
    stagedPaths: ["docs/guide.md"],
  });

  assert.equal(run.status, 0);
  assertNpmInvocationContract(pnpmInvocations, ["docs:check", "build", "typecheck"], repoDir);
  assert.match(stdout, /Checking docs policy scope/);
  assert.match(stdout, /\[pre-commit\] gate_start gate=build command="pnpm build[^"]*"/);
  assert.match(stdout, /\[pre-commit\] gate_start gate=typecheck command="pnpm typecheck[^"]*"/);
  assert.match(stdout, /\[pre-commit\] test_suites_decision action=skip reason=docs_only/);
  assert.match(stdout, /test_suite_skip suite=test:guard-gates reason=docs_only/);
  assert.match(stdout, /test_suite_skip suite=test:wave-claim-gates reason=docs_only/);
  assert.equal(stderr.includes("SKIP_TESTS override enabled"), false);
});

test("new staged generic test names fail test classification gate", () => {
  const { run, output } = runHookScenario({
    stagedPaths: ["packages/factory-ops/test/new-suite.test.mjs"],
    fileContents: {
      "packages/factory-ops/test/new-suite.test.mjs": 'import test from "node:test";\n',
    },
  });

  assert.equal(run.status, 1);
  assert.match(output, /Checking test classification/);
  assert.match(output, /\[test-classification\] violation/);
  assert.match(output, /first_failure phase=test_classification target=check-test-classification exit=1/);
});

test("irreversible node coverage gate runs before export coverage", () => {
  const { run, output } = runHookScenario({
    stagedPaths: ["packages/factory-ops/src/commands/goal-run-state.ts"],
    fileContents: {
      "packages/factory-ops/src/commands/goal-run-state.ts": `${readFileSync(join(repoRoot, "packages/factory-ops/src/commands/goal-run-state.ts"), "utf8")}\n// staged change\n`,
    },
  });

  assert.equal(run.status, 0);
  assert.match(output, /Checking irreversible node coverage/);
  assert.match(output, /\[irreversible-node-coverage\] result=ok/);
  assert.ok(
    output.indexOf("Checking irreversible node coverage") < output.indexOf("Checking ops export coverage"),
    "irreversible node coverage must run before export coverage",
  );
});

test("apps/hatch staged source runs workspace export coverage baseline gate", () => {
  const { run, output } = runHookScenario({
    stagedPaths: ["apps/hatch/src/pipeline/graph.ts"],
    fileContents: {
      "apps/hatch/src/pipeline/graph.ts": "export const stagedGraph = true;\n",
    },
  });

  assert.equal(run.status, 0, output);
  assert.match(output, /Checking workspace export coverage baselines/);
  assert.match(output, /\[workspace-export-coverage\] result=ok/);
});

test("coverage policy paths run coverage policy ratchet before build", () => {
  const { run, output } = runHookScenario({
    stagedPaths: ["apps/hatch/vitest.config.mjs"],
    fileContents: {
      "apps/hatch/vitest.config.mjs": "export default {};\n",
    },
  });

  assert.equal(run.status, 0, output);
  assert.match(output, /Checking coverage policy ratchet/);
  assert.match(output, /\[coverage-policy\] result=ok/);
  assert.ok(
    output.indexOf("Checking coverage policy ratchet") < output.indexOf("gate_start gate=build"),
    "coverage policy gate must run before build",
  );
});

test("coverage policy ratchet failure aborts before build", () => {
  const { run, output } = runHookScenario({
    stagedPaths: ["packages/factory-ops/package.json"],
    fileContents: {
      "packages/factory-ops/package.json": "{\"name\":\"@hatch/factory-ops\"}\n",
    },
    envOverrides: {
      PRE_COMMIT_COVERAGE_POLICY_EXIT: "1",
    },
  });

  assert.equal(run.status, 1, output);
  assert.match(output, /Checking coverage policy ratchet/);
  assert.match(output, /first_failure phase=coverage_policy target=check-coverage-policy-ratchet exit=1/);
  assert.doesNotMatch(output, /gate_start gate=build/);
});

test("state-machine docs trigger runs docs:check and keeps docs-only suite skip", () => {
  const { run, repoDir, pnpmInvocations, stdout } = runHookScenario({
    stagedPaths: ["docs/state-machines.md"],
  });

  assert.equal(run.status, 0);
  assertNpmInvocationContract(pnpmInvocations, ["docs:check", "build", "typecheck"], repoDir);
  assert.match(stdout, /Checking docs policy scope/);
  assert.match(stdout, /\[pre-commit\] test_suites_decision action=skip reason=docs_only/);
});

test("policy-scoped root docs path triggers docs:check", () => {
  const { run, repoDir, pnpmInvocations, stdout } = runHookScenario({
    stagedPaths: ["AGENTS.md"],
  });

  assert.equal(run.status, 0);
  assertNpmInvocationContract(pnpmInvocations, ["docs:check", "build", "typecheck"], repoDir);
  assert.match(stdout, /Checking docs policy scope/);
  assert.match(stdout, /\[pre-commit\] test_suites_decision action=skip reason=docs_only/);
});

test("docs policy validator source change triggers docs:check preflight", () => {
  const { run, repoDir, pnpmInvocations, stdout } = runHookScenario({
    stagedPaths: ["scripts/lib/docs-policy-validator.ts"],
    fileContents: {
      "scripts/lib/docs-policy-validator.ts": `${readFileSync(sourceDocsPolicyValidatorPath, "utf8")}\n// staged change\n`,
    },
  });

  assert.equal(run.status, 0);
  assertNpmInvocationContract(
    pnpmInvocations,
    ["docs:check", "test:platform:cli-context-portability", ...RELEASE_QUALITY_NPM_SCRIPTS, "build", "typecheck"],
    repoDir,
  );
  assert.match(stdout, /Checking docs policy scope/);
  assert.match(stdout, /\[pre-commit\] gate_start gate=platform_invariants invariant=cli_context_portability/);
  assert.match(stdout, /\[pre-commit\] test_suites_decision action=skip reason=platform_invariant_trigger/);
});

test("dot-only commit validates dot files, runs lint-dot, and skips suites", () => {
  const { run, repoDir, pnpmInvocations, hatchCalls, lintDotCalls, contextPropagationContractCalls, stdout, stderr } = runHookScenario({
    stagedPaths: [MOTHERSHIP_WAVE_EXECUTE_DOT],
  });

  assert.equal(run.status, 0);
  assertNpmInvocationContract(
    pnpmInvocations,
    [...DOT_DOTFILE_PLATFORM_INVARIANT_NPM_SCRIPTS, ...RELEASE_QUALITY_NPM_SCRIPTS, "build", "typecheck"],
    repoDir,
  );
  assert.match(stdout, /\[pre-commit\] gate_start gate=platform_invariants invariant=supervisor_recovery/);
  assert.match(stdout, /\[pre-commit\] gate_start gate=release_quality family=core_invariants/);
  assert.equal(hatchCalls.length, 1);
  assert.match(hatchCalls[0], /^validate factories\/mothership\/graphs\/wave_execute\.dot$/);
  assert.equal(lintDotCalls.length, 1);
  assert.equal(lintDotCalls[0], MOTHERSHIP_WAVE_EXECUTE_DOT);
  assert.equal(contextPropagationContractCalls.length, 1);
  assert.match(contextPropagationContractCalls[0], /--staged-file-list\s+\S*staged-files\.list/);
  assert.match(stdout, /\[pre-commit\] test_suites_decision action=skip reason=dot_only/);
  assert.match(stderr, new RegExp(`\\${LINT_DOT_MARKER_PREFIX} result=${LINT_DOT_RESULT.ok}`));
});

test("docs+dot-only commit runs dot preflight and skips suites with docs_or_dot_only reason", () => {
  const { run, repoDir, pnpmInvocations, hatchCalls, lintDotCalls, contextPropagationContractCalls, stdout } = runHookScenario({
    stagedPaths: ["docs/guide.md", MOTHERSHIP_WAVE_EXECUTE_DOT],
  });

  assert.equal(run.status, 0);
  assertNpmInvocationContract(
    pnpmInvocations,
    ["docs:check", ...DOT_DOTFILE_PLATFORM_INVARIANT_NPM_SCRIPTS, ...RELEASE_QUALITY_NPM_SCRIPTS, "build", "typecheck"],
    repoDir,
  );
  assert.match(stdout, /\[pre-commit\] gate_start gate=platform_invariants invariant=supervisor_recovery/);
  assert.match(stdout, /\[pre-commit\] gate_start gate=release_quality family=core_invariants/);
  assert.equal(hatchCalls.length, 1);
  assert.equal(lintDotCalls.length, 1);
  assert.equal(contextPropagationContractCalls.length, 1);
  assert.match(contextPropagationContractCalls[0], /--staged-file-list\s+\S*staged-files\.list/);
  assert.match(stdout, /\[pre-commit\] test_suites_decision action=skip reason=docs_or_dot_only/);
  assert.match(stdout, /test_suite_skip suite=test:guard-gates reason=docs_or_dot_only/);
  assert.match(stdout, /test_suite_skip suite=test:wave-claim-gates reason=docs_or_dot_only/);
});

test("lint-dot warning-only output is non-blocking and preserves deterministic suite skip", () => {
  const warningPayload = JSON.stringify([
    {
      file: MOTHERSHIP_WAVE_EXECUTE_DOT,
      severity: "warning",
      rule_id: "context_flow.undefined_reference",
      message: "test warning",
      line: 1,
      column: 1,
      node: "n1",
    },
  ]);

  const { run, repoDir, pnpmInvocations, stdout, stderr } = runHookScenario({
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

  assert.equal(run.status, 0, stderr || stdout);
  assertNpmInvocationContract(
    pnpmInvocations,
    [...DOT_DOTFILE_PLATFORM_INVARIANT_NPM_SCRIPTS, ...RELEASE_QUALITY_NPM_SCRIPTS, "build", "typecheck"],
    repoDir,
  );
  assert.match(stdout, /\[pre-commit\] gate_start gate=platform_invariants invariant=supervisor_recovery/);
  assert.match(stdout, /\[pre-commit\] gate_start gate=release_quality family=core_invariants/);
  assert.match(stdout, /\[pre-commit\] test_suites_decision action=skip reason=dot_only/);
  assert.match(stderr, new RegExp(`\\${LINT_DOT_MARKER_PREFIX} result=${LINT_DOT_RESULT.warningOnly}`));
  assert.doesNotMatch(stderr, /\[pre-commit\] first_failure phase=dot_validate/);
});

test("mixed dot+code commit runs dot preflight and routes by code bucket", () => {
  const { run, repoDir, pnpmInvocations, hatchCalls, lintDotCalls, contextPropagationContractCalls, stdout } = runHookScenario({
    stagedPaths: [MOTHERSHIP_WAVE_EXECUTE_DOT, "apps/hatch/src/cli.ts"],
  });

  assert.equal(run.status, 0);
  assert.equal(hatchCalls.length, 1);
  assert.equal(lintDotCalls.length, 1);
  assert.equal(contextPropagationContractCalls.length, 1);
  assert.match(contextPropagationContractCalls[0], /--staged-file-list\s+\S*staged-files\.list/);
  assertNpmInvocationContract(
    pnpmInvocations,
    [...DOT_DOTFILE_PLATFORM_INVARIANT_NPM_SCRIPTS, ...RELEASE_QUALITY_NPM_SCRIPTS, "build", "typecheck", "test:guard-gates"],
    repoDir,
  );
  assert.match(stdout, /test_suites_decision action=run reason=bucket_guard_only bucket=guard_only selection=guard_only/);
  assert.match(stdout, /test_suite_skip suite=test:wave-claim-gates reason=not_selected_by_bucket bucket=guard_only/);
});

test("apps/hatch change routes to guard-only selective suite bucket", () => {
  const { run, repoDir, pnpmInvocations, stdout } = runHookScenario({
    stagedPaths: ["apps/hatch/src/cli.ts"],
  });

  assert.equal(run.status, 0);
  assertNpmInvocationContract(pnpmInvocations, ["build", "typecheck", "test:guard-gates"], repoDir);
  assert.match(stdout, /test_suites_decision action=run reason=bucket_guard_only bucket=guard_only selection=guard_only/);
  assert.match(stdout, /test_suite_start suite=test:guard-gates command="pnpm test:guard-gates[^"]*"/);
  assert.match(stdout, /test_suite_skip suite=test:wave-claim-gates reason=not_selected_by_bucket bucket=guard_only/);
  assert.doesNotMatch(stdout, /test_suite_start suite=test:wave-claim-gates/);
});

test("factories/mothership/graphs path maps to hatch-only guard suite", () => {
  const { run, repoDir, pnpmInvocations, stdout } = runHookScenario({
    stagedPaths: [MOTHERSHIP_WAVE_EXECUTE_META_JSON],
  });

  assert.equal(run.status, 0);
  assertNpmInvocationContract(
    pnpmInvocations,
    [...DOT_META_PLATFORM_INVARIANT_NPM_SCRIPTS, ...RELEASE_QUALITY_NPM_SCRIPTS, "build", "typecheck", "test:guard-gates"],
    repoDir,
  );
  assert.match(stdout, /\[pre-commit\] gate_start gate=platform_invariants invariant=supervisor_recovery/);
  assert.match(stdout, /\[pre-commit\] gate_start gate=release_quality family=core_invariants/);
  assert.match(stdout, /test_suites_decision action=run reason=bucket_guard_only bucket=guard_only selection=guard_only/);
  assert.match(stdout, /test_suite_route path="factories\/mothership\/graphs\/wave_execute\.meta\.json" pattern="factories\/mothership\/graphs\/\*\*" bucket=guard_only/);
  assert.match(stdout, /test_suite_start suite=test:guard-gates command="pnpm test:guard-gates[^"]*"/);
  assert.doesNotMatch(stdout, /test_suite_start suite=test:wave-claim-gates/);
});

test("factory portability path runs platform invariant gate and skips selective suites", () => {
  const { run, repoDir, pnpmInvocations, stdout } = runHookScenario({
    stagedPaths: ["packages/factory-ops/src/lib/factory-context-resolver.ts"],
  });

  assert.equal(run.status, 0);
  assertNpmInvocationContract(
    pnpmInvocations,
    ["test:platform:factory-portability", ...RELEASE_QUALITY_NPM_SCRIPTS, "build", "typecheck"],
    repoDir,
  );
  assert.match(stdout, /\[pre-commit\] gate_start gate=platform_invariants invariant=factory_portability/);
  assert.match(stdout, /\[pre-commit\] gate_start gate=release_quality family=core_invariants/);
  assert.match(stdout, /\[pre-commit\] test_suites_decision action=skip reason=platform_invariant_trigger/);
  assert.match(stdout, /test_suite_skip suite=test:guard-gates reason=platform_invariant_trigger/);
  assert.match(stdout, /test_suite_skip suite=test:wave-claim-gates reason=platform_invariant_trigger/);
});

test("wave-specific factory-ops change routes to wave-only selective suite bucket", () => {
  const { run, repoDir, pnpmInvocations, stdout } = runHookScenario({
    stagedPaths: ["packages/factory-ops/src/cli/commands/wave.ts"],
  });

  assert.equal(run.status, 0);
  assertNpmInvocationContract(pnpmInvocations, ["build", "typecheck", "test:wave-claim-gates"], repoDir);
  assert.match(stdout, /test_suites_decision action=run reason=bucket_wave_claim_only bucket=wave_claim_only selection=wave_claim_only/);
  assert.match(stdout, /test_suite_skip suite=test:guard-gates reason=not_selected_by_bucket bucket=wave_claim_only/);
  assert.match(stdout, /test_suite_start suite=test:wave-claim-gates command="pnpm test:wave-claim-gates[^"]*" context="turbo run test:wave-claim-gates --filter=@hatch\/factory-ops --output-logs=errors-only"/);
});

test("overlap between guard and wave buckets runs both suites after gates in deterministic order", () => {
  const { run, repoDir, pnpmInvocations, stdout } = runHookScenario({
    stagedPaths: [
      "apps/hatch/src/cli.ts",
      "packages/factory-ops/src/cli/commands/wave.ts",
    ],
  });

  assert.equal(run.status, 0);
  assertNpmInvocationContract(pnpmInvocations, ["build", "typecheck", "test:guard-gates", "test:wave-claim-gates"], repoDir);
  assert.match(stdout, /test_suites_decision action=run reason=bucket_overlap_guard_wave bucket=all_suites/);

  const buildStart = stdout.indexOf("gate_start gate=build");
  const typecheckStart = stdout.indexOf("gate_start gate=typecheck");
  const guardStart = stdout.indexOf("test_suite_start suite=test:guard-gates");
  const waveStart = stdout.indexOf("test_suite_start suite=test:wave-claim-gates");

  assert.ok(buildStart >= 0 && typecheckStart >= 0 && guardStart >= 0 && waveStart >= 0);
  assert.ok(buildStart < typecheckStart, "build should run before typecheck");
  assert.ok(typecheckStart < guardStart, "typecheck should run before guard suite");
  assert.ok(guardStart < waveStart, "guard suite should run before wave suite");
});

test("non-wave factory-ops change routes to guard-only selective suite bucket", () => {
  const { run, repoDir, pnpmInvocations, stdout } = runHookScenario({
    stagedPaths: ["packages/factory-ops/src/cli.ts"],
  });

  assert.equal(run.status, 0);
  assertNpmInvocationContract(pnpmInvocations, ["build", "typecheck", "test:guard-gates"], repoDir);
  assert.match(stdout, /test_suites_decision action=run reason=bucket_guard_only bucket=guard_only selection=guard_only/);
  assert.match(stdout, /test_suite_start suite=test:guard-gates/);
  assert.match(stdout, /test_suite_skip suite=test:wave-claim-gates reason=not_selected_by_bucket bucket=guard_only/);
});

test("platform-trigger staged paths skip selective suites with explicit platform reason", () => {
  const { run, repoDir, pnpmInvocations, stdout } = runHookScenario({
    stagedPaths: ["scripts/unmatched.txt"],
  });

  assert.equal(run.status, 0);
  assertNpmInvocationContract(
    pnpmInvocations,
    ["test:platform:cli-context-portability", ...RELEASE_QUALITY_NPM_SCRIPTS, "build", "typecheck"],
    repoDir,
  );
  assert.match(stdout, /\[pre-commit\] gate_start gate=platform_invariants invariant=cli_context_portability/);
  assert.match(stdout, /\[pre-commit\] gate_start gate=release_quality family=core_invariants/);
  assert.match(stdout, /\[pre-commit\] test_suites_decision action=skip reason=platform_invariant_trigger/);
  assert.match(stdout, /test_suite_skip suite=test:guard-gates reason=platform_invariant_trigger/);
  assert.match(stdout, /test_suite_skip suite=test:wave-claim-gates reason=platform_invariant_trigger/);
});

test("release-quality trigger path runs release_quality gate telemetry", () => {
  const { run, stdout } = runHookScenario({
    stagedPaths: ["factories/_templates/factory/factory.config.json.template"],
  });

  assert.equal(run.status, 0);
  assert.match(stdout, /\[pre-commit\] gate_start gate=release_quality family=core_invariants/);
  assert.match(stdout, /\[pre-commit\] gate_pass gate=release_quality family=docs_skills_template_contracts/);
});

test("empty staged set stays in neither-change branch with no gates or suites", () => {
  const { run, repoDir, pnpmInvocations, stdout } = runHookScenario({
    stagedPaths: [],
  });

  assert.equal(run.status, 0);
  assertNpmInvocationContract(pnpmInvocations, [], repoDir);
  assert.match(stdout, /\[pre-commit\] gates_skipped branch=empty reason=no_staged_paths/);
  assert.match(stdout, /\[pre-commit\] test_suites_decision action=skip reason=no_staged_paths/);
  assert.match(stdout, /test_suite_skip suite=test:guard-gates reason=no_staged_paths/);
  assert.match(stdout, /test_suite_skip suite=test:wave-claim-gates reason=no_staged_paths/);
});

test("dot validation failure is fail-fast with one first-failure event", () => {
  const { run, repoDir, pnpmInvocations, stderr } = runHookScenario({
    stagedPaths: [MOTHERSHIP_WAVE_EXECUTE_DOT],
    envOverrides: {
      PRE_COMMIT_HATCH_EXIT: "13",
    },
  });

  assert.equal(run.status, 13);
  assertNpmInvocationContract(pnpmInvocations, [], repoDir);
  assert.match(stderr, /\[pre-commit\] first_failure phase=dot_validate target=factories\/mothership\/graphs\/wave_execute\.dot exit=13/);
  const firstFailureCount = (stderr.match(/\[pre-commit\] first_failure /g) ?? []).length;
  assert.equal(firstFailureCount, 1);
});
test("lint-dot failure is fail-fast with one first-failure event", () => {
  const { run, repoDir, pnpmInvocations, stderr } = runHookScenario({
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

  assert.equal(run.status, 19);
  assertNpmInvocationContract(pnpmInvocations, [], repoDir);
  assert.match(stderr, new RegExp(`\\${LINT_DOT_MARKER_PREFIX} result=${LINT_DOT_RESULT.fail}`));
  assert.match(stderr, /\[pre-commit\] first_failure phase=dot_validate target=factories\/mothership\/graphs\/wave_execute\.dot exit=19/);
  const firstFailureCount = (stderr.match(/\[pre-commit\] first_failure /g) ?? []).length;
  assert.equal(firstFailureCount, 1);
});

test("docs check failure is fail-fast with one first-failure event", () => {
  const { run, repoDir, pnpmInvocations, stderr } = runHookScenario({
    stagedPaths: ["docs/state-machines.md"],
    envOverrides: {
      PRE_COMMIT_DOCS_CHECK_EXIT: "14",
    },
  });

  assert.equal(run.status, 14);
  assertNpmInvocationContract(pnpmInvocations, ["docs:check"], repoDir);
  assert.match(stderr, /\[pre-commit\] first_failure phase=docs_check target=docs:check exit=14/);
  const firstFailureCount = (stderr.match(/\[pre-commit\] first_failure /g) ?? []).length;
  assert.equal(firstFailureCount, 1);
});

test("benchmark job_id registry gate runs for mothership graph paths", () => {
  const { run, output } = runHookScenario({
    stagedPaths: [MOTHERSHIP_WAVE_EXECUTE_DOT],
  });

  assert.equal(run.status, 0, output);
  assert.match(output, /\[context_propagation_contract\] result=ok/);
  assert.match(output, /Checking benchmark job_id registry/);
  assert.match(output, /\[benchmark-job-id-registry\] result=ok/);
  const contextIdx = output.indexOf("[context_propagation_contract] result=ok");
  const benchmarkIdx = output.indexOf("Checking benchmark job_id registry");
  const docsIdx = output.indexOf("Checking docs policy scope");
  assert.ok(contextIdx >= 0);
  assert.ok(benchmarkIdx >= 0);
  assert.ok(contextIdx < benchmarkIdx, "context propagation contract should run before benchmark job_id registry");
  if (docsIdx >= 0) {
    assert.ok(benchmarkIdx < docsIdx, "benchmark job_id registry should run before docs_check when both exist");
  }
});

test("benchmark job_id registry gate failure is fail-fast with deterministic telemetry", () => {
  const { run, stderr, output, pnpmInvocations, repoDir } = runHookScenario({
    stagedPaths: ["docs/contracts/benchmark-job-id-registry.json"],
    fileContents: {
      "docs/contracts/benchmark-job-id-registry.json": "{}\n",
    },
    envOverrides: {
      PRE_COMMIT_BENCHMARK_JOB_ID_REGISTRY_EXIT: "17",
    },
  });

  assert.equal(run.status, 17, output);
  assertNpmInvocationContract(pnpmInvocations, ["docs:check"], repoDir);
  assert.match(stderr, /\[pre-commit\] first_failure phase=benchmark_job_id_registry target=check-benchmark-job-id-registry exit=17/);
  assert.doesNotMatch(output, /gate_start gate=build/);
  const firstFailureCount = (stderr.match(/\[pre-commit\] first_failure /g) ?? []).length;
  assert.equal(firstFailureCount, 1);
});

test("context propagation contract runs for handler-source changes without dot edits", () => {
  const { run, contextPropagationContractCalls, output } = runHookScenario({
    stagedPaths: ["apps/hatch/src/pipeline/handler/worktree.ts"],
  });

  assert.equal(run.status, 0, output);
  assert.equal(contextPropagationContractCalls.length, 1);
  assert.match(contextPropagationContractCalls[0], /--staged-file-list\s+\S*staged-files\.list/);
  assert.match(output, /\[context_propagation_contract\] result=ok/);
  assert.doesNotMatch(output, /Validating factories\/mothership\/graphs\//);
});

test("context propagation contract failure emits first_failure and skips non-preflight gates", () => {
  const { run, stderr, output, repoDir, pnpmInvocations } = runHookScenario({
    stagedPaths: [MOTHERSHIP_WAVE_EXECUTE_DOT],
    envOverrides: {
      PRE_COMMIT_CONTEXT_PROPAGATION_CONTRACT_EXIT: "35",
    },
  });

  assert.equal(run.status, 35, output);
  assertNpmInvocationContract(pnpmInvocations, [], repoDir);
  assert.match(stderr, /\[pre-commit\] first_failure phase=context_propagation_contract target=check-context-propagation-contract exit=35/);
  assert.match(output, /Checking benchmark job_id registry/);
  assert.doesNotMatch(output, /gate_start gate=build/);
});

test("scenario registry budget gate failure emits first_failure and skips non-preflight gates", () => {
  const { run, stderr, output, repoDir, pnpmInvocations } = runHookScenario({
    stagedPaths: ["packages/factory-ops/src/commands/scenario-count-gate.ts"],
    envOverrides: {
      PRE_COMMIT_SCENARIO_REGISTRY_BUDGET_EXIT: "36",
    },
  });

  assert.equal(run.status, 36, output);
  assertNpmInvocationContract(pnpmInvocations, [], repoDir);
  assert.match(output, /\[scenario_registry_budget\] result=fail/);
  assert.match(stderr, /\[pre-commit\] first_failure phase=scenario_registry_budget target=check-scenario-registry-budget exit=36/);
  assert.doesNotMatch(output, /gate_start gate=build/);
});

test("scenario registry budget gate runs for all staged changes", () => {
  const { run, output } = runHookScenario({
    stagedPaths: ["apps/hatch/src/cli.ts"],
  });

  assert.equal(run.status, 0, output);
  assert.match(output, /\[scenario_registry_budget\] result=ok/);
});

test("malformed staged docs policy still fails through docs_check telemetry contract", () => {
  const { run, repoDir, pnpmInvocations, stdout, stderr } = runHookScenario({
    stagedPaths: ["docs/docs-policy.json"],
    fileContents: {
      "docs/docs-policy.json": "{\n  \"docs_policy/v1\": {\n    \"in_scope_paths\": [\n",
    },
    envOverrides: {
      PRE_COMMIT_DOCS_CHECK_EXIT: "14",
    },
  });

  assert.equal(run.status, 14);
  assertNpmInvocationContract(pnpmInvocations, ["docs:check"], repoDir);
  assert.match(stdout, /Checking docs policy scope/);
  assert.match(stderr, /\[pre-commit\] first_failure phase=docs_check target=docs:check exit=14/);
  const firstFailureCount = (stderr.match(/\[pre-commit\] first_failure /g) ?? []).length;
  assert.equal(firstFailureCount, 1);
});

test("line-limit failure reports first violating file and aborts before gates", () => {
  const overLimitFile = "apps/hatch/src/too-long.ts";
  const overLimitContent = `${Array.from({ length: 1201 }, (_, i) => `line_${i + 1};`).join("\n")}\n`;

  const { run, repoDir, pnpmInvocations, stderr } = runHookScenario({
    stagedPaths: [overLimitFile],
    fileContents: {
      [overLimitFile]: overLimitContent,
    },
  });

  assert.equal(run.status, 1);
  assertNpmInvocationContract(pnpmInvocations, [], repoDir);
  assert.match(stderr, new RegExp(`\\[pre-commit\\] first_failure phase=line_limit target=${overLimitFile.replace(/\//g, "\\/")} exit=1`));
  const firstFailureCount = (stderr.match(/\[pre-commit\] first_failure /g) ?? []).length;
  assert.equal(firstFailureCount, 1);
});

test("quality gate failure propagates fail-fast diagnostics and blocks suite work", () => {
  const { run, repoDir, pnpmInvocations, stderr } = runHookScenario({
    stagedPaths: ["apps/hatch/src/cli.ts"],
    envOverrides: {
      PRE_COMMIT_BUILD_EXIT: "17",
    },
  });

  assert.equal(run.status, 17);
  assertNpmInvocationContract(pnpmInvocations, ["build"], repoDir);
  assert.match(stderr, /\[pre-commit\] first_failure phase=quality_gate target=build command="pnpm build[^"]*" exit=17/);
  const firstFailureCount = (stderr.match(/\[pre-commit\] first_failure /g) ?? []).length;
  assert.equal(firstFailureCount, 1);
});

test("runtime startup probe failure is reported before typecheck", () => {
  const { run, repoDir, pnpmInvocations, output } = runHookScenario({
    stagedPaths: ["apps/hatch/src/cli.ts"],
    envOverrides: {
      PRE_COMMIT_RUNTIME_STARTUP_PROBE_EXIT: "29",
    },
  });

  assert.equal(run.status, 29, output);
  assertNpmInvocationContract(pnpmInvocations, ["build"], repoDir);
  assert.match(output, /\[pre-commit\] gate_pass gate=build command="pnpm build[^"]*" exit=0/);
  assert.match(output, /\[pre-commit\] gate_failed gate=runtime_startup_probe command="node scripts\/check-runtime-startup-probe\.mjs" exit=29/);
  assert.match(output, /\[pre-commit\] first_failure phase=quality_gate target=runtime_startup_probe command="node scripts\/check-runtime-startup-probe\.mjs" exit=29/);
  assert.doesNotMatch(output, /gate_start gate=typecheck/);
});

test("suite failure propagates fail-fast diagnostics and exits with exact status", () => {
  const { run, repoDir, pnpmInvocations, stderr, stdout } = runHookScenario({
    stagedPaths: ["apps/hatch/src/cli.ts"],
    envOverrides: {
      PRE_COMMIT_TEST_GUARD_GATES_EXIT: "31",
    },
  });

  assert.equal(run.status, 31);
  assertNpmInvocationContract(pnpmInvocations, ["build", "typecheck", "test:guard-gates"], repoDir);
  assert.match(stderr, /\[pre-commit\] first_failure phase=test_suite target=test:guard-gates command="pnpm test:guard-gates[^"]*" exit=31/);
  assert.doesNotMatch(stdout, /test_suite_start suite=test:wave-claim-gates/);
  const firstFailureCount = (stderr.match(/\[pre-commit\] first_failure /g) ?? []).length;
  assert.equal(firstFailureCount, 1);
});
