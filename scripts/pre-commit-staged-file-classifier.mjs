#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  isDocsPathInScope,
  loadAndValidateDocsPolicy,
} from "./lib/docs-policy-validator.ts";
import {
  isArchivedDocPath,
  isLiveDocAssetPath,
} from "./lib/live-doc-assets-manifest.ts";
import {
  PLATFORM_INVARIANT_TRIGGER_GLOBS,
  isReleaseQualityTriggerPath,
  matchesPlatformInvariantPattern,
} from "./lib/platform-invariant-manifest.ts";
import {
  COVERAGE_POLICY_TRIGGER_PATHS,
  BENCHMARK_JOB_ID_REGISTRY_TRIGGER_PATHS,
  SCENARIO_COUNT_GATE_TRIGGER_PATHS,
  SCENARIO_COUNT_GATE_TRIGGER_PREFIXES,
  CONTEXT_PROPAGATION_CONTRACT_TRIGGER_PATHS,
  CONTEXT_PROPAGATION_CONTRACT_TRIGGER_PREFIXES,
  DOCS_CHECK_DEPENDENCY_PATHS,
  PATH_BUCKETS,
  QUALITY_GATE_EXECUTION_MATRIX,
  QUALITY_GATES,
  PRE_COMMIT_TEST_SUITES,
  STATE_MACHINE_TRIGGER_PATHS,
  TEST_SUITE_BUCKET_SELECTION_MATRIX,
  TEST_SUITE_BUCKET_TO_SUITES,
  TEST_SUITE_BY_NAME,
  TEST_SUITE_ROUTE_PATTERNS,
} from "./lib/pre-commit-routing-config.ts";

export {
  QUALITY_GATE_EXECUTION_MATRIX,
  QUALITY_GATES,
  PRE_COMMIT_TEST_SUITES,
  TEST_SUITE_BUCKET_SELECTION_MATRIX,
  TEST_SUITE_BUCKET_TO_SUITES,
  TEST_SUITE_ROUTE_PATTERNS,
};

export const STAGED_DIFF_ARGS = [
  "diff",
  "--cached",
  "--name-only",
  "--diff-filter=ACMRD",
  "-M",
  "-z",
];

const FALLBACK_DOCS_IN_SCOPE_PATTERNS = Object.freeze([
  "AGENTS.md",
  "CLAUDE.md",
  "CODEX.md",
  "README.md",
  "docs/**",
]);

const FALLBACK_DOCS_POLICY = Object.freeze({
  in_scope_paths: FALLBACK_DOCS_IN_SCOPE_PATTERNS,
});

let docsPathScopeCache = null;

function resolveDocsPathScope() {
  if (docsPathScopeCache) {
    return docsPathScopeCache;
  }

  const result = loadAndValidateDocsPolicy({ skipRequiredDocPathCheck: true });
  docsPathScopeCache = result.ok && result.policy
    ? result.policy
    : FALLBACK_DOCS_POLICY;

  return docsPathScopeCache;
}


/**
 * @param {string} stagedPath
 */
export function isDocsPath(stagedPath) {
  return isDocsPathInScope(stagedPath, resolveDocsPathScope());
}

/**
 * @param {string} stagedPath
 */
export function isDocsCheckTriggerPath(stagedPath) {
  return isDocsPath(stagedPath) || DOCS_CHECK_DEPENDENCY_PATHS.has(stagedPath);
}

/**
 * @param {string} stagedPath
 */
export function isDotPath(stagedPath) {
  return stagedPath.endsWith(".dot");
}

/**
 * @param {string} stagedPath
 */
export function isPlatformInvariantTriggerPath(stagedPath) {
  return PLATFORM_INVARIANT_TRIGGER_GLOBS.some((pattern) =>
    matchesPlatformInvariantPattern(stagedPath, pattern),
  );
}

/**
 * Docs/dot-only paths are neutral for selective suite routing when mixed with code paths.
 * They still participate in earlier skip policies and pre-step validations.
 *
 * @param {string} stagedPath
 */
