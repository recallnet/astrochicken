import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  isArchivedDocPath,
  isLiveDocAssetPath,
} from "./lib/live-doc-assets-manifest.ts";
import {
  STAGED_DIFF_ARGS,
  QUALITY_GATES,
  classifyStagedPaths,
  expandWildcardArg,
  isContextPropagationContractTriggerPath,
  isDocsCheckTriggerPath,
  isDocsPath,
  isPlatformInvariantTriggerPath,
  matchesRoutePattern,
  parseNulDelimitedPaths,
  resolveCommandInvocation,
  resolvePathRouteMatches,
  resolveQualityGatePolicy,
  resolveSelectiveSuiteBucket,
  resolveTestSuitePolicy,
} from "./pre-commit-staged-file-classifier.mjs";
import { baselineFixtureCommit, initFixtureRepo, runFixtureGit } from "./test/helpers/git-fixture.mjs";

const testDir = dirname(fileURLToPath(import.meta.url));
const classifierPath = join(testDir, "pre-commit-staged-file-classifier.mjs");
const FACTORY_OPS_WORKSPACE = "packages/factory-ops";
const FACTORY_OPS_TEST_DIR = `${FACTORY_OPS_WORKSPACE}/test`;
const FACTORY_PORTABILITY_ENTRYPOINT = `${FACTORY_OPS_WORKSPACE}/src/cli/commands/factory.ts`;
const WAVE_CLAIM_ENTRYPOINT = `${FACTORY_OPS_WORKSPACE}/src/cli/commands/wave.ts`;
const FACTORY_OPS_NON_WAVE_ENTRYPOINT = `${FACTORY_OPS_WORKSPACE}/src/cli.ts`;
const FACTORY_PORTABILITY_PATHS = Object.freeze([
  `${FACTORY_OPS_WORKSPACE}/src/lib/factory-context-resolver.ts`,
  `${FACTORY_OPS_WORKSPACE}/src/lib/runs-dir-resolver.ts`,
  `${FACTORY_OPS_WORKSPACE}/src/commands/factory-status.ts`,
  `${FACTORY_OPS_WORKSPACE}/src/commands/factory-tick-status.ts`,
  `${FACTORY_OPS_WORKSPACE}/src/commands/common-resolve-default.ts`,
  FACTORY_PORTABILITY_ENTRYPOINT,
  `${FACTORY_OPS_WORKSPACE}/src/cli/commands/common.ts`,
  `${FACTORY_OPS_TEST_DIR}/factory-context-resolution-cli.contract.test.mjs`,
  `${FACTORY_OPS_TEST_DIR}/factory-status.contract.test.mjs`,
  `${FACTORY_OPS_TEST_DIR}/factory-tick-status.contract.test.mjs`,
  `${FACTORY_OPS_TEST_DIR}/runs-dir-resolution.test.mjs`,
]);
const MOTHERSHIP_GRAPHS_ROOT = "factories/mothership/graphs";
const GOAL_QUEUE_DOT = `${MOTHERSHIP_GRAPHS_ROOT}/goal_queue.dot`;
const WAVE_EXECUTE_META_JSON = `${MOTHERSHIP_GRAPHS_ROOT}/wave_execute.meta.json`;


