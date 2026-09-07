import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { baselineFixtureCommit, initFixtureRepo, runFixtureGit } from "./test/helpers/git-fixture.mjs";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");
const sourceHookPath = join(repoRoot, ".githooks", "pre-push");
const sourceClassifierPath = join(repoRoot, "scripts", "pre-commit-staged-file-classifier.mjs");
const sourceRunGatesPath = join(repoRoot, "scripts", "run-gates.mjs");
const sourcePlatformInvariantRunnerPath = join(repoRoot, "scripts", "run-platform-invariant-gates.mjs");
const sourcePlatformInvariantManifestPath = join(repoRoot, "scripts", "lib", "platform-invariant-manifest.ts");
const sourceRoutingConfigPath = join(repoRoot, "scripts", "lib", "pre-commit-routing-config.ts");
const sourceSuiteRoutingConfigPath = join(repoRoot, "scripts", "lib", "suite-routing-config.ts");
const sourceGateManifestPath = join(repoRoot, "scripts", "lib", "gate-manifest.ts");
const sourcePhase1GateScopeContractPath = join(repoRoot, "scripts", "lib", "phase1-gate-scope-contract.ts");
const sourceOtelTaxonomyContractCheckerPath = join(repoRoot, "scripts", "check-otel-taxonomy-contract.mjs");
const sourceOtelTaxonomyContractLibPath = join(repoRoot, "scripts", "lib", "otel-taxonomy-contract.ts");
const sourceOtelTaxonomySourceJsonPath = join(repoRoot, "packages", "factory-telemetry", "src", "otel-contract.json");
const sourceWorkflowInstrumentationHelperCheckerPath = join(repoRoot, "scripts", "check-workflow-instrumentation-helper-contract.mjs");
const sourceWorkflowInstrumentationHelperLibPath = join(repoRoot, "scripts", "lib", "workflow-instrumentation-helper-contract.ts");
const sourceReactorCollectorCheckerPath = join(repoRoot, "scripts", "check-reactor-collector-contract.mjs");
const sourceReactorCollectorLibPath = join(repoRoot, "scripts", "lib", "reactor-collector-contract.ts");
const sourceReactorInstrumentationPath = join(repoRoot, "apps", "hatch", "src", "pipeline", "reactor-instrumentation.ts");
const sourceOtelRuntimePath = join(repoRoot, "packages", "factory-telemetry", "src", "otel-stdout.ts");
const sourceCollectorProfilePath = join(repoRoot, "packages", "factory-telemetry", "config", "otel-collector.yaml");
const sourceLineLimitCheckerPath = join(repoRoot, "scripts", "check-line-limit.mjs");
const sourceHatchArtifactBoundaryCheckerPath = join(repoRoot, "scripts", "check-hatch-artifact-boundary.mjs");
const sourceModuleBoundaryCheckerPath = join(repoRoot, "scripts", "check-module-boundaries.mjs");
const sourceTestTopologyCheckerPath = join(repoRoot, "scripts", "check-test-topology.mjs");
const sourceFixtureOwnershipCheckerPath = join(repoRoot, "scripts", "check-fixture-ownership.mjs");
const sourceSharedSurfaceOwnershipCheckerPath = join(repoRoot, "scripts", "check-shared-surface-ownership.mjs");
const sourceDailyLensCollectorOwnershipCheckerPath = join(repoRoot, "scripts", "check-daily-lens-collector-ownership.mjs");
const sourceTestBoundaryCheckerPath = join(repoRoot, "scripts", "check-test-boundaries.mjs");
const sourceTestClassificationCheckerPath = join(repoRoot, "scripts", "check-test-classification.mjs");
const sourceIrreversibleNodeCoverageCheckerPath = join(repoRoot, "scripts", "check-irreversible-node-coverage.mjs");
const sourceWorkspaceExportCoverageCheckerPath = join(repoRoot, "scripts", "check-workspace-export-coverage.mjs");
const sourceCoveragePolicyCheckerPath = join(repoRoot, "scripts", "check-coverage-policy-ratchet.mjs");
const sourceCoveragePolicyBaselinePath = join(repoRoot, "scripts", "coverage-policy-ratchet-baseline.json");
const sourceRuntimeStartupProbePath = join(repoRoot, "scripts", "check-runtime-startup-probe.mjs");
const sourceSubsystemOwnershipCheckerPath = join(repoRoot, "scripts", "check-subsystem-ownership.mjs");
const sourceContextPropagationCheckerPath = join(repoRoot, "scripts", "check-context-propagation-contract.mjs");
const sourcePipelineSegmentCoverageCheckerPath = join(repoRoot, "scripts", "check-pipeline-segment-coverage.mjs");
const sourceScenarioRegistryBudgetCheckerPath = join(repoRoot, "scripts", "check-scenario-registry-budget.mjs");
const sourceScenarioRegistryBudgetConfigPath = join(repoRoot, "scripts", "config", "scenario-registry.json");
const sourceHandlerContextContractPath = join(repoRoot, "scripts", "handler-context-contract.json");
const sourceDocsPolicyValidatorPath = join(repoRoot, "scripts", "lib", "docs-policy-validator.ts");
const sourceLiveDocAssetsManifestPath = join(repoRoot, "scripts", "lib", "live-doc-assets-manifest.ts");
const sourceDocsTemplateFrameworkPath = join(repoRoot, "scripts", "lib", "docs-template-framework.ts");
const sourceTestClassificationBaselinePath = join(repoRoot, "scripts", "test-classification-baseline.json");
const sourceIrreversibleNodeCoverageExclusionsPath = join(repoRoot, "scripts", "lib", "irreversible-node-coverage-exclusions.ts");
const sourceIrreversibleNodeCoverageManifestPath = join(repoRoot, "scripts", "lib", "irreversible-node-coverage-manifest.ts");
const sourceDocsPolicyPath = join(repoRoot, "docs", "docs-policy.json");
const sourceDocsPolicySchemaPath = join(repoRoot, "docs", "docs-policy.schema.json");
const sourceSuiteRoutingJsonPath = join(repoRoot, "config", "testing", "suite-routing.json");
const sourceTopologyEnforcementJsonPath = join(repoRoot, "config", "testing", "topology-enforcement.json");
const sourceSharedSurfaceOwnershipJsonPath = join(repoRoot, "config", "testing", "shared-surface-ownership.json");
const sourceSubsystemOwnershipJsonPath = join(repoRoot, "config", "testing", "subsystem-ownership.json");
const npmStubBinDir = join(repoRoot, "scripts", "test", "fixtures", "pre-commit-quality-gates", "bin");
const fixtureRoot = join(repoRoot, "scripts", "test", "fixtures", "pre-push", "scenarios");