export function isContextPropagationContractTriggerPath(stagedPath) {
  if (isDotPath(stagedPath)) {
    return true;
  }

  if (CONTEXT_PROPAGATION_CONTRACT_TRIGGER_PATHS.has(stagedPath)) {
    return true;
  }

  return CONTEXT_PROPAGATION_CONTRACT_TRIGGER_PREFIXES.some((prefix) => stagedPath.startsWith(prefix));
}

export function isNeutralSelectiveSuitePath(stagedPath) {
  return isDocsPath(stagedPath) || isDotPath(stagedPath);
}

/**
 * @param {string} pattern
 * @returns {RegExp}
 */
function wildcardPatternToRegex(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

/**
 * @param {string} stagedPath
 * @param {string} pattern
 */
export function matchesRoutePattern(stagedPath, pattern) {
  if (pattern === "*") {
    return true;
  }

  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3);
    return stagedPath === prefix || stagedPath.startsWith(`${prefix}/`);
  }

  if (pattern.includes("*")) {
    return wildcardPatternToRegex(pattern).test(stagedPath);
  }

  return stagedPath === pattern;
}

/**
 * @param {string[]} stagedPaths
 */
export function resolvePathRouteMatches(stagedPaths) {
  /** @type {{path: string, bucket: string, pattern: string}[]} */
  const pathRoutes = [];

  for (const stagedPath of stagedPaths) {
    let matchedRoute = null;
    for (const route of TEST_SUITE_ROUTE_PATTERNS) {
      if (matchesRoutePattern(stagedPath, route.pattern)) {
        matchedRoute = route;
        break;
      }
    }

    if (!matchedRoute) {
      throw new Error(`No selective-test route matched staged path: ${stagedPath}`);
    }

    pathRoutes.push({
      path: stagedPath,
      bucket: matchedRoute.bucket,
      pattern: matchedRoute.pattern,
    });
  }

  return pathRoutes;
}

/**
 * @param {string[]} stagedPaths
 */
export function resolveSelectiveSuiteBucket(stagedPaths) {
  const neutralPaths = [];
  const routablePaths = [];

  for (const stagedPath of stagedPaths) {
    if (isNeutralSelectiveSuitePath(stagedPath)) {
      neutralPaths.push(stagedPath);
      continue;
    }
    routablePaths.push(stagedPath);
  }

  if (routablePaths.length === 0) {
    return {
      bucketKey: "none",
      selectedBucket: "none",
      reason: "no_routable_paths",
      pathRoutes: [],
      neutralPaths,
      selectedSuites: [],
    };
  }

  const pathRoutes = resolvePathRouteMatches(routablePaths);
  const bucketSet = new Set(pathRoutes.map((entry) => entry.bucket));
  const bucketKey = [...bucketSet].sort().join("+");
  const matrixRow = TEST_SUITE_BUCKET_SELECTION_MATRIX[bucketKey];

  if (!matrixRow) {
    throw new Error(`No selective-suite matrix row for bucket key: ${bucketKey}`);
  }

  const selectedSuiteNames = TEST_SUITE_BUCKET_TO_SUITES[matrixRow.selectedBucket];
  if (!selectedSuiteNames) {
    throw new Error(`No suite mapping for selected bucket: ${matrixRow.selectedBucket}`);
  }

  const selectedSuites = selectedSuiteNames.map((name) => {
    const suite = TEST_SUITE_BY_NAME.get(name);
    if (!suite) {
      throw new Error(`Unknown suite in selected bucket '${matrixRow.selectedBucket}': ${name}`);
    }
    return suite;
  });

  return {
    bucketKey,
    selectedBucket: matrixRow.selectedBucket,
    reason: matrixRow.reason,
    pathRoutes,
    neutralPaths,
    selectedSuites,
  };
}

/**
 * @param {Buffer} input
 * @returns {string[]}
 */
export function parseNulDelimitedPaths(input) {
  if (input.length === 0) {
    return [];
  }

  const parts = input.toString("utf8").split("\0");
  if (parts[parts.length - 1] === "") {
    parts.pop();
  }
  return parts;
}