function runClassifierInRepo(cwd) {
  const run = spawnSync("node", [classifierPath], { cwd, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

test("parseNulDelimitedPaths preserves whitespace and embedded newlines", () => {
  const input = Buffer.from("docs/with space.md\0apps/line\nbreak.ts\0", "utf8");
  const paths = parseNulDelimitedPaths(input);
  assert.deepEqual(paths, ["docs/with space.md", "apps/line\nbreak.ts"]);
});

test("default staged diff args include rename and delete coverage", () => {
  assert.deepEqual(STAGED_DIFF_ARGS, [
    "diff",
    "--cached",
    "--name-only",
    "--diff-filter=ACMRD",
    "-M",
    "-z",
  ]);
});

test("docs path predicate is explicit and boundary-locked", () => {
  assert.equal(isDocsPath("docs/guide.md"), true);
  assert.equal(isDocsPath("docs/state-machines.md"), true);
  assert.equal(isDocsPath("docs/state-machines.sources.json"), true);
  assert.equal(isDocsPath("README.md"), true);
  assert.equal(isDocsPath("AGENTS.md"), true);
  assert.equal(isDocsPath("CLAUDE.md"), true);
  assert.equal(isDocsPath("CODEX.md"), true);

  assert.equal(isDocsPath("apps/hatch/src/cli.ts"), false);
  assert.equal(isDocsPath(GOAL_QUEUE_DOT), false);
});

test("docs-check trigger predicate covers policy scope and checker dependencies", () => {
  assert.equal(isDocsCheckTriggerPath("docs/guide.md"), true);
  assert.equal(isDocsCheckTriggerPath("README.md"), true);
  assert.equal(isDocsCheckTriggerPath("docs/docs-policy.json"), true);
  assert.equal(isDocsCheckTriggerPath("docs/docs-policy.schema.json"), true);
  assert.equal(isDocsCheckTriggerPath("scripts/docs-policy-check.mjs"), true);
  assert.equal(isDocsCheckTriggerPath("scripts/docs-index-generate.mjs"), true);
  assert.equal(isDocsCheckTriggerPath("scripts/docs-check-benchmark-queries.mjs"), true);
  assert.equal(isDocsCheckTriggerPath("docs/contracts/langfuse-benchmark-queries.json"), true);
  assert.equal(isDocsCheckTriggerPath("scripts/lib/docs-policy-validator.ts"), true);
  assert.equal(isDocsCheckTriggerPath("scripts/lib/docs-template-framework.ts"), true);
  assert.equal(isDocsCheckTriggerPath("scripts/lib/live-doc-assets-manifest.ts"), true);
  assert.equal(isDocsCheckTriggerPath("apps/hatch/src/cli.ts"), false);
});

test("live-doc and archived-doc predicates are explicit and deterministic", () => {
  assert.equal(isLiveDocAssetPath("docs/agent-runbooks/daily-analysis.md"), true);
  assert.equal(isLiveDocAssetPath("docs/guide.md"), false);
  assert.equal(isLiveDocAssetPath("docs/skills/factory-design-workspace/README.md"), false);

  assert.equal(isArchivedDocPath("docs/archive/notes.md"), true);
  assert.equal(isArchivedDocPath("docs/skills/factory-design-workspace/README.md"), true);
  assert.equal(isArchivedDocPath("docs/skills/factory-design/SKILL.md"), false);
});

test("platform invariant trigger predicate matches shared platform surfaces", () => {
  assert.equal(isPlatformInvariantTriggerPath("scripts/pre-commit-staged-file-classifier.mjs"), true);
  assert.equal(isPlatformInvariantTriggerPath(".githooks/pre-commit"), true);
  assert.equal(isPlatformInvariantTriggerPath("factories/_templates/factory/factory.config.json.template"), true);
  assert.equal(isPlatformInvariantTriggerPath("factories/_shared/surfaces/graphs/release_report_flow.dot.template"), true);
  assert.equal(isPlatformInvariantTriggerPath("factories/mothership/workflows/wave-execution/wave_execute.workflow-source.mjs"), true);
  assert.equal(isPlatformInvariantTriggerPath("docs/skills/factory-design/SKILL.md"), true);
  assert.equal(isPlatformInvariantTriggerPath("apps/hatch/src/factory/init.ts"), true);
  assert.equal(isPlatformInvariantTriggerPath("apps/hatch/src/cli-run-config.test.ts"), true);
  assert.equal(isPlatformInvariantTriggerPath("apps/hatch/src/runs-context-portability.integration.test.ts"), true);
  assert.equal(isPlatformInvariantTriggerPath("packages/factory-ops/test/supervisor/factory-context-resolution-cli.cli.test.ts"), true);
  assert.equal(isPlatformInvariantTriggerPath("packages/factory-ops/test/supervisor/factory-cli-context-portability-spawn.integration.test.ts"), true);
  assert.equal(isPlatformInvariantTriggerPath("apps/hatch/src/pipeline/scenarios.ts"), true);
  assert.equal(isPlatformInvariantTriggerPath("scripts/test/fixtures/factory-portability/external/factory.config.json"), true);
  assert.equal(isPlatformInvariantTriggerPath("factory-registry.json"), true);
  assert.equal(isPlatformInvariantTriggerPath("factories/brainstorm/kind.json"), true);
  assert.equal(isPlatformInvariantTriggerPath("scripts/check-factory-registry-consistency.mjs"), true);
  assert.equal(isPlatformInvariantTriggerPath("factories/brainstorm/factory.config.json"), true);
  assert.equal(isPlatformInvariantTriggerPath("packages/factory-runtime/workflows/managed-supervisor-shell/managed-supervisor-shell.workflow-source.mjs"), true);
  assert.equal(isPlatformInvariantTriggerPath("packages/factory-ops/src/lib/external-factory-control-state.ts"), true);
  assert.equal(isPlatformInvariantTriggerPath("scripts/check-managed-supervisor-shell-contract.mjs"), true);
  assert.equal(isPlatformInvariantTriggerPath("docs/contracts/factory-label-contract.json"), true);
  assert.equal(isPlatformInvariantTriggerPath("packages/factory-ops/src/commands/supervisor-artifact.ts"), true);
  assert.equal(isPlatformInvariantTriggerPath("packages/factory-ops/src/lib/command-owners/supervisor-artifact.ts"), true);
  assert.equal(isPlatformInvariantTriggerPath("packages/factory-ops/src/lib/incident-packet.ts"), true);
  assert.equal(isPlatformInvariantTriggerPath(FACTORY_PORTABILITY_ENTRYPOINT), true);
  assert.equal(isPlatformInvariantTriggerPath("apps/hatch/src/cli.ts"), false);
});

test("classifyStagedPaths marks docs-only branch deterministically", () => {
  const contract = classifyStagedPaths([
    "README.md",
    "docs/state-machines.md",
  ]);

  assert.equal(contract.branch, "docs_only");
  assert.equal(contract.isDocsOnly, true);
  assert.equal(contract.isDotOnly, false);
  assert.equal(contract.isDocsOrDotOnly, true);
  assert.equal(contract.hasDocsPaths, true);
  assert.equal(contract.hasDocsCheckTrigger, true);
  assert.deepEqual(contract.stagedDocsCheckCandidates, ["README.md", "docs/state-machines.md"]);
  assert.equal(contract.hasStateMachineDocsTrigger, true);
  assert.deepEqual(contract.stagedStateMachineDocCandidates, ["docs/state-machines.md"]);
  assert.equal(contract.hasLiveDocAssetPaths, false);
  assert.deepEqual(contract.stagedLiveDocAssetCandidates, []);
  assert.equal(contract.hasArchivedDocPaths, false);
  assert.deepEqual(contract.stagedArchivedDocCandidates, []);
});

test("classifyStagedPaths marks generic docs changes as docs-check trigger candidates", () => {
  const contract = classifyStagedPaths(["docs/guide.md"]);

  assert.equal(contract.hasDocsCheckTrigger, true);
  assert.deepEqual(contract.stagedDocsCheckCandidates, ["docs/guide.md"]);
  assert.equal(contract.hasStateMachineDocsTrigger, false);
  assert.deepEqual(contract.stagedStateMachineDocCandidates, []);
  assert.equal(contract.hasPlatformInvariantTrigger, false);
});

test("classifyStagedPaths captures live and archived doc metadata without changing docs-only routing", () => {
  const contract = classifyStagedPaths([
    "docs/agent-runbooks/daily-analysis.md",
    "docs/archive/notes.md",
  ]);

  assert.equal(contract.branch, "docs_only");
  assert.equal(contract.isDocsOnly, true);
  assert.equal(contract.hasLiveDocAssetPaths, true);
  assert.deepEqual(contract.stagedLiveDocAssetCandidates, ["docs/agent-runbooks/daily-analysis.md"]);
  assert.equal(contract.hasArchivedDocPaths, true);
  assert.deepEqual(contract.stagedArchivedDocCandidates, ["docs/archive/notes.md"]);
});

test("classifyStagedPaths marks scripts and graph edits as platform invariant triggers", () => {
  const scriptsContract = classifyStagedPaths(["scripts/pre-commit-staged-file-classifier.mjs"]);
  assert.equal(scriptsContract.hasPlatformInvariantTrigger, true);
  assert.deepEqual(scriptsContract.stagedPlatformInvariantCandidates, ["scripts/pre-commit-staged-file-classifier.mjs"]);

  const graphContract = classifyStagedPaths([GOAL_QUEUE_DOT]);
  assert.equal(graphContract.hasPlatformInvariantTrigger, true);
  assert.deepEqual(graphContract.stagedPlatformInvariantCandidates, [GOAL_QUEUE_DOT]);

  const portabilityContract = classifyStagedPaths([FACTORY_PORTABILITY_ENTRYPOINT]);
  assert.equal(portabilityContract.hasPlatformInvariantTrigger, true);
  assert.deepEqual(portabilityContract.stagedPlatformInvariantCandidates, [FACTORY_PORTABILITY_ENTRYPOINT]);

  const invariantPipelineContract = classifyStagedPaths(["apps/hatch/src/pipeline/scenarios.ts"]);
  assert.equal(invariantPipelineContract.hasPlatformInvariantTrigger, true);
  assert.deepEqual(invariantPipelineContract.stagedPlatformInvariantCandidates, ["apps/hatch/src/pipeline/scenarios.ts"]);
});

test("classifyStagedPaths marks release-quality trigger candidates deterministically", () => {
  const releaseTriggerContract = classifyStagedPaths(["factories/_templates/factory/factory.config.json.template"]);
  assert.equal(releaseTriggerContract.hasReleaseQualityTriggerPaths, true);
  assert.deepEqual(releaseTriggerContract.stagedReleaseQualityTriggerCandidates, ["factories/_templates/factory/factory.config.json.template"]);

  const nonTriggerContract = classifyStagedPaths(["context/notes.txt"]);
  assert.equal(nonTriggerContract.hasReleaseQualityTriggerPaths, false);
  assert.deepEqual(nonTriggerContract.stagedReleaseQualityTriggerCandidates, []);
});

test("context propagation trigger predicate covers dot and handler/checker/registry surfaces", () => {
  assert.equal(isContextPropagationContractTriggerPath("factories/mothership/workflows/wave-execution/wave_execute.workflow-source.mjs"), true);
  assert.equal(isContextPropagationContractTriggerPath("apps/hatch/src/pipeline/handler/register.ts"), true);
  assert.equal(isContextPropagationContractTriggerPath("apps/hatch/src/pipeline/handler/worktree.ts"), true);
  assert.equal(isContextPropagationContractTriggerPath("scripts/check-context-propagation-contract.mjs"), true);
  assert.equal(isContextPropagationContractTriggerPath("scripts/handler-context-contract.json"), true);
  assert.equal(isContextPropagationContractTriggerPath("apps/hatch/src/cli.ts"), false);
});

test("classifyStagedPaths marks scenario count gate trigger candidates", () => {
  const checkerContract = classifyStagedPaths(["scripts/check-scenario-count-gate.mjs"]);
  assert.equal(checkerContract.hasScenarioCountGatePaths, true);

  const commandContract = classifyStagedPaths(["packages/factory-ops/src/commands/scenario-count-gate.ts"]);
  assert.equal(commandContract.hasScenarioCountGatePaths, true);

  const registryContract = classifyStagedPaths(["factories/mothership/scenarios/astrochicken/post-merge/core/SCENARIO.md"]);
  assert.equal(registryContract.hasScenarioCountGatePaths, true);

  const docsContract = classifyStagedPaths(["docs/guide.md"]);
  assert.equal(docsContract.hasScenarioCountGatePaths, false);
});

test("classifyStagedPaths marks context propagation contract candidates for dot and non-dot trigger surfaces", () => {
  const dotContract = classifyStagedPaths(["factories/mothership/workflows/wave-execution/wave_execute.workflow-source.mjs"]);
  assert.equal(dotContract.hasContextPropagationContractPaths, true);
  assert.deepEqual(dotContract.stagedContextPropagationContractCandidates, ["factories/mothership/workflows/wave-execution/wave_execute.workflow-source.mjs"]);

  const handlerContract = classifyStagedPaths(["apps/hatch/src/pipeline/handler/worktree.ts"]);
  assert.equal(handlerContract.hasContextPropagationContractPaths, true);
  assert.deepEqual(handlerContract.stagedContextPropagationContractCandidates, ["apps/hatch/src/pipeline/handler/worktree.ts"]);

  const checkerContract = classifyStagedPaths(["scripts/check-context-propagation-contract.mjs"]);
  assert.equal(checkerContract.hasContextPropagationContractPaths, true);
  assert.deepEqual(checkerContract.stagedContextPropagationContractCandidates, ["scripts/check-context-propagation-contract.mjs"]);

  const nonTriggerContract = classifyStagedPaths(["apps/hatch/src/cli.ts"]);
  assert.equal(nonTriggerContract.hasContextPropagationContractPaths, false);
  assert.deepEqual(nonTriggerContract.stagedContextPropagationContractCandidates, []);
});

test("classifyStagedPaths marks pipeline segment coverage trigger candidates for dot and packages paths", () => {
  const dotContract = classifyStagedPaths(["factories/mothership/workflows/wave-execution/wave_execute.workflow-source.mjs"]);
  assert.equal(dotContract.hasPipelineSegmentCoveragePaths, true);
  assert.deepEqual(dotContract.stagedPipelineSegmentCoverageCandidates, ["factories/mothership/workflows/wave-execution/wave_execute.workflow-source.mjs"]);

  const packageTestContract = classifyStagedPaths(["packages/factory-ops/test/wave-claim-gates.integration.test.mjs"]);
  assert.equal(packageTestContract.hasPipelineSegmentCoveragePaths, true);
  assert.deepEqual(packageTestContract.stagedPipelineSegmentCoverageCandidates, ["packages/factory-ops/test/wave-claim-gates.integration.test.mjs"]);

  const nonTriggerContract = classifyStagedPaths(["docs/guide.md"]);
  assert.equal(nonTriggerContract.hasPipelineSegmentCoveragePaths, false);
  assert.deepEqual(nonTriggerContract.stagedPipelineSegmentCoverageCandidates, []);
});

test("classifyStagedPaths marks degenerate-state guard trigger candidates for dot and ops paths", () => {
  const dotContract = classifyStagedPaths(["factories/mothership/workflows/wave-execution/wave_execute.workflow-source.mjs"]);
  assert.equal(dotContract.hasDegenerateStateGuardPaths, true);
  assert.deepEqual(dotContract.stagedDegenerateStateGuardCandidates, ["factories/mothership/workflows/wave-execution/wave_execute.workflow-source.mjs"]);

  const opsContract = classifyStagedPaths(["packages/factory-ops/src/commands/wave-split-results.ts"]);
  assert.equal(opsContract.hasDegenerateStateGuardPaths, true);
  assert.deepEqual(opsContract.stagedDegenerateStateGuardCandidates, ["packages/factory-ops/src/commands/wave-split-results.ts"]);

  const nonTriggerContract = classifyStagedPaths(["apps/hatch/src/cli.ts"]);
  assert.equal(nonTriggerContract.hasDegenerateStateGuardPaths, false);
  assert.deepEqual(nonTriggerContract.stagedDegenerateStateGuardCandidates, []);
});

test("classifyStagedPaths marks hatch and factory-telemetry sources for workspace export coverage", () => {
  const hatchContract = classifyStagedPaths(["apps/hatch/src/pipeline/graph.ts"]);
  assert.equal(hatchContract.hasWorkspaceExportCoveragePaths, true);

  const telemetryContract = classifyStagedPaths(["packages/factory-telemetry/src/events.ts"]);
  assert.equal(telemetryContract.hasWorkspaceExportCoveragePaths, true);

  const docsContract = classifyStagedPaths(["docs/guide.md"]);
  assert.equal(docsContract.hasWorkspaceExportCoveragePaths, false);
});

test("classifyStagedPaths marks coverage policy surfaces deterministically", () => {
  const vitestContract = classifyStagedPaths(["apps/hatch/vitest.config.mjs"]);
  assert.equal(vitestContract.hasCoveragePolicyPaths, true);

  const factoryOpsContract = classifyStagedPaths(["packages/factory-ops/package.json"]);
  assert.equal(factoryOpsContract.hasCoveragePolicyPaths, true);

  const docsContract = classifyStagedPaths(["docs/guide.md"]);
  assert.equal(docsContract.hasCoveragePolicyPaths, false);
});

test("classifyStagedPaths marks benchmark job_id registry trigger surfaces", () => {
  const graphContract = classifyStagedPaths(["factories/mothership/workflows/wave-execution/wave_execute.workflow-source.mjs"]);
  assert.equal(graphContract.hasBenchmarkJobIdRegistryPaths, true);

  const registryContract = classifyStagedPaths(["docs/contracts/benchmark-job-id-registry.json"]);
  assert.equal(registryContract.hasBenchmarkJobIdRegistryPaths, true);

  const checkerContract = classifyStagedPaths(["scripts/check-benchmark-job-id-registry.mjs"]);
  assert.equal(checkerContract.hasBenchmarkJobIdRegistryPaths, true);

  const docsContract = classifyStagedPaths(["docs/guide.md"]);
  assert.equal(docsContract.hasBenchmarkJobIdRegistryPaths, false);

  const scriptedContract = classifyStagedPaths(["scripts/check-benchmark-job-id-registry.mjs"]);
  assert.equal(scriptedContract.hasBenchmarkJobIdRegistryPaths, true);
});

test("docs template paths stay docs-only while still flagging platform invariant trigger", () => {
  const contract = classifyStagedPaths(["docs/templates/architecture.md.tmpl"]);
  assert.equal(contract.isDocsOnly, true);
  assert.equal(contract.hasDocsCheckTrigger, true);
  assert.equal(contract.hasPlatformInvariantTrigger, true);
});

test("classifyStagedPaths marks dot-only branch data deterministically", () => {
  const contract = classifyStagedPaths([
    GOAL_QUEUE_DOT,
    "apps/hatch/examples/simple.dot",
  ]);

  assert.equal(contract.isDocsOnly, false);
  assert.equal(contract.isDotOnly, true);
  assert.equal(contract.isDocsOrDotOnly, true);
  assert.equal(contract.hasDotFiles, true);
  assert.deepEqual(contract.stagedDotFiles, [
    GOAL_QUEUE_DOT,
    "apps/hatch/examples/simple.dot",
  ]);
});

test("classifyStagedPaths marks mixed docs+dot as docs_or_dot_only fast-path", () => {
  const contract = classifyStagedPaths([
    "docs/guide.md",
    GOAL_QUEUE_DOT,
  ]);

  assert.equal(contract.isDocsOnly, false);
  assert.equal(contract.isDotOnly, false);
  assert.equal(contract.isDocsOrDotOnly, true);
});

test("classifyStagedPaths keeps mixed docs+code out of docs_or_dot_only", () => {
  const contract = classifyStagedPaths([
    "docs/guide.md",
    "apps/hatch/src/main.ts",
  ]);

  assert.equal(contract.branch, "mixed_or_code");
  assert.equal(contract.isDocsOnly, false);
  assert.equal(contract.isDotOnly, false);
  assert.equal(contract.isDocsOrDotOnly, false);
});

test("classifyStagedPaths routes non-matching paths to fallback_other", () => {
  const contract = classifyStagedPaths(["context/notes.txt"]);

  assert.equal(contract.branch, "fallback_other");
  assert.equal(contract.hasOtherPaths, true);
  assert.equal(contract.hasDocsPaths, false);
  assert.equal(contract.isDocsOnly, false);
});

test("quality gate policy matrix keeps non-test gates mandatory for docs-only", () => {
  const emptyPolicy = resolveQualityGatePolicy(classifyStagedPaths([]));
  assert.deepEqual(emptyPolicy, {
    branch: "empty",
    runQualityGates: false,
    reason: "no_staged_paths",
  });

  const docsPolicy = resolveQualityGatePolicy(classifyStagedPaths(["docs/guide.md"]));
  assert.deepEqual(docsPolicy, {
    branch: "docs_only",
    runQualityGates: true,
    reason: "mandatory_for_staged_changes",
  });

  const mixedPolicy = resolveQualityGatePolicy(classifyStagedPaths(["apps/hatch/src/cli.ts"]));
  assert.deepEqual(mixedPolicy, {
    branch: "mixed_or_code",
    runQualityGates: true,
    reason: "mandatory_for_staged_changes",
  });
});

test("QUALITY_GATES only includes mandatory quality gates that run in fast profile", () => {
  const gateNames = QUALITY_GATES.map((gate) => gate.name);

  assert.equal(gateNames.includes("build"), true);
  assert.equal(gateNames.includes("typecheck"), true);
  assert.equal(gateNames.includes("dead_code"), true);
  assert.equal(gateNames.includes("duplication_scan"), false);
});

test("route matcher supports explicit catch-all and prefix patterns", () => {
  assert.equal(matchesRoutePattern("apps/hatch/src/cli.ts", "apps/hatch/**"), true);
  assert.equal(matchesRoutePattern("apps/hatchcab/src/cli.ts", "apps/hatch/**"), false);
  assert.equal(matchesRoutePattern("apps/other/src/cli.ts", "apps/hatch/**"), false);
  assert.equal(matchesRoutePattern("scripts/pre-commit-staged-file-classifier.mjs", "*"), true);
});

test("resolvePathRouteMatches assigns first-match bucket per path", () => {
  const matches = resolvePathRouteMatches([
    "apps/hatch/src/factory/init.ts",
    "apps/hatch/src/cli.ts",
    WAVE_EXECUTE_META_JSON,
    FACTORY_PORTABILITY_ENTRYPOINT,
    WAVE_CLAIM_ENTRYPOINT,
    FACTORY_OPS_NON_WAVE_ENTRYPOINT,
    "scripts/pre-commit-staged-file-classifier.mjs",
    ".githooks/pre-commit",
  ]);

  assert.deepEqual(matches, [
    {
      path: "apps/hatch/src/factory/init.ts",
      bucket: "platform_invariant_trigger",
      pattern: "apps/hatch/src/factory/**",
    },
    {
      path: "apps/hatch/src/cli.ts",
      bucket: "guard_only",
      pattern: "apps/hatch/**",
    },
    {
      path: WAVE_EXECUTE_META_JSON,
      bucket: "guard_only",
      pattern: `${MOTHERSHIP_GRAPHS_ROOT}/**`,
    },
    {
      path: FACTORY_PORTABILITY_ENTRYPOINT,
      bucket: "platform_invariant_trigger",
      pattern: FACTORY_PORTABILITY_ENTRYPOINT,
    },
    {
      path: WAVE_CLAIM_ENTRYPOINT,
      bucket: "wave_claim_only",
      pattern: WAVE_CLAIM_ENTRYPOINT,
    },
    {
      path: FACTORY_OPS_NON_WAVE_ENTRYPOINT,
      bucket: "guard_only",
      pattern: "packages/**",
    },
    {
      path: "scripts/pre-commit-staged-file-classifier.mjs",
      bucket: "platform_invariant_trigger",
      pattern: "scripts/**",
    },
    {
      path: ".githooks/pre-commit",
      bucket: "platform_invariant_trigger",
      pattern: ".githooks/**",
    },
  ]);
});

test("factory portability paths route to platform invariants before generic factory-ops buckets", () => {
  const matches = resolvePathRouteMatches(FACTORY_PORTABILITY_PATHS);
  for (const match of matches) {
    assert.equal(match.bucket, "platform_invariant_trigger", `${match.path} must route to platform invariants`);
    assert.equal(match.pattern, match.path, `${match.path} must match its exact portability route pattern`);
  }

  const bucket = resolveSelectiveSuiteBucket(FACTORY_PORTABILITY_PATHS);
  assert.equal(bucket.selectedBucket, "platform_invariant_trigger");
  assert.equal(bucket.reason, "platform_invariant_trigger");
  assert.deepEqual(bucket.selectedSuites, []);
});

test("resolveSelectiveSuiteBucket applies deterministic overlap matrix", () => {
  const guard = resolveSelectiveSuiteBucket(["apps/hatch/src/cli.ts"]);
  assert.equal(guard.selectedBucket, "guard_only");
  assert.equal(guard.reason, "bucket_guard_only");
  assert.deepEqual(guard.selectedSuites.map((suite) => suite.name), ["test:guard-gates"]);

  const wave = resolveSelectiveSuiteBucket([WAVE_CLAIM_ENTRYPOINT]);
  assert.equal(wave.selectedBucket, "wave_claim_only");
  assert.equal(wave.reason, "bucket_wave_claim_only");
  assert.deepEqual(wave.selectedSuites.map((suite) => suite.name), ["test:wave-claim-gates"]);

  const nonWaveFactoryOps = resolveSelectiveSuiteBucket([FACTORY_OPS_NON_WAVE_ENTRYPOINT]);
  assert.equal(nonWaveFactoryOps.selectedBucket, "guard_only");
  assert.equal(nonWaveFactoryOps.reason, "bucket_guard_only");
  assert.deepEqual(nonWaveFactoryOps.selectedSuites.map((suite) => suite.name), ["test:guard-gates"]);

  const portabilityOnly = resolveSelectiveSuiteBucket([FACTORY_PORTABILITY_ENTRYPOINT]);
  assert.equal(portabilityOnly.selectedBucket, "platform_invariant_trigger");
  assert.equal(portabilityOnly.reason, "platform_invariant_trigger");
  assert.deepEqual(portabilityOnly.selectedSuites, []);

  const overlap = resolveSelectiveSuiteBucket([
    "apps/hatch/src/cli.ts",
    WAVE_CLAIM_ENTRYPOINT,
  ]);
  assert.equal(overlap.selectedBucket, "all_suites");
  assert.equal(overlap.reason, "bucket_overlap_guard_wave");
  assert.deepEqual(overlap.selectedSuites.map((suite) => suite.name), [
    "test:guard-gates",
    "test:wave-claim-gates",
  ]);

  const factoryGraphsOnly = resolveSelectiveSuiteBucket([WAVE_EXECUTE_META_JSON]);
  assert.equal(factoryGraphsOnly.selectedBucket, "guard_only");
  assert.equal(factoryGraphsOnly.reason, "bucket_guard_only");
  assert.deepEqual(factoryGraphsOnly.selectedSuites.map((suite) => suite.name), ["test:guard-gates"]);

  const fallback = resolveSelectiveSuiteBucket(["scripts/pre-commit-staged-file-classifier.mjs"]);
  assert.equal(fallback.selectedBucket, "platform_invariant_trigger");
  assert.equal(fallback.reason, "platform_invariant_trigger");
  assert.deepEqual(fallback.selectedSuites, []);

  const scaffoldSurface = resolveSelectiveSuiteBucket(["apps/hatch/src/factory/init.ts"]);
  assert.equal(scaffoldSurface.selectedBucket, "platform_invariant_trigger");
  assert.equal(scaffoldSurface.reason, "platform_invariant_trigger");
  assert.deepEqual(scaffoldSurface.selectedSuites, []);

  const neither = resolveSelectiveSuiteBucket(["context/notes.txt"]);
  assert.equal(neither.selectedBucket, "neither_change");
  assert.equal(neither.reason, "bucket_neither_change");
  assert.deepEqual(neither.selectedSuites, []);

  const docsMixedGuard = resolveSelectiveSuiteBucket(["docs/guide.md", "apps/hatch/src/cli.ts"]);
  assert.equal(docsMixedGuard.selectedBucket, "guard_only");
  assert.equal(docsMixedGuard.reason, "bucket_guard_only");
  assert.deepEqual(docsMixedGuard.neutralPaths, ["docs/guide.md"]);

  const waveAndPlatform = resolveSelectiveSuiteBucket([
    WAVE_CLAIM_ENTRYPOINT,
    "scripts/pre-commit-staged-file-classifier.mjs",
  ]);
  assert.equal(waveAndPlatform.selectedBucket, "wave_claim_only");
  assert.equal(waveAndPlatform.reason, "bucket_wave_claim_only");
  assert.deepEqual(waveAndPlatform.selectedSuites.map((suite) => suite.name), ["test:wave-claim-gates"]);

  const guardWaveAndPlatform = resolveSelectiveSuiteBucket([
    "apps/hatch/src/cli.ts",
    WAVE_CLAIM_ENTRYPOINT,
    "scripts/pre-commit-staged-file-classifier.mjs",
  ]);
  assert.equal(guardWaveAndPlatform.selectedBucket, "all_suites");
  assert.equal(guardWaveAndPlatform.reason, "bucket_overlap_guard_wave");
  assert.deepEqual(guardWaveAndPlatform.selectedSuites.map((suite) => suite.name), [
    "test:guard-gates",
    "test:wave-claim-gates",
  ]);
});

test("test suite policy is deterministic with skip precedence and selective buckets", () => {
  const noStaged = classifyStagedPaths([]);
  assert.deepEqual(resolveTestSuitePolicy(noStaged, {}), {
    runTestSuites: false,
    reason: "no_staged_paths",
    selectedSuites: [],
    pathRoutes: [],
    neutralPaths: [],
    selectedBucket: "none",
    bucketKey: "none",
  });

  const docsOnly = classifyStagedPaths(["docs/guide.md"]);
  assert.equal(resolveTestSuitePolicy(docsOnly, {}).reason, "docs_only");

  const guardOnly = classifyStagedPaths(["apps/hatch/src/cli.ts"]);
  const guardPolicy = resolveTestSuitePolicy(guardOnly, {});
  assert.equal(guardPolicy.runTestSuites, true);
  assert.equal(guardPolicy.reason, "bucket_guard_only");
  assert.deepEqual(guardPolicy.selectedSuites.map((suite) => suite.name), ["test:guard-gates"]);

  const mixedDocsCode = classifyStagedPaths(["docs/guide.md", "apps/hatch/src/cli.ts"]);
  const mixedDocsCodePolicy = resolveTestSuitePolicy(mixedDocsCode, {});
  assert.equal(mixedDocsCodePolicy.runTestSuites, true);
  assert.equal(mixedDocsCodePolicy.reason, "bucket_guard_only");
  assert.deepEqual(mixedDocsCodePolicy.selectedSuites.map((suite) => suite.name), ["test:guard-gates"]);
  assert.deepEqual(mixedDocsCodePolicy.neutralPaths, ["docs/guide.md"]);

  const factoryGraphsOnly = classifyStagedPaths([WAVE_EXECUTE_META_JSON]);
  const factoryGraphsPolicy = resolveTestSuitePolicy(factoryGraphsOnly, {});
  assert.equal(factoryGraphsPolicy.runTestSuites, true);
  assert.equal(factoryGraphsPolicy.reason, "bucket_guard_only");
  assert.deepEqual(factoryGraphsPolicy.selectedSuites.map((suite) => suite.name), ["test:guard-gates"]);

  const waveOnly = classifyStagedPaths([WAVE_CLAIM_ENTRYPOINT]);
  const wavePolicy = resolveTestSuitePolicy(waveOnly, {});
  assert.equal(wavePolicy.runTestSuites, true);
  assert.equal(wavePolicy.reason, "bucket_wave_claim_only");
  assert.deepEqual(wavePolicy.selectedSuites.map((suite) => suite.name), ["test:wave-claim-gates"]);

  const nonWaveFactoryOpsOnly = classifyStagedPaths([FACTORY_OPS_NON_WAVE_ENTRYPOINT]);
  const nonWaveFactoryOpsPolicy = resolveTestSuitePolicy(nonWaveFactoryOpsOnly, {});
  assert.equal(nonWaveFactoryOpsPolicy.runTestSuites, true);
  assert.equal(nonWaveFactoryOpsPolicy.reason, "bucket_guard_only");
  assert.deepEqual(nonWaveFactoryOpsPolicy.selectedSuites.map((suite) => suite.name), ["test:guard-gates"]);

  const portabilityOnly = classifyStagedPaths([FACTORY_PORTABILITY_ENTRYPOINT]);
  const portabilityPolicy = resolveTestSuitePolicy(portabilityOnly, {});
  assert.equal(portabilityPolicy.runTestSuites, false);
  assert.equal(portabilityPolicy.reason, "platform_invariant_trigger");
  assert.equal(portabilityPolicy.selectedBucket, "platform_invariant_trigger");

  const overlap = classifyStagedPaths([
    "apps/hatch/src/cli.ts",
    WAVE_CLAIM_ENTRYPOINT,
  ]);
  const overlapPolicy = resolveTestSuitePolicy(overlap, {});
  assert.equal(overlapPolicy.runTestSuites, true);
  assert.equal(overlapPolicy.reason, "bucket_overlap_guard_wave");
  assert.deepEqual(overlapPolicy.selectedSuites.map((suite) => suite.name), [
    "test:guard-gates",
    "test:wave-claim-gates",
  ]);

  const platformChange = classifyStagedPaths(["scripts/pre-commit-staged-file-classifier.mjs"]);
  const platformPolicy = resolveTestSuitePolicy(platformChange, {});
  assert.equal(platformPolicy.runTestSuites, false);
  assert.equal(platformPolicy.reason, "platform_invariant_trigger");
  assert.equal(platformPolicy.selectedBucket, "platform_invariant_trigger");
  assert.deepEqual(platformPolicy.selectedSuites, []);

  const scaffoldPlatformChange = classifyStagedPaths(["apps/hatch/src/factory/init.ts"]);
  const scaffoldPlatformPolicy = resolveTestSuitePolicy(scaffoldPlatformChange, {});
  assert.equal(scaffoldPlatformPolicy.runTestSuites, false);
  assert.equal(scaffoldPlatformPolicy.reason, "platform_invariant_trigger");
  assert.equal(scaffoldPlatformPolicy.selectedBucket, "platform_invariant_trigger");
  assert.deepEqual(scaffoldPlatformPolicy.selectedSuites, []);

  const neitherChange = classifyStagedPaths(["context/notes.txt"]);
  const neitherPolicy = resolveTestSuitePolicy(neitherChange, {});
  assert.equal(neitherPolicy.runTestSuites, false);
  assert.equal(neitherPolicy.reason, "bucket_neither_change");
  assert.equal(neitherPolicy.selectedBucket, "neither_change");

});

test("expandWildcardArg performs deterministic pre-expansion for basename globs", () => {
  const fixtureDir = mkdtempSync(join(tmpdir(), "pre-commit-glob-expand-"));
  mkdirSync(join(fixtureDir, FACTORY_OPS_TEST_DIR), { recursive: true });

  writeFileSync(join(fixtureDir, FACTORY_OPS_TEST_DIR, "alpha.test.mjs"), "");
  writeFileSync(join(fixtureDir, FACTORY_OPS_TEST_DIR, "beta.test.mjs"), "");
  writeFileSync(join(fixtureDir, FACTORY_OPS_TEST_DIR, "not-a-test.mjs"), "");

  const expanded = expandWildcardArg(`${FACTORY_OPS_TEST_DIR}/*.test.mjs`, fixtureDir);
  assert.deepEqual(expanded, [
    `${FACTORY_OPS_TEST_DIR}/alpha.test.mjs`,
    `${FACTORY_OPS_TEST_DIR}/beta.test.mjs`,
  ]);
});

test("resolveCommandInvocation expands ops test glob into deterministic argv tokens", () => {
  const fixtureDir = mkdtempSync(join(tmpdir(), "pre-commit-command-expand-"));
  mkdirSync(join(fixtureDir, FACTORY_OPS_TEST_DIR), { recursive: true });
  writeFileSync(join(fixtureDir, FACTORY_OPS_TEST_DIR, "alpha.test.mjs"), "");
  writeFileSync(join(fixtureDir, FACTORY_OPS_TEST_DIR, "beta.test.mjs"), "");
  writeFileSync(join(fixtureDir, FACTORY_OPS_TEST_DIR, "not-a-test.mjs"), "");

  const invocation = resolveCommandInvocation(
    "node",
    ["--test", `${FACTORY_OPS_TEST_DIR}/*.test.mjs`],
    fixtureDir,
  );
  assert.equal(invocation.command, "node");
  assert.deepEqual(invocation.args, [
    "--test",
    `${FACTORY_OPS_TEST_DIR}/alpha.test.mjs`,
    `${FACTORY_OPS_TEST_DIR}/beta.test.mjs`,
  ]);
  assert.equal(
    invocation.display,
    `node --test ${FACTORY_OPS_TEST_DIR}/alpha.test.mjs ${FACTORY_OPS_TEST_DIR}/beta.test.mjs`,
  );
});

test("CLI can emit dot-file field as strict NUL-delimited output", () => {
  const run = spawnSync(
    "node",
    [
      classifierPath,
      "--stdin0",
      "--field",
      "stagedDotFiles",
      "--format",
      "nul",
    ],
    {
      input: Buffer.from("docs/readme.md\0graphs/a.dot\0graphs/b.dot\0", "utf8"),
    },
  );

  assert.equal(run.status, 0);
  assert.equal(run.stderr.toString("utf8"), "");
  assert.deepEqual(run.stdout, Buffer.from("graphs/a.dot\0graphs/b.dot\0", "utf8"));
});

test("default staged parser handles rename semantics using destination path", () => {
  const repo = mkdtempSync(join(tmpdir(), "pre-commit-classifier-rename-"));
  mkdirSync(join(repo, "docs"), { recursive: true });
  writeFileSync(join(repo, "docs", "old.md"), "old\n");

  initFixtureRepo(repo);
  baselineFixtureCommit(repo, "init");

  runFixtureGit(repo, ["mv", "docs/old.md", "docs/new.md"]);

  const contract = runClassifierInRepo(repo);
  assert.deepEqual(contract.stagedPaths, ["docs/new.md"]);
  assert.equal(contract.isDocsOnly, true);
});

test("default staged parser includes deleted docs paths", () => {
  const repo = mkdtempSync(join(tmpdir(), "pre-commit-classifier-delete-"));
  mkdirSync(join(repo, "docs"), { recursive: true });
  writeFileSync(join(repo, "docs", "keep.md"), "keep\n");

  initFixtureRepo(repo);
  baselineFixtureCommit(repo, "init");

  runFixtureGit(repo, ["rm", "docs/keep.md"]);

  const contract = runClassifierInRepo(repo);
  assert.deepEqual(contract.stagedPaths, ["docs/keep.md"]);
  assert.equal(contract.isDocsOnly, true);
});