function ensureFile(repoDir, relativePath, content) {
  const absolutePath = join(repoDir, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
}

function listGateManifestCheckers() {
  const manifestSource = readFileSync(sourceGateManifestPath, "utf8");
  return [...new Set([...manifestSource.matchAll(/scripts\/(check-[A-Za-z0-9-]+\.mjs)/g)].map((match) => match[1]))].sort();
}

function ensureGenericChecker(repoDir, scriptName) {
  const relativePath = join("scripts", scriptName);
  const absolutePath = join(repoDir, relativePath);
  if (existsSync(absolutePath)) {
    return;
  }

  ensureFile(
    repoDir,
    relativePath,
    "#!/usr/bin/env node\n" +
      `console.log('[${scriptName.replace(/\.mjs$/, "")}] result=ok mode=stub');\n` +
      "process.exit(0);\n",
  );
  chmodSync(absolutePath, 0o755);
}

function loadScenario(name) {
  return JSON.parse(readFileSync(join(fixtureRoot, `${name}.json`), "utf8"));
}

function setupRepoForMainPushDiff(changedPath) {
  const repoDir = mkdtempSync(join(tmpdir(), "pre-push-hook-"));

  mkdirSync(join(repoDir, ".githooks"), { recursive: true });
  mkdirSync(join(repoDir, "config", "testing"), { recursive: true });
  mkdirSync(join(repoDir, "scripts", "lib"), { recursive: true });
  mkdirSync(join(repoDir, "scripts", "config"), { recursive: true });
  mkdirSync(join(repoDir, "docs"), { recursive: true });
  mkdirSync(join(repoDir, "node_modules", "acorn"), { recursive: true });
  mkdirSync(join(repoDir, "node_modules", "ajv"), { recursive: true });
  mkdirSync(join(repoDir, "node_modules", "zod"), { recursive: true });
  mkdirSync(join(repoDir, "node_modules", "@hatch", "factory-ops"), { recursive: true });
  mkdirSync(join(repoDir, "packages", "factory-ops", "node_modules", "@hatch", "factory-core"), { recursive: true });
  mkdirSync(join(repoDir, "packages", "factory-ops", "node_modules", "@hatch", "github-adapter"), { recursive: true });
  mkdirSync(join(repoDir, "packages", "factory-ops", "node_modules", "@recallnet", "factory-telemetry"), { recursive: true });
  mkdirSync(join(repoDir, "packages", "factory-ops", "node_modules", "clipanion"), { recursive: true });
  mkdirSync(join(repoDir, "packages", "factory-ops", "node_modules", "hatch"), { recursive: true });
  mkdirSync(join(repoDir, "packages", "factory-ops", "node_modules", "pg"), { recursive: true });
  mkdirSync(join(repoDir, "packages", "github-adapter", "node_modules", "@hatch", "factory-core"), { recursive: true });
  mkdirSync(join(repoDir, "packages", "github-adapter", "node_modules", "zod"), { recursive: true });
  mkdirSync(join(repoDir, "packages", "factory-telemetry", "src"), { recursive: true });

  writeFileSync(
    join(repoDir, "package.json"),
    "{\"name\":\"fixture\",\"private\":true,\"devDependencies\":{\"acorn\":\"^8.14.0\",\"zod\":\"^4.3.6\"}}\n",
  );
  writeFileSync(join(repoDir, "node_modules", "acorn", "package.json"), "{\"name\":\"acorn\"}\n");
  writeFileSync(join(repoDir, "node_modules", "ajv", "package.json"), "{\"name\":\"ajv\"}\n");
  writeFileSync(join(repoDir, "node_modules", "zod", "package.json"), "{\"name\":\"zod\"}\n");
  writeFileSync(join(repoDir, "node_modules", "@hatch", "factory-ops", "package.json"), "{\"name\":\"@hatch/factory-ops\"}\n");
  writeFileSync(join(repoDir, "packages", "factory-ops", "node_modules", "@hatch", "factory-core", "package.json"), "{\"name\":\"@hatch/factory-core\"}\n");
  writeFileSync(join(repoDir, "packages", "factory-ops", "node_modules", "@hatch", "github-adapter", "package.json"), "{\"name\":\"@hatch/github-adapter\"}\n");
  writeFileSync(join(repoDir, "packages", "factory-ops", "node_modules", "@recallnet", "factory-telemetry", "package.json"), "{\"name\":\"@recallnet/factory-telemetry\"}\n");
  writeFileSync(join(repoDir, "packages", "factory-ops", "node_modules", "clipanion", "package.json"), "{\"name\":\"clipanion\"}\n");
  writeFileSync(join(repoDir, "packages", "factory-ops", "node_modules", "hatch", "package.json"), "{\"name\":\"hatch\"}\n");
  writeFileSync(join(repoDir, "packages", "factory-ops", "node_modules", "pg", "package.json"), "{\"name\":\"pg\"}\n");
  writeFileSync(join(repoDir, "packages", "github-adapter", "node_modules", "@hatch", "factory-core", "package.json"), "{\"name\":\"@hatch/factory-core\"}\n");
  writeFileSync(join(repoDir, "packages", "github-adapter", "node_modules", "zod", "package.json"), "{\"name\":\"zod\"}\n");

  copyFileSync(sourceHookPath, join(repoDir, ".githooks", "pre-push"));
  chmodSync(join(repoDir, ".githooks", "pre-push"), 0o755);
  copyFileSync(sourceClassifierPath, join(repoDir, "scripts", "pre-commit-staged-file-classifier.mjs"));
  copyFileSync(sourceRunGatesPath, join(repoDir, "scripts", "run-gates.mjs"));
  copyFileSync(sourcePlatformInvariantRunnerPath, join(repoDir, "scripts", "run-platform-invariant-gates.mjs"));
  copyFileSync(sourceLineLimitCheckerPath, join(repoDir, "scripts", "check-line-limit.mjs"));
  copyFileSync(sourceHatchArtifactBoundaryCheckerPath, join(repoDir, "scripts", "check-hatch-artifact-boundary.mjs"));
  copyFileSync(sourceModuleBoundaryCheckerPath, join(repoDir, "scripts", "check-module-boundaries.mjs"));
  copyFileSync(sourceTestTopologyCheckerPath, join(repoDir, "scripts", "check-test-topology.mjs"));
  copyFileSync(sourceFixtureOwnershipCheckerPath, join(repoDir, "scripts", "check-fixture-ownership.mjs"));
  copyFileSync(sourceSharedSurfaceOwnershipCheckerPath, join(repoDir, "scripts", "check-shared-surface-ownership.mjs"));
  copyFileSync(sourceDailyLensCollectorOwnershipCheckerPath, join(repoDir, "scripts", "check-daily-lens-collector-ownership.mjs"));
  copyFileSync(sourceTestBoundaryCheckerPath, join(repoDir, "scripts", "check-test-boundaries.mjs"));
  copyFileSync(sourceTestClassificationCheckerPath, join(repoDir, "scripts", "check-test-classification.mjs"));
  copyFileSync(sourceIrreversibleNodeCoverageCheckerPath, join(repoDir, "scripts", "check-irreversible-node-coverage.mjs"));
  copyFileSync(sourcePlatformInvariantManifestPath, join(repoDir, "scripts", "lib", "platform-invariant-manifest.ts"));
  copyFileSync(sourceRoutingConfigPath, join(repoDir, "scripts", "lib", "pre-commit-routing-config.ts"));
  copyFileSync(sourceSuiteRoutingConfigPath, join(repoDir, "scripts", "lib", "suite-routing-config.ts"));
  copyFileSync(sourceGateManifestPath, join(repoDir, "scripts", "lib", "gate-manifest.ts"));
  copyFileSync(sourcePhase1GateScopeContractPath, join(repoDir, "scripts", "lib", "phase1-gate-scope-contract.ts"));
  copyFileSync(sourceOtelTaxonomyContractCheckerPath, join(repoDir, "scripts", "check-otel-taxonomy-contract.mjs"));
  copyFileSync(sourceOtelTaxonomyContractLibPath, join(repoDir, "scripts", "lib", "otel-taxonomy-contract.ts"));
  copyFileSync(sourceOtelTaxonomySourceJsonPath, join(repoDir, "packages", "factory-telemetry", "src", "otel-contract.json"));
  copyFileSync(sourceWorkflowInstrumentationHelperCheckerPath, join(repoDir, "scripts", "check-workflow-instrumentation-helper-contract.mjs"));
  copyFileSync(sourceWorkflowInstrumentationHelperLibPath, join(repoDir, "scripts", "lib", "workflow-instrumentation-helper-contract.ts"));
  copyFileSync(sourceReactorCollectorCheckerPath, join(repoDir, "scripts", "check-reactor-collector-contract.mjs"));
  copyFileSync(sourceReactorCollectorLibPath, join(repoDir, "scripts", "lib", "reactor-collector-contract.ts"));
  mkdirSync(join(repoDir, "apps", "hatch", "src", "pipeline"), { recursive: true });
  mkdirSync(join(repoDir, "packages", "factory-telemetry", "src"), { recursive: true });
  mkdirSync(join(repoDir, "packages", "factory-telemetry", "config"), { recursive: true });
  copyFileSync(sourceReactorInstrumentationPath, join(repoDir, "apps", "hatch", "src", "pipeline", "reactor-instrumentation.ts"));
  copyFileSync(sourceOtelRuntimePath, join(repoDir, "packages", "factory-telemetry", "src", "otel-stdout.ts"));
  copyFileSync(sourceCollectorProfilePath, join(repoDir, "packages", "factory-telemetry", "config", "otel-collector.yaml"));
  copyFileSync(sourceIrreversibleNodeCoverageExclusionsPath, join(repoDir, "scripts", "lib", "irreversible-node-coverage-exclusions.ts"));
  copyFileSync(sourceIrreversibleNodeCoverageManifestPath, join(repoDir, "scripts", "lib", "irreversible-node-coverage-manifest.ts"));
  copyFileSync(sourceWorkspaceExportCoverageCheckerPath, join(repoDir, "scripts", "check-workspace-export-coverage.mjs"));
  copyFileSync(sourceCoveragePolicyCheckerPath, join(repoDir, "scripts", "check-coverage-policy-ratchet.mjs"));
  copyFileSync(sourceCoveragePolicyBaselinePath, join(repoDir, "scripts", "coverage-policy-ratchet-baseline.json"));
  copyFileSync(sourceTestClassificationBaselinePath, join(repoDir, "scripts", "test-classification-baseline.json"));
  copyFileSync(sourceRuntimeStartupProbePath, join(repoDir, "scripts", "check-runtime-startup-probe.mjs"));
  copyFileSync(sourceSubsystemOwnershipCheckerPath, join(repoDir, "scripts", "check-subsystem-ownership.mjs"));
  copyFileSync(sourceContextPropagationCheckerPath, join(repoDir, "scripts", "check-context-propagation-contract.mjs"));
  copyFileSync(sourcePipelineSegmentCoverageCheckerPath, join(repoDir, "scripts", "check-pipeline-segment-coverage.mjs"));
  copyFileSync(sourceScenarioRegistryBudgetCheckerPath, join(repoDir, "scripts", "check-scenario-registry-budget.mjs"));
  copyFileSync(sourceScenarioRegistryBudgetConfigPath, join(repoDir, "scripts", "config", "scenario-registry.json"));
  copyFileSync(sourceHandlerContextContractPath, join(repoDir, "scripts", "handler-context-contract.json"));
  copyFileSync(sourceDocsPolicyValidatorPath, join(repoDir, "scripts", "lib", "docs-policy-validator.ts"));
  copyFileSync(sourceLiveDocAssetsManifestPath, join(repoDir, "scripts", "lib", "live-doc-assets-manifest.ts"));
  copyFileSync(sourceDocsTemplateFrameworkPath, join(repoDir, "scripts", "lib", "docs-template-framework.ts"));
  copyFileSync(sourceDocsPolicyPath, join(repoDir, "docs", "docs-policy.json"));
  copyFileSync(sourceDocsPolicySchemaPath, join(repoDir, "docs", "docs-policy.schema.json"));
  copyFileSync(sourceSuiteRoutingJsonPath, join(repoDir, "config", "testing", "suite-routing.json"));
  copyFileSync(sourceTopologyEnforcementJsonPath, join(repoDir, "config", "testing", "topology-enforcement.json"));
  copyFileSync(sourceSharedSurfaceOwnershipJsonPath, join(repoDir, "config", "testing", "shared-surface-ownership.json"));
  copyFileSync(sourceSubsystemOwnershipJsonPath, join(repoDir, "config", "testing", "subsystem-ownership.json"));

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

  ensureFile(
    repoDir,
    "scripts/eslint-gate.mjs",
    "#!/usr/bin/env node\n" +
      "const exit = Number.parseInt(process.env.PRE_PUSH_ESLINT_EXIT || '0', 10);\n" +
      "console.log('[eslint] result=' + (exit ? 'fail' : 'ok') + ' files=1');\n" +
      "process.exit(exit);\n",
  );
  chmodSync(join(repoDir, "scripts", "eslint-gate.mjs"), 0o755);

  ensureFile(
    repoDir,
    "scripts/check-workspace-export-coverage.mjs",
    "#!/usr/bin/env node\n" +
      "const exit = Number.parseInt(process.env.PRE_PUSH_WORKSPACE_EXPORT_COVERAGE_EXIT || '0', 10);\n" +
      "if (process.env.PRE_PUSH_WORKSPACE_EXPORT_COVERAGE_STUB_LOG) {\n" +
      "  const { appendFileSync } = await import('node:fs');\n" +
      "  appendFileSync(process.env.PRE_PUSH_WORKSPACE_EXPORT_COVERAGE_STUB_LOG, 'check-workspace-export-coverage\\n');\n" +
      "}\n" +
      "console.log('[workspace-export-coverage] result=' + (exit ? 'fail' : 'ok') + ' new_gaps=0');\n" +
      "process.exit(exit);\n",
  );
  chmodSync(join(repoDir, "scripts", "check-workspace-export-coverage.mjs"), 0o755);

  ensureFile(
    repoDir,
    "scripts/check-coverage-policy-ratchet.mjs",
    "#!/usr/bin/env node\n" +
      "const exit = Number.parseInt(process.env.PRE_PUSH_COVERAGE_POLICY_EXIT || '0', 10);\n" +
      "if (process.env.PRE_PUSH_COVERAGE_POLICY_STUB_LOG) {\n" +
      "  const { appendFileSync } = await import('node:fs');\n" +
      "  appendFileSync(process.env.PRE_PUSH_COVERAGE_POLICY_STUB_LOG, 'check-coverage-policy-ratchet\\n');\n" +
      "}\n" +
      "console.log('[coverage-policy] result=' + (exit ? 'fail' : 'ok') + ' violations=0');\n" +
      "process.exit(exit);\n",
  );
  chmodSync(join(repoDir, "scripts", "check-coverage-policy-ratchet.mjs"), 0o755);

  ensureFile(
    repoDir,
    "scripts/check-runtime-startup-probe.mjs",
    "#!/usr/bin/env node\n" +
      "const exit = Number.parseInt(process.env.PRE_PUSH_RUNTIME_STARTUP_PROBE_EXIT || '0', 10);\n" +
      "if (process.env.PRE_PUSH_RUNTIME_STARTUP_PROBE_STUB_LOG) {\n" +
      "  const { appendFileSync } = await import('node:fs');\n" +
      "  appendFileSync(process.env.PRE_PUSH_RUNTIME_STARTUP_PROBE_STUB_LOG, 'check-runtime-startup-probe\\n');\n" +
      "}\n" +
      "console.log('[runtime-startup-probe] result=' + (exit ? 'fail' : 'ok') + ' probes=3');\n" +
      "process.exit(exit);\n",
  );
  chmodSync(join(repoDir, "scripts", "check-runtime-startup-probe.mjs"), 0o755);

  ensureFile(
    repoDir,
    "scripts/check-otel-taxonomy-contract.mjs",
    "#!/usr/bin/env node\n" +
      "const exit = Number.parseInt(process.env.PRE_PUSH_OTEL_TAXONOMY_CONTRACT_EXIT || '0', 10);\n" +
      "console.log('[otel-taxonomy-contract] result=' + (exit ? 'fail' : 'ok') + ' governed_emitters=0 direct_bypass_files=0 diagnostics=0');\n" +
      "process.exit(exit);\n",
  );
  chmodSync(join(repoDir, "scripts", "check-otel-taxonomy-contract.mjs"), 0o755);

  ensureFile(
    repoDir,
    "scripts/check-workflow-instrumentation-helper-contract.mjs",
    "#!/usr/bin/env node\n" +
      "const exit = Number.parseInt(process.env.PRE_PUSH_WORKFLOW_INSTRUMENTATION_HELPER_CONTRACT_EXIT || '0', 10);\n" +
      "console.log('[workflow-instrumentation-helper] result=' + (exit ? 'fail' : 'ok') + ' helper_consumer_files=0 direct_bypass_files=0 diagnostics=0');\n" +
      "process.exit(exit);\n",
  );
  chmodSync(join(repoDir, "scripts", "check-workflow-instrumentation-helper-contract.mjs"), 0o755);

  ensureFile(
    repoDir,
    "scripts/check-irreversible-node-coverage.mjs",
    "#!/usr/bin/env node\n" +
      "const exit = Number.parseInt(process.env.PRE_PUSH_IRREVERSIBLE_NODE_COVERAGE_EXIT || '0', 10);\n" +
      "console.log('[irreversible-node-coverage] result=' + (exit ? 'fail' : 'ok') + ' checked=1 violations=' + (exit ? 1 : 0));\n" +
      "process.exit(exit);\n",
  );
  chmodSync(join(repoDir, "scripts", "check-irreversible-node-coverage.mjs"), 0o755);

  ensureFile(
    repoDir,
    "scripts/check-context-propagation-contract.mjs",
    "#!/usr/bin/env node\n" +
      "const exit = Number.parseInt(process.env.PRE_PUSH_CONTEXT_PROPAGATION_CONTRACT_EXIT || '0', 10);\n" +
      "if (process.env.PRE_PUSH_CONTEXT_PROPAGATION_CONTRACT_STUB_LOG) {\n" +
      "  const { appendFileSync } = await import('node:fs');\n" +
      "  appendFileSync(process.env.PRE_PUSH_CONTEXT_PROPAGATION_CONTRACT_STUB_LOG, process.argv.slice(2).join(' ') + '\\n');\n" +
      "}\n" +
      "console.log('[context_propagation_contract] result=' + (exit ? 'fail' : 'ok') + ' checked=1 violations=' + (exit ? 1 : 0));\n" +
      "process.exit(exit);\n",
  );
  chmodSync(join(repoDir, "scripts", "check-context-propagation-contract.mjs"), 0o755);

  ensureFile(
    repoDir,
    "scripts/check-internal-cli-transport.mjs",
    "#!/usr/bin/env node\n" +
      "const exit = Number.parseInt(process.env.PRE_COMMIT_INTERNAL_CLI_TRANSPORT_EXIT || '0', 10);\n" +
      "console.log('[internal-cli-transport] result=' + (exit ? 'fail' : 'ok') + ' checked=0 graph=0 runtime=0 opted_in_graph=0');\n" +
      "process.exit(exit);\n",
  );
  chmodSync(join(repoDir, "scripts", "check-internal-cli-transport.mjs"), 0o755);

  ensureFile(
    repoDir,
    "scripts/check-active-surface-manifest.mjs",
    "#!/usr/bin/env node\n" +
      "const exit = Number.parseInt(process.env.PRE_COMMIT_ACTIVE_SURFACE_MANIFEST_EXIT || '0', 10);\n" +
      "console.log('[active-surface-manifest] result=' + (exit ? 'fail' : 'ok') + ' checked=0 graph=0 runtime=0 command=0 diagnostics=0');\n" +
      "process.exit(exit);\n",
  );
  chmodSync(join(repoDir, "scripts", "check-active-surface-manifest.mjs"), 0o755);
  ensureFile(
    repoDir,
    "scripts/check-active-surface-inventory.mjs",
    "#!/usr/bin/env node\n" +
      "const exit = Number.parseInt(process.env.PRE_COMMIT_ACTIVE_SURFACE_INVENTORY_EXIT || '0', 10);\n" +
      "console.log('[active-surface-inventory] result=' + (exit ? 'fail' : 'ok') + ' roots=0 graphs=0 runtime=0 commands=0 diagnostics=0');\n" +
      "process.exit(exit);\n",
  );
  chmodSync(join(repoDir, "scripts", "check-active-surface-inventory.mjs"), 0o755);
  ensureFile(
    repoDir,
    "scripts/check-phase1-gate-readiness.mjs",
    "#!/usr/bin/env node\n" +
      "const exit = Number.parseInt(process.env.PRE_PUSH_PHASE1_GATE_READINESS_EXIT || '0', 10);\n" +
      "console.log('[phase1-gate-readiness] result=' + (exit ? 'fail' : 'ok') + ' graph=0 runtime=0 command=0 diagnostics=0');\n" +
      "process.exit(exit);\n",
  );
  chmodSync(join(repoDir, "scripts", "check-phase1-gate-readiness.mjs"), 0o755);
  ensureFile(
    repoDir,
    "scripts/check-phase1-ownership-map.mjs",
    "#!/usr/bin/env node\n" +
      "const exit = Number.parseInt(process.env.PRE_PUSH_PHASE1_OWNERSHIP_MAP_EXIT || '0', 10);\n" +
      "console.log('[phase1-ownership-map] result=' + (exit ? 'fail' : 'ok') + ' active=0 legacy=0 diagnostics=0');\n" +
      "process.exit(exit);\n",
  );
  chmodSync(join(repoDir, "scripts", "check-phase1-ownership-map.mjs"), 0o755);
  ensureFile(
    repoDir,
    "scripts/check-phase1-burndown-finalization.mjs",
    "#!/usr/bin/env node\n" +
      "const exit = Number.parseInt(process.env.PRE_PUSH_PHASE1_BURNDOWN_FINALIZATION_EXIT || '0', 10);\n" +
      "console.log('[phase1-burndown-finalization] result=' + (exit ? 'fail' : 'ok') + ' phase1_targets=0 out_of_scope=0 diagnostics=0');\n" +
      "process.exit(exit);\n",
  );
  chmodSync(join(repoDir, "scripts", "check-phase1-burndown-finalization.mjs"), 0o755);

  ensureFile(
    repoDir,
    "scripts/check-command-thinness-enforcement.mjs",
    "#!/usr/bin/env node\n" +
      "const exit = Number.parseInt(process.env.PRE_COMMIT_COMMAND_THINNESS_EXIT || '0', 10);\n" +
      "console.log('[command-thinness-enforcement] result=' + (exit ? 'fail' : 'ok') + ' checked=0 violations=0');\n" +
      "process.exit(exit);\n",
  );
  chmodSync(join(repoDir, "scripts", "check-command-thinness-enforcement.mjs"), 0o755);

  ensureFile(
    repoDir,
    "scripts/check-runtime-internal-cli-enforcement.mjs",
    "#!/usr/bin/env node\n" +
      "const exit = Number.parseInt(process.env.PRE_COMMIT_RUNTIME_INTERNAL_CLI_EXIT || '0', 10);\n" +
      "console.log('[runtime-internal-cli] result=' + (exit ? 'fail' : 'ok') + ' checked=0 violations=0');\n" +
      "process.exit(exit);\n",
  );
  chmodSync(join(repoDir, "scripts", "check-runtime-internal-cli-enforcement.mjs"), 0o755);

  ensureFile(
    repoDir,
    "scripts/check-structured-io-enforcement.mjs",
    "#!/usr/bin/env node\n" +
      "const exit = Number.parseInt(process.env.PRE_COMMIT_STRUCTURED_IO_EXIT || '0', 10);\n" +
      "console.log('[structured-io-enforcement] result=' + (exit ? 'fail' : 'ok') + ' checked=0 violations=0');\n" +
      "process.exit(exit);\n",
  );
  chmodSync(join(repoDir, "scripts", "check-structured-io-enforcement.mjs"), 0o755);

  ensureFile(
    repoDir,
    "scripts/check-shared-ownership-enforcement.mjs",
    "#!/usr/bin/env node\n" +
      "const exit = Number.parseInt(process.env.PRE_COMMIT_SHARED_OWNERSHIP_EXIT || '0', 10);\n" +
      "console.log('[shared-ownership-enforcement] result=' + (exit ? 'fail' : 'ok') + ' checked=0 violations=0');\n" +
      "process.exit(exit);\n",
  );
  chmodSync(join(repoDir, "scripts", "check-shared-ownership-enforcement.mjs"), 0o755);

  for (const scriptName of listGateManifestCheckers()) {
    ensureGenericChecker(repoDir, scriptName);
  }

  initFixtureRepo(repoDir);

  ensureFile(repoDir, changedPath, "baseline\n");
  const remoteSha = baselineFixtureCommit(repoDir, "baseline");

  ensureFile(repoDir, changedPath, "baseline\nchanged\n");
  runFixtureGit(repoDir, ["add", changedPath]);
  runFixtureGit(repoDir, ["commit", "-m", "portability change"]);
  const localSha = runFixtureGit(repoDir, ["rev-parse", "HEAD"]);

  return { repoDir, remoteSha, localSha };
}

function parseNpmInvocations(logPath) {
  if (!existsSync(logPath)) {
    return [];
  }

  return readFileSync(logPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function parseLineLog(logPath) {
  if (!existsSync(logPath)) {
    return [];
  }

  return readFileSync(logPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean);
}

test("main-branch push diff touching factory portability path runs factory_portability invariant first", () => {
  const scenario = loadScenario("main-factory-portability");
  const { repoDir, remoteSha, localSha } = setupRepoForMainPushDiff(scenario.changedPath);
  const tempDir = mkdtempSync(join(tmpdir(), "pre-push-hook-logs-"));
  const npmLogPath = join(tempDir, "npm.log");

  const env = {
    ...process.env,
    PATH: `${npmStubBinDir}${delimiter}${process.env.PATH ?? ""}`,
    PRE_COMMIT_NPM_STUB_LOG: npmLogPath,
    PRE_COMMIT_TEST_PLATFORM_FACTORY_PORTABILITY_EXIT: "0",
    PRE_COMMIT_LOCKFILE_SYNC_EXIT: "0",
    PRE_COMMIT_BUILD_EXIT: "0",
    PRE_COMMIT_TEST_GUARD_GATES_EXIT: "0",
    PRE_COMMIT_TEST_WAVE_CLAIM_GATES_EXIT: "0",
  };

  const run = spawnSync(
    "bash",
    [".githooks/pre-push", "origin", "git@github.com:recallnet/astrochicken.git"],
    {
      cwd: repoDir,
      env,
      encoding: "utf8",
      input: `refs/heads/main ${localSha} refs/heads/main ${remoteSha}\n`,
    },
  );

  const hookLogPath = join(repoDir, ".hook-logs", "pre-push.log");
  const hookLog = existsSync(hookLogPath) ? readFileSync(hookLogPath, "utf8") : "";
  const output = `${hookLog}${run.stdout}${run.stderr}`;
  const npmInvocations = parseNpmInvocations(npmLogPath);

  assert.equal(run.status, 0, output);
  assert.deepEqual(npmInvocations.map((entry) => entry.script), scenario.expectedNpmCalls);
  assert.match(output, /\[pre-push\] gate_start gate=release_quality family=core_invariants/);
  assert.match(output, /\[pre-push\] gate_pass gate=release_quality family=core_invariants/);
  assert.match(output, /\[pre-push\] gate_pass gate=release_quality family=docs_skills_template_contracts/);
  assert.doesNotMatch(
    output,
    /invariant=factory_portability|invariant=cli_context_portability|invariant=external_factory_compat|invariant=supervisor_recovery/,
  );
});

test("pre-push fails closed with bootstrap error when factory-ops package links are incomplete", () => {
  const changedPath = "scripts/check-factory-portability-contract.mjs";
  const { repoDir, remoteSha, localSha } = setupRepoForMainPushDiff(changedPath);
  writeFileSync(join(repoDir, "package.json"), "{\"name\":\"fixture\",\"private\":true}\n");
  for (const relativePath of [
    "packages/factory-ops/node_modules/@hatch/github-adapter",
    "packages/factory-ops/node_modules/@recallnet/factory-telemetry",
    "packages/factory-ops/node_modules/clipanion",
    "packages/factory-ops/node_modules/hatch",
    "packages/factory-ops/node_modules/pg",
    "packages/github-adapter/node_modules/@hatch/factory-core",
    "packages/github-adapter/node_modules/zod",
  ]) {
    rmSync(join(repoDir, relativePath), { recursive: true, force: true });
  }
  mkdirSync(join(repoDir, "node_modules", "acorn"), { recursive: true });
  mkdirSync(join(repoDir, "node_modules", "ajv"), { recursive: true });
  writeFileSync(join(repoDir, "node_modules", "acorn", "package.json"), "{\"name\":\"acorn\"}\n");
  writeFileSync(join(repoDir, "node_modules", "ajv", "package.json"), "{\"name\":\"ajv\"}\n");
  mkdirSync(join(repoDir, "node_modules", "zod"), { recursive: true });
  writeFileSync(join(repoDir, "node_modules", "zod", "package.json"), "{\"name\":\"zod\"}\n");
  mkdirSync(join(repoDir, "node_modules", "@hatch", "factory-ops"), { recursive: true });
  writeFileSync(join(repoDir, "node_modules", "@hatch", "factory-ops", "package.json"), "{\"name\":\"@hatch/factory-ops\"}\n");
  mkdirSync(join(repoDir, "packages", "factory-ops", "node_modules", "@hatch", "factory-core"), { recursive: true });
  writeFileSync(
    join(repoDir, "packages", "factory-ops", "node_modules", "@hatch", "factory-core", "package.json"),
    "{\"name\":\"@hatch/factory-core\"}\n",
  );

  const run = spawnSync(
    "bash",
    [".githooks/pre-push", "origin", "git@github.com:recallnet/astrochicken.git"],
    {
      cwd: repoDir,
      env: process.env,
      encoding: "utf8",
      input: `refs/heads/main ${localSha} refs/heads/main ${remoteSha}\n`,
    },
  );

  const hookLog = readFileSync(join(repoDir, ".hook-logs", "pre-push.log"), "utf8");
  assert.equal(run.status, 1, `${run.stdout}\n${run.stderr}\n${hookLog}`);
  assert.match(run.stderr, /\[pre-push\] bootstrap_missing reason=workspace_dependencies_unavailable remedy="pnpm install --frozen-lockfile"/);
  assert.match(hookLog, /bootstrap_missing/);
});

test("pre-push repairs missing workspace links with postinstall bootstrap before failing", () => {
  const changedPath = "scripts/check-factory-portability-contract.mjs";
  const { repoDir, remoteSha, localSha } = setupRepoForMainPushDiff(changedPath);
  writeFileSync(join(repoDir, "package.json"), "{\"name\":\"fixture\",\"private\":true}\n");
  mkdirSync(join(repoDir, "node_modules", ".pnpm"), { recursive: true });
  writeFileSync(
    join(repoDir, "scripts", "postinstall-bootstrap.mjs"),
    "#!/usr/bin/env node\n" +
      "import { mkdirSync, writeFileSync } from 'node:fs';\n" +
      "const ensure = (path, body) => { mkdirSync(path.replace(/\\/package\\.json$/, ''), { recursive: true }); writeFileSync(path, body); };\n" +
      "ensure('node_modules/acorn/package.json', '{\"name\":\"acorn\"}\\n');\n" +
      "ensure('node_modules/ajv/package.json', '{\"name\":\"ajv\"}\\n');\n" +
      "ensure('node_modules/zod/package.json', '{\"name\":\"zod\"}\\n');\n" +
      "ensure('node_modules/@hatch/factory-ops/package.json', '{\"name\":\"@hatch/factory-ops\"}\\n');\n" +
      "ensure('packages/factory-ops/node_modules/@hatch/factory-core/package.json', '{\"name\":\"@hatch/factory-core\"}\\n');\n" +
      "ensure('packages/factory-ops/node_modules/@hatch/github-adapter/package.json', '{\"name\":\"@hatch/github-adapter\"}\\n');\n" +
      "ensure('packages/factory-ops/node_modules/@recallnet/factory-telemetry/package.json', '{\"name\":\"@recallnet/factory-telemetry\"}\\n');\n" +
      "ensure('packages/factory-ops/node_modules/clipanion/package.json', '{\"name\":\"clipanion\"}\\n');\n" +
      "ensure('packages/factory-ops/node_modules/hatch/package.json', '{\"name\":\"hatch\"}\\n');\n" +
      "ensure('packages/factory-ops/node_modules/pg/package.json', '{\"name\":\"pg\"}\\n');\n" +
      "ensure('packages/github-adapter/node_modules/@hatch/factory-core/package.json', '{\"name\":\"@hatch/factory-core\"}\\n');\n" +
      "ensure('packages/github-adapter/node_modules/zod/package.json', '{\"name\":\"zod\"}\\n');\n",
  );
  chmodSync(join(repoDir, "scripts", "postinstall-bootstrap.mjs"), 0o755);

  const run = spawnSync(
    "bash",
    [".githooks/pre-push", "origin", "git@github.com:recallnet/astrochicken.git"],
    {
      cwd: repoDir,
      env: {
        ...process.env,
        PATH: `${npmStubBinDir}${delimiter}${process.env.PATH ?? ""}`,
        PRE_COMMIT_BUILD_EXIT: "0",
        PRE_COMMIT_KNIP_EXIT: "0",
        PRE_COMMIT_TYPECHECK_EXIT: "0",
        PRE_COMMIT_TEST_PLATFORM_CLI_CONTEXT_PORTABILITY_EXIT: "0",
        PRE_COMMIT_TEST_PLATFORM_SUPERVISOR_RECOVERY_EXIT: "0",
        PRE_COMMIT_TEST_PLATFORM_SCAFFOLD_CONTRACT_EXIT: "0",
        PRE_COMMIT_TEST_PLATFORM_FACTORY_PORTABILITY_EXIT: "0",
        PRE_COMMIT_TEST_PLATFORM_EXTERNAL_FACTORY_PORTABILITY_MATRIX_EXIT: "0",
        PRE_COMMIT_TEST_PLATFORM_DOCS_SKILLS_TEMPLATES_EXIT: "0",
      },
      encoding: "utf8",
      input: `refs/heads/main ${localSha} refs/heads/main ${remoteSha}\n`,
    },
  );

  const hookLogPath = join(repoDir, ".hook-logs", "pre-push.log");
  const hookLog = existsSync(hookLogPath) ? readFileSync(hookLogPath, "utf8") : "";
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}\n${hookLog}`);
  assert.match(run.stdout, /\[pre-push\] ok \(log: \.hook-logs\/pre-push\.log\)/);
});

test("main-branch push diff touching apps/hatch source runs workspace export coverage baseline gate", () => {
  const changedPath = "apps/hatch/src/pipeline/graph.ts";
  const { repoDir, remoteSha, localSha } = setupRepoForMainPushDiff(changedPath);
  const tempDir = mkdtempSync(join(tmpdir(), "pre-push-hook-logs-"));
  const npmLogPath = join(tempDir, "npm.log");
  const workspaceCoverageLogPath = join(tempDir, "workspace-coverage.log");

  const env = {
    ...process.env,
    PATH: `${npmStubBinDir}${delimiter}${process.env.PATH ?? ""}`,
    PRE_COMMIT_NPM_STUB_LOG: npmLogPath,
    PRE_PUSH_WORKSPACE_EXPORT_COVERAGE_EXIT: "0",
    PRE_PUSH_WORKSPACE_EXPORT_COVERAGE_STUB_LOG: workspaceCoverageLogPath,
    PRE_COMMIT_LOCKFILE_SYNC_EXIT: "0",
    PRE_COMMIT_BUILD_EXIT: "0",
    PRE_COMMIT_TEST_GUARD_GATES_EXIT: "0",
    PRE_COMMIT_TEST_WAVE_CLAIM_GATES_EXIT: "0",
  };

  const run = spawnSync(
    "bash",
    [".githooks/pre-push", "origin", "git@github.com:recallnet/astrochicken.git"],
    {
      cwd: repoDir,
      env,
      encoding: "utf8",
      input: `refs/heads/main ${localSha} refs/heads/main ${remoteSha}\n`,
    },
  );

  const hookLogPath = join(repoDir, ".hook-logs", "pre-push.log");
  const hookLog = existsSync(hookLogPath) ? readFileSync(hookLogPath, "utf8") : "";
  const output = `${hookLog}${run.stdout}${run.stderr}`;
  const workspaceCoverageCalls = parseLineLog(workspaceCoverageLogPath);

  assert.equal(run.status, 0, output);
  assert.deepEqual(workspaceCoverageCalls, ["check-workspace-export-coverage"]);
  assert.match(output, /\[workspace-export-coverage\] result=ok/);
});

test("main-branch push diff touching coverage policy path runs coverage policy ratchet", () => {
  const changedPath = "apps/hatch/vitest.config.mjs";
  const { repoDir, remoteSha, localSha } = setupRepoForMainPushDiff(changedPath);
  const tempDir = mkdtempSync(join(tmpdir(), "pre-push-hook-logs-"));
  const npmLogPath = join(tempDir, "npm.log");
  const coveragePolicyLogPath = join(tempDir, "coverage-policy.log");
  const startupProbeLogPath = join(tempDir, "runtime-startup-probe.log");

  const env = {
    ...process.env,
    PATH: `${npmStubBinDir}${delimiter}${process.env.PATH ?? ""}`,
    PRE_COMMIT_NPM_STUB_LOG: npmLogPath,
    PRE_PUSH_COVERAGE_POLICY_EXIT: "0",
    PRE_PUSH_COVERAGE_POLICY_STUB_LOG: coveragePolicyLogPath,
    PRE_PUSH_RUNTIME_STARTUP_PROBE_EXIT: "0",
    PRE_PUSH_RUNTIME_STARTUP_PROBE_STUB_LOG: startupProbeLogPath,
    PRE_COMMIT_LOCKFILE_SYNC_EXIT: "0",
    PRE_COMMIT_BUILD_EXIT: "0",
    PRE_COMMIT_TEST_GUARD_GATES_EXIT: "0",
    PRE_COMMIT_TEST_WAVE_CLAIM_GATES_EXIT: "0",
  };

  const run = spawnSync(
    "bash",
    [".githooks/pre-push", "origin", "git@github.com:recallnet/astrochicken.git"],
    {
      cwd: repoDir,
      env,
      encoding: "utf8",
      input: `refs/heads/main ${localSha} refs/heads/main ${remoteSha}\n`,
    },
  );

  const hookLogPath = join(repoDir, ".hook-logs", "pre-push.log");
  const hookLog = existsSync(hookLogPath) ? readFileSync(hookLogPath, "utf8") : "";
  const output = `${hookLog}${run.stdout}${run.stderr}`;
  const coveragePolicyCalls = parseLineLog(coveragePolicyLogPath);
  const startupProbeCalls = parseLineLog(startupProbeLogPath);

  assert.equal(run.status, 0, output);
  assert.deepEqual(coveragePolicyCalls, ["check-coverage-policy-ratchet"]);
  assert.deepEqual(startupProbeCalls, ["check-runtime-startup-probe"]);
  assert.match(output, /\[coverage-policy\] result=ok/);
  assert.match(output, /\[runtime-startup-probe\] result=ok/);
});

test("runtime startup probe failure rejects push after build", () => {
  const changedPath = "apps/hatch/src/pipeline/graph.ts";
  const { repoDir, remoteSha, localSha } = setupRepoForMainPushDiff(changedPath);
  const tempDir = mkdtempSync(join(tmpdir(), "pre-push-hook-logs-"));
  const npmLogPath = join(tempDir, "npm.log");
  const startupProbeLogPath = join(tempDir, "runtime-startup-probe.log");

  const env = {
    ...process.env,
    PATH: `${npmStubBinDir}${delimiter}${process.env.PATH ?? ""}`,
    PRE_COMMIT_NPM_STUB_LOG: npmLogPath,
    PRE_PUSH_RUNTIME_STARTUP_PROBE_EXIT: "1",
    PRE_PUSH_RUNTIME_STARTUP_PROBE_STUB_LOG: startupProbeLogPath,
    PRE_COMMIT_LOCKFILE_SYNC_EXIT: "0",
    PRE_COMMIT_BUILD_EXIT: "0",
    PRE_COMMIT_TEST_GUARD_GATES_EXIT: "0",
    PRE_COMMIT_TEST_WAVE_CLAIM_GATES_EXIT: "0",
  };

  const run = spawnSync(
    "bash",
    [".githooks/pre-push", "origin", "git@github.com:recallnet/astrochicken.git"],
    {
      cwd: repoDir,
      env,
      encoding: "utf8",
      input: `refs/heads/main ${localSha} refs/heads/main ${remoteSha}\n`,
    },
  );

  const hookLogPath = join(repoDir, ".hook-logs", "pre-push.log");
  const hookLog = existsSync(hookLogPath) ? readFileSync(hookLogPath, "utf8") : "";
  const output = `${hookLog}${run.stdout}${run.stderr}`;
  const npmInvocations = parseNpmInvocations(npmLogPath);
  const startupProbeCalls = parseLineLog(startupProbeLogPath);

  assert.equal(run.status, 1, output);
  assert.deepEqual(npmInvocations.map((entry) => entry.script).slice(0, 1), ["build"]);
  assert.deepEqual(startupProbeCalls, ["check-runtime-startup-probe"]);
  assert.match(output, /\[pre-push\] gate_failed gate=runtime_startup_probe command="node scripts\/check-runtime-startup-probe\.mjs" exit=1/);
  assert.match(output, /\[pre-push\] first_failure phase=quality_gate target=runtime_startup_probe command="node scripts\/check-runtime-startup-probe\.mjs" exit=1/);
});