/**
 * @param {string[]} stagedPaths
 */
export function classifyStagedPaths(stagedPaths) {
  const contract = {
    stagedPaths: [...stagedPaths],
    hasStagedPaths: stagedPaths.length > 0,
    hasDocsPaths: false,
    hasAppsPaths: false,
    hasPackagesPaths: false,
    hasFactoriesPaths: false,
    hasScriptsPaths: false,
    hasOtherPaths: false,
    hasOpsCommandPaths: false,
    hasWorkspaceExportCoveragePaths: false,
    hasCoveragePolicyPaths: false,
    hasBenchmarkJobIdRegistryPaths: false,
    hasScenarioCountGatePaths: false,
    hasContextPropagationContractPaths: false,
    hasPipelineSegmentCoveragePaths: false,
    hasDegenerateStateGuardPaths: false,
    isDocsOnly: false,
    isDotOnly: false,
    isDocsOrDotOnly: false,
    hasDotFiles: false,
    hasDocsCheckTrigger: false,
    hasStateMachineDocsTrigger: false,
    hasPlatformInvariantTrigger: false,
    hasReleaseQualityTriggerPaths: false,
    hasLiveDocAssetPaths: false,
    hasArchivedDocPaths: false,
    stagedDotFiles: [],
    stagedDocsCheckCandidates: [],
    stagedStateMachineDocCandidates: [],
    stagedPlatformInvariantCandidates: [],
    stagedReleaseQualityTriggerCandidates: [],
    stagedLiveDocAssetCandidates: [],
    stagedArchivedDocCandidates: [],
    stagedContextPropagationContractCandidates: [],
    stagedPipelineSegmentCoverageCandidates: [],
    stagedDegenerateStateGuardCandidates: [],
    branch: "empty",
  };

  for (const stagedPath of stagedPaths) {
    let matchedBucket = false;
    for (const [flag, prefix] of PATH_BUCKETS) {
      if (stagedPath.startsWith(prefix)) {
        contract[flag] = true;
        matchedBucket = true;
      }
    }

    if (isDocsPath(stagedPath)) {
      contract.hasDocsPaths = true;
      matchedBucket = true;
    }

    if (!matchedBucket) {
      contract.hasOtherPaths = true;
    }

    if (isDotPath(stagedPath)) {
      contract.stagedDotFiles.push(stagedPath);
    }

    if (isDocsCheckTriggerPath(stagedPath)) {
      contract.stagedDocsCheckCandidates.push(stagedPath);
    }

    if (STATE_MACHINE_TRIGGER_PATHS.has(stagedPath)) {
      contract.stagedStateMachineDocCandidates.push(stagedPath);
    }

    if (isPlatformInvariantTriggerPath(stagedPath)) {
      contract.stagedPlatformInvariantCandidates.push(stagedPath);
    }

    if (isReleaseQualityTriggerPath(stagedPath)) {
      contract.stagedReleaseQualityTriggerCandidates.push(stagedPath);
    }

    if (isLiveDocAssetPath(stagedPath)) {
      contract.stagedLiveDocAssetCandidates.push(stagedPath);
    }

    if (isArchivedDocPath(stagedPath)) {
      contract.stagedArchivedDocCandidates.push(stagedPath);
    }

    if (stagedPath.startsWith("packages/factory-ops/src/commands/") ||
        stagedPath.startsWith("packages/factory-ops/test/")) {
      contract.hasOpsCommandPaths = true;
    }

    if (isContextPropagationContractTriggerPath(stagedPath)) {
      contract.stagedContextPropagationContractCandidates.push(stagedPath);
    }

    if (isDotPath(stagedPath) || stagedPath.startsWith("packages/")) {
      contract.stagedPipelineSegmentCoverageCandidates.push(stagedPath);
    }

    if (isDotPath(stagedPath)
        || stagedPath.startsWith("packages/factory-ops/src/commands/")
        || stagedPath.startsWith("packages/factory-ops/test/")) {
      contract.stagedDegenerateStateGuardCandidates.push(stagedPath);
    }

    if (stagedPath.startsWith("apps/hatch/src/")
        || stagedPath.startsWith("packages/factory-telemetry/src/")) {
      contract.hasWorkspaceExportCoveragePaths = true;
    }

    if (COVERAGE_POLICY_TRIGGER_PATHS.has(stagedPath)) {
      contract.hasCoveragePolicyPaths = true;
    }

    if (stagedPath.startsWith("factories/mothership/graphs/")
        || BENCHMARK_JOB_ID_REGISTRY_TRIGGER_PATHS.has(stagedPath)) {
      contract.hasBenchmarkJobIdRegistryPaths = true;
    }

    if (SCENARIO_COUNT_GATE_TRIGGER_PATHS.has(stagedPath)
      || SCENARIO_COUNT_GATE_TRIGGER_PREFIXES.some((prefix) => stagedPath.startsWith(prefix))) {
      contract.hasScenarioCountGatePaths = true;
    }
  }

  contract.hasDotFiles = contract.stagedDotFiles.length > 0;
  contract.hasDocsCheckTrigger = contract.stagedDocsCheckCandidates.length > 0;
  contract.hasStateMachineDocsTrigger = contract.stagedStateMachineDocCandidates.length > 0;
  contract.hasPlatformInvariantTrigger = contract.stagedPlatformInvariantCandidates.length > 0;
  contract.hasReleaseQualityTriggerPaths = contract.stagedReleaseQualityTriggerCandidates.length > 0;
  contract.hasLiveDocAssetPaths = contract.stagedLiveDocAssetCandidates.length > 0;
  contract.hasArchivedDocPaths = contract.stagedArchivedDocCandidates.length > 0;
  contract.hasContextPropagationContractPaths = contract.stagedContextPropagationContractCandidates.length > 0;
  contract.hasPipelineSegmentCoveragePaths = contract.stagedPipelineSegmentCoverageCandidates.length > 0;
  contract.hasDegenerateStateGuardPaths = contract.stagedDegenerateStateGuardCandidates.length > 0;

  contract.isDocsOnly = contract.hasStagedPaths && stagedPaths.every(isDocsPath);
  contract.isDotOnly = contract.hasStagedPaths && stagedPaths.every(isDotPath);
  contract.isDocsOrDotOnly = contract.hasStagedPaths
    && stagedPaths.every((path) => isDocsPath(path) || isDotPath(path));

  if (!contract.hasStagedPaths) {
    contract.branch = "empty";
  } else if (contract.isDocsOnly) {
    contract.branch = "docs_only";
  } else if (contract.hasOtherPaths) {
    contract.branch = "fallback_other";
  } else {
    contract.branch = "mixed_or_code";
  }

  return contract;
}

