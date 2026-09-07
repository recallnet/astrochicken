/**
 * Pre-commit routing configuration constants.
 *
 * Extracted from pre-commit-staged-file-classifier.mjs to stay under line budget.
 * Contains: path buckets, route patterns, suite mappings, bucket selection matrix,
 * quality gate execution matrix, quality gates, test suites, and trigger path sets.
 */
import {
  DOCS_POLICY_RELATIVE_PATH,
  DOCS_POLICY_SCHEMA_RELATIVE_PATH,
} from "./docs-policy-validator.ts";
import { GATE_MANIFEST } from "./gate-manifest.ts";
import {
  TEST_SUITE_BUCKET_SELECTION_MATRIX,
  TEST_SUITE_BUCKET_TO_SUITES,
  TEST_SUITE_ROUTE_PATTERNS,
} from "./suite-routing-config.ts";

export {
  TEST_SUITE_BUCKET_SELECTION_MATRIX,
  TEST_SUITE_BUCKET_TO_SUITES,
  TEST_SUITE_ROUTE_PATTERNS,
};

export const PATH_BUCKETS = [
  ["hasDocsPaths", "docs/"],
  ["hasAppsPaths", "apps/"],
  ["hasPackagesPaths", "packages/"],
  ["hasFactoriesPaths", "factories/"],
  ["hasScriptsPaths", "scripts/"],
];

const manifestQualityGates = GATE_MANIFEST.filter((gate) => (
  gate.phase === "quality"
  && gate.qualityCategory === "mandatory"
  && gate.profiles.includes("fast")
));

const manifestTestSuites = GATE_MANIFEST.filter((gate) => gate.phase === "test_suite");

const makeQualityGate = (gate) => Object.freeze({
  name: gate.id,
  command: gate.command,
  args: gate.args,
  commandContext: gate.commandContext,
});

const makeTestSuite = (gate) => Object.freeze({
  name: gate.suiteName || gate.id,
  command: gate.command,
  args: gate.args,
  commandContext: gate.commandContext,
});

export const QUALITY_GATES = Object.freeze(manifestQualityGates.map(makeQualityGate));

export const PRE_COMMIT_TEST_SUITES = Object.freeze(manifestTestSuites.map(makeTestSuite));

export const TEST_SUITE_BY_NAME = new Map(PRE_COMMIT_TEST_SUITES.map((suite) => [suite.name, suite]));

/**
 * Mandatory non-test gates must run for all staged commits, including docs-only and dot-only.
 */
export const QUALITY_GATE_EXECUTION_MATRIX = Object.freeze({
  empty: Object.freeze({
    runQualityGates: false,
    reason: "no_staged_paths",
  }),
  docs_only: Object.freeze({
    runQualityGates: true,
    reason: "mandatory_for_staged_changes",
  }),
  mixed_or_code: Object.freeze({
    runQualityGates: true,
    reason: "mandatory_for_staged_changes",
  }),
  fallback_other: Object.freeze({
    runQualityGates: true,
    reason: "mandatory_for_staged_changes",
  }),
});

export const DOCS_CHECK_DEPENDENCY_PATHS = new Set([
  DOCS_POLICY_RELATIVE_PATH,
  DOCS_POLICY_SCHEMA_RELATIVE_PATH,
  "scripts/docs-check-state-machines.mjs",
  "scripts/docs-index-generate.mjs",
  "scripts/docs-check-benchmark-queries.mjs",
  "scripts/docs-policy-check.mjs",
  "scripts/lib/docs-policy-validator.ts",
  "scripts/lib/docs-template-framework.ts",
  "scripts/lib/live-doc-assets-manifest.ts",
  "docs/contracts/langfuse-benchmark-queries.json",
]);

export const STATE_MACHINE_TRIGGER_PATHS = new Set([
  "docs/state-machines.md",
  "docs/state-machines.sources.json",
  "scripts/docs-check-state-machines.mjs",
]);

export const COVERAGE_POLICY_TRIGGER_PATHS = new Set([
  "apps/hatch/vitest.config.mjs",
  "packages/factory-ops/package.json",
  "config/testing/package-test-manifests/packages-factory-ops.json",
  "scripts/check-coverage-policy-ratchet.ts",
  "scripts/check-coverage-policy-ratchet.unit.test.ts",
  "scripts/coverage-policy-ratchet-baseline.json",
]);

export const BENCHMARK_JOB_ID_REGISTRY_TRIGGER_PATHS = new Set([
  "docs/contracts/benchmark-job-id-registry.json",
  "scripts/check-benchmark-job-id-registry.ts",
]);

export const SCENARIO_COUNT_GATE_TRIGGER_PATHS = new Set([
  "scripts/check-scenario-count-gate.ts",
  "packages/factory-ops/src/commands/scenario-count-gate.ts",
]);

export const SCENARIO_COUNT_GATE_TRIGGER_PREFIXES = Object.freeze([
  "factories/mothership/scenarios/",
]);

export const CONTEXT_PROPAGATION_CONTRACT_TRIGGER_PATHS = new Set([
  "scripts/check-context-propagation-contract.ts",
  "scripts/handler-context-contract.json",
  "apps/hatch/src/pipeline/handler/register.ts",
]);

export const CONTEXT_PROPAGATION_CONTRACT_TRIGGER_PREFIXES = Object.freeze([
  "apps/hatch/src/pipeline/handler/",
]);