/**
 * @param {ReturnType<typeof classifyStagedPaths>} contract
 */
export function resolveQualityGatePolicy(contract) {
  const matrixRow = QUALITY_GATE_EXECUTION_MATRIX[contract.branch];
  if (!matrixRow) {
    throw new Error(`No quality-gate matrix row for branch: ${contract.branch}`);
  }

  return {
    branch: contract.branch,
    ...matrixRow,
  };
}

/**
 * @param {string} command
 * @param {readonly string[]} args
 */
export function formatCommandInvocation(command, args) {
  if (command === "pnpm" && args[0] === "--silent" && args[1]) {
    return [command, args[1], "--silent", ...args.slice(2)].join(" ");
  }
  if (command === "pnpm" && args[0] === "run" && args[1] === "--silent" && args[2]) {
    return [command, args[2], "--silent", ...args.slice(3)].join(" ");
  }
  return [command, ...args].join(" ");
}

/**
 * Expand wildcard args deterministically when they target files in the current working tree.
 * If expansion yields no matches, the original arg is preserved.
 *
 * @param {string} arg
 * @param {string} cwd
 */
export function expandWildcardArg(arg, cwd) {
  if (!arg.includes("*")) {
    return [arg];
  }

  const absolute = resolve(cwd, arg);
  const wildcardBase = arg.includes("/") ? dirname(absolute) : cwd;
  const filePattern = arg.includes("/") ? arg.slice(arg.lastIndexOf("/") + 1) : arg;

  if (!filePattern.includes("*")) {
    return [arg];
  }

  let entries;
  try {
    entries = readdirSync(wildcardBase, { withFileTypes: true });
  } catch {
    return [arg];
  }

  const regex = wildcardPatternToRegex(filePattern);
  const matches = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => regex.test(name))
    .sort((left, right) => left.localeCompare(right, "en"));

  if (matches.length === 0) {
    return [arg];
  }

  const relativeDir = arg.includes("/") ? arg.slice(0, arg.lastIndexOf("/") + 1) : "";
  return matches.map((name) => `${relativeDir}${name}`);
}

/**
 * @param {string} command
 * @param {readonly string[]} args
 * @param {string} cwd
 */
export function resolveCommandInvocation(command, args, cwd) {
  const resolvedArgs = [];
  for (const arg of args) {
    const expanded = expandWildcardArg(arg, cwd);
    for (const value of expanded) {
      resolvedArgs.push(value);
    }
  }

  return {
    command,
    args: resolvedArgs,
    display: formatCommandInvocation(command, resolvedArgs),
  };
}

/**
 * @param {ReturnType<typeof classifyStagedPaths>} contract
 */
export function resolveTestSuitePolicy(contract) {
  if (!contract.hasStagedPaths) {
    return {
      runTestSuites: false,
      reason: "no_staged_paths",
      selectedSuites: [],
      pathRoutes: [],
      neutralPaths: [],
      selectedBucket: "none",
      bucketKey: "none",
    };
  }

  if (contract.isDocsOnly && contract.isDotOnly) {
    return {
      runTestSuites: false,
      reason: "docs_and_dot_only",
      selectedSuites: [],
      pathRoutes: [],
      neutralPaths: [],
      selectedBucket: "none",
      bucketKey: "none",
    };
  }

  if (contract.isDocsOnly) {
    return {
      runTestSuites: false,
      reason: "docs_only",
      selectedSuites: [],
      pathRoutes: [],
      neutralPaths: [],
      selectedBucket: "none",
      bucketKey: "none",
    };
  }

  if (contract.isDotOnly) {
    return {
      runTestSuites: false,
      reason: "dot_only",
      selectedSuites: [],
      pathRoutes: [],
      neutralPaths: [],
      selectedBucket: "none",
      bucketKey: "none",
    };
  }

  if (contract.isDocsOrDotOnly) {
    return {
      runTestSuites: false,
      reason: "docs_or_dot_only",
      selectedSuites: [],
      pathRoutes: [],
      neutralPaths: [],
      selectedBucket: "none",
      bucketKey: "none",
    };
  }

  const selectiveBucket = resolveSelectiveSuiteBucket(contract.stagedPaths);
  if (selectiveBucket.selectedSuites.length === 0) {
    return {
      runTestSuites: false,
      reason: selectiveBucket.reason,
      selectedSuites: selectiveBucket.selectedSuites,
      pathRoutes: selectiveBucket.pathRoutes,
      neutralPaths: selectiveBucket.neutralPaths,
      selectedBucket: selectiveBucket.selectedBucket,
      bucketKey: selectiveBucket.bucketKey,
    };
  }

  return {
    runTestSuites: true,
    reason: selectiveBucket.reason,
    selectedSuites: selectiveBucket.selectedSuites,
    pathRoutes: selectiveBucket.pathRoutes,
    neutralPaths: selectiveBucket.neutralPaths,
    selectedBucket: selectiveBucket.selectedBucket,
    bucketKey: selectiveBucket.bucketKey,
  };
}

/**
 * @param {{name: string, command: string, args: readonly string[]}} gate
 * @param {{
 *   spawn?: typeof spawnSync,
 *   stdout?: NodeJS.WritableStream,
 *   stderr?: NodeJS.WritableStream,
 *   cwd?: string,
 *   env?: NodeJS.ProcessEnv,
 * }} [options]
 */
export function run_gate(gate, options = {}) {
  const spawn = options.spawn ?? spawnSync;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const invocation = resolveCommandInvocation(gate.command, gate.args, cwd);
  const commandToken = JSON.stringify(invocation.display);

  stdout.write(`[pre-commit] gate_start gate=${gate.name} command=${commandToken}\n`);

  const result = spawn(invocation.command, invocation.args, {
    cwd,
    env,
    stdio: "inherit",
  });

  if (result.error) {
    stderr.write(`[pre-commit] gate_failed gate=${gate.name} command=${commandToken} exit=1\n`);
    return {
      ok: false,
      gate: gate.name,
      command: invocation.display,
      exitStatus: 1,
      error: result.error,
    };
  }

  const exitStatus = Number.isInteger(result.status) ? result.status : 1;
  if (exitStatus !== 0) {
    stderr.write(`[pre-commit] gate_failed gate=${gate.name} command=${commandToken} exit=${exitStatus}\n`);
    return {
      ok: false,
      gate: gate.name,
      command: invocation.display,
      exitStatus,
      signal: result.signal ?? null,
    };
  }

  stdout.write(`[pre-commit] gate_pass gate=${gate.name} command=${commandToken} exit=0\n`);
  return {
    ok: true,
    gate: gate.name,
    command: invocation.display,
    exitStatus: 0,
  };
}

/**
 * @param {{name: string, command: string, args: readonly string[], commandContext?: string}} suite
 * @param {{
 *   spawn?: typeof spawnSync,
 *   stdout?: NodeJS.WritableStream,
 *   stderr?: NodeJS.WritableStream,
 *   cwd?: string,
 *   env?: NodeJS.ProcessEnv,
 * }} [options]
 */
export function run_test_suite(suite, options = {}) {
  const spawn = options.spawn ?? spawnSync;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const invocation = resolveCommandInvocation(suite.command, suite.args, cwd);
  const commandToken = JSON.stringify(invocation.display);
  const contextToken = suite.commandContext ? ` context=${JSON.stringify(suite.commandContext)}` : "";

  stdout.write(`[pre-commit] test_suite_start suite=${suite.name} command=${commandToken}${contextToken}\n`);

  const result = spawn(invocation.command, invocation.args, {
    cwd,
    env,
    stdio: "inherit",
  });

  if (result.error) {
    stderr.write(`[pre-commit] test_suite_failed suite=${suite.name} command=${commandToken}${contextToken} exit=1\n`);
    return {
      ok: false,
      suite: suite.name,
      command: invocation.display,
      exitStatus: 1,
      error: result.error,
    };
  }

  const exitStatus = Number.isInteger(result.status) ? result.status : 1;
  if (exitStatus !== 0) {
    stderr.write(`[pre-commit] test_suite_failed suite=${suite.name} command=${commandToken}${contextToken} exit=${exitStatus}\n`);
    return {
      ok: false,
      suite: suite.name,
      command: invocation.display,
      exitStatus,
      signal: result.signal ?? null,
    };
  }

  stdout.write(`[pre-commit] test_suite_pass suite=${suite.name} command=${commandToken} exit=0\n`);
  return {
    ok: true,
    suite: suite.name,
    command: invocation.display,
    exitStatus: 0,
  };
}

export const runGate = run_gate;
export const runTestSuite = run_test_suite;

/**
 * @param {NodeJS.WritableStream} stderr
 * @param {{ phase: string, target: string, exitStatus: number, command?: string }} details
 */
export function emitFirstFailure(stderr, details) {
  const commandPart = details.command ? ` command=${JSON.stringify(details.command)}` : "";
  stderr.write(`[pre-commit] first_failure phase=${details.phase} target=${details.target}${commandPart} exit=${details.exitStatus}\n`);
}

/**
 * @param {ReturnType<typeof classifyStagedPaths>} contract
 * @param {{
 *   spawn?: typeof spawnSync,
 *   stdout?: NodeJS.WritableStream,
 *   stderr?: NodeJS.WritableStream,
 *   cwd?: string,
 *   env?: NodeJS.ProcessEnv,
 * }} [options]
 */
export function runQualityGates(contract, options = {}) {
  const policy = resolveQualityGatePolicy(contract);
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;

  if (!policy.runQualityGates) {
    stdout.write(`[pre-commit] gates_skipped branch=${policy.branch} reason=${policy.reason}\n`);
    return {
      ok: true,
      skipped: true,
      policy,
    };
  }

  for (const gate of QUALITY_GATES) {
    const gateResult = run_gate(gate, options);
    if (!gateResult.ok) {
      emitFirstFailure(stderr, {
        phase: "quality_gate",
        target: gateResult.gate,
        command: gateResult.command,
        exitStatus: gateResult.exitStatus,
      });
      return {
        ok: false,
        skipped: false,
        failedGate: gateResult.gate,
        exitStatus: gateResult.exitStatus,
        policy,
      };
    }
  }

  return {
    ok: true,
    skipped: false,
    policy,
  };
}

/**
 * @param {ReturnType<typeof classifyStagedPaths>} contract
 * @param {{
 *   spawn?: typeof spawnSync,
 *   stdout?: NodeJS.WritableStream,
 *   stderr?: NodeJS.WritableStream,
 *   cwd?: string,
 *   env?: NodeJS.ProcessEnv,
 * }} [options]
 */
export function runTestSuites(contract, options = {}) {
  const env = options.env ?? process.env;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const policy = resolveTestSuitePolicy(contract, env);

  if (!policy.runTestSuites) {
    stdout.write(`[pre-commit] test_suites_decision action=skip reason=${policy.reason}\n`);
    for (const suite of PRE_COMMIT_TEST_SUITES) {
      stdout.write(`[pre-commit] test_suite_skip suite=${suite.name} reason=${policy.reason}\n`);
    }

    if (policy.reason === "skip_tests_override") {
      stderr.write(`[pre-commit] WARNING: ${policy.warning}\n`);
    }

    return {
      ok: true,
      skipped: true,
      policy,
    };
  }

  stdout.write(
    `[pre-commit] test_suites_decision action=run reason=${policy.reason} bucket=${policy.selectedBucket} selection=${policy.bucketKey}\n`,
  );

  for (const route of policy.pathRoutes) {
    stdout.write(
      `[pre-commit] test_suite_route path=${JSON.stringify(route.path)} pattern=${JSON.stringify(route.pattern)} bucket=${route.bucket}\n`,
    );
  }

  for (const neutralPath of policy.neutralPaths) {
    stdout.write(
      `[pre-commit] test_suite_route path=${JSON.stringify(neutralPath)} pattern=${JSON.stringify("excluded_docs_or_dot")} bucket=neutral\n`,
    );
  }

  const selectedSuiteNames = new Set(policy.selectedSuites.map((suite) => suite.name));
  for (const suite of PRE_COMMIT_TEST_SUITES) {
    if (!selectedSuiteNames.has(suite.name)) {
      stdout.write(
        `[pre-commit] test_suite_skip suite=${suite.name} reason=not_selected_by_bucket bucket=${policy.selectedBucket}\n`,
      );
    }
  }

  for (const suite of policy.selectedSuites) {
    const suiteResult = run_test_suite(suite, options);
    if (!suiteResult.ok) {
      emitFirstFailure(stderr, {
        phase: "test_suite",
        target: suiteResult.suite,
        command: suiteResult.command,
        exitStatus: suiteResult.exitStatus,
      });
      return {
        ok: false,
        skipped: false,
        failedSuite: suiteResult.suite,
        exitStatus: suiteResult.exitStatus,
        policy,
      };
    }
  }

  return {
    ok: true,
    skipped: false,
    policy,
  };
}

/**
 * @param {NodeJS.Process} proc
 * @returns {Promise<Buffer>}
 */
async function readStdin(proc) {
  const chunks = [];
  for await (const chunk of proc.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function usage() {
  return [
    "Usage:",
    "  node scripts/pre-commit-staged-file-classifier.mjs [--staged-file-list <path> | --stdin0] [--field <name>] [--format json|text|nul] [--run-quality-gates] [--run-test-suites]",
    "",
    "Defaults to reading staged paths from git diff --cached --name-only --diff-filter=ACMRD -M -z.",
    "",
    "Examples:",
    "  node scripts/pre-commit-staged-file-classifier.mjs",
    "  node scripts/pre-commit-staged-file-classifier.mjs --field hasDotFiles --format text",
    "  node scripts/pre-commit-staged-file-classifier.mjs --field stagedDotFiles --format nul",
    "  node scripts/pre-commit-staged-file-classifier.mjs --staged-file-list /tmp/staged --run-quality-gates",
    "  node scripts/pre-commit-staged-file-classifier.mjs --staged-file-list /tmp/staged --run-test-suites",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    stagedFileList: null,
    stdin0: false,
    field: null,
    format: "json",
    runQualityGates: false,
    runTestSuites: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--staged-file-list") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--staged-file-list requires a path");
      }
      options.stagedFileList = value;
      index += 1;
      continue;
    }

    if (arg === "--stdin0") {
      options.stdin0 = true;
      continue;
    }

    if (arg === "--field") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--field requires a value");
      }
      options.field = value;
      index += 1;
      continue;
    }

    if (arg === "--format") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--format requires a value");
      }
      options.format = value;
      index += 1;
      continue;
    }

    if (arg === "--run-quality-gates") {
      options.runQualityGates = true;
      continue;
    }

    if (arg === "--run-test-suites") {
      options.runTestSuites = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.stdin0 && options.stagedFileList) {
    throw new Error("Use only one input mode: --stdin0 or --staged-file-list");
  }

  if (!new Set(["json", "text", "nul"]).has(options.format)) {
    throw new Error(`Unsupported --format value: ${options.format}`);
  }

  if ((options.runQualityGates || options.runTestSuites) && options.field) {
    throw new Error("--run-quality-gates/--run-test-suites cannot be combined with --field");
  }

  if (options.runQualityGates && options.runTestSuites) {
    throw new Error("Use only one run mode at a time: --run-quality-gates or --run-test-suites");
  }

  return options;
}

function writeFieldValue(value, format) {
  if (format === "json") {
    process.stdout.write(`${JSON.stringify(value)}\n`);
    return;
  }

  if (format === "text") {
    if (typeof value === "boolean") {
      process.stdout.write(value ? "true\n" : "false\n");
      return;
    }

    if (typeof value === "string" || typeof value === "number") {
      process.stdout.write(`${value}\n`);
      return;
    }

    throw new Error("--format text supports only boolean, string, or number field values");
  }

  if (!Array.isArray(value)) {
    throw new Error("--format nul requires an array field value");
  }

  if (value.length === 0) {
    return;
  }

  process.stdout.write(Buffer.from(`${value.join("\0")}\0`, "utf8"));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  let stagedBuffer;
  if (options.stagedFileList) {
    stagedBuffer = readFileSync(options.stagedFileList);
  } else if (options.stdin0) {
    stagedBuffer = await readStdin(process);
  } else {
    stagedBuffer = execFileSync("git", STAGED_DIFF_ARGS, { encoding: "buffer" });
  }

  const stagedPaths = parseNulDelimitedPaths(stagedBuffer);
  const contract = classifyStagedPaths(stagedPaths);

  if (options.runQualityGates) {
    const gateResult = runQualityGates(contract);
    if (!gateResult.ok) {
      process.exit(gateResult.exitStatus || 1);
    }
    return;
  }

  if (options.runTestSuites) {
    const suiteResult = runTestSuites(contract);
    if (!suiteResult.ok) {
      process.exit(suiteResult.exitStatus || 1);
    }
    return;
  }

  if (!options.field) {
    process.stdout.write(`${JSON.stringify(contract, null, 2)}\n`);
    return;
  }

  if (!(options.field in contract)) {
    throw new Error(`Unknown contract field: ${options.field}`);
  }

  writeFieldValue(contract[options.field], options.format);
}

const isEntryPoint = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;
if (isEntryPoint) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
