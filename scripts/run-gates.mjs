#!/usr/bin/env node
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { GATE_MANIFEST } from "./lib/gate-manifest.ts";
import {
  PRE_COMMIT_TEST_SUITES,
  resolveTestSuitePolicy,
} from "./pre-commit-staged-file-classifier.mjs";

const CLASSIFIER_PATH = "scripts/pre-commit-staged-file-classifier.mjs";
const STAGED_DIFF_ARGS = [
  "diff",
  "--cached",
  "--name-only",
  "--diff-filter=ACMRD",
  "-M",
  "-z",
];

function formatCommandInvocation(command, args) {
  if (command === "pnpm" && args[0] === "--silent" && args[1]) {
    return [command, args[1], "--silent", ...args.slice(2)].join(" ");
  }
  if (command === "pnpm" && args[0] === "run" && args[1] === "--silent" && args[2]) {
    return [command, args[2], "--silent", ...args.slice(3)].join(" ");
  }
  return [command, ...args].join(" ");
}

const DEFAULT_GATE_TIMEOUT_MS = 10 * 60 * 1000;

function currentRssBytes() {
  return process.memoryUsage().rss;
}

function shouldValidateStagedDotPath(pathValue = "") {
  if (!pathValue.endsWith(".dot")) {
    return false;
  }
  if (pathValue.startsWith("scripts/test/fixtures/")) {
    return false;
  }
  // Engine test fixtures are intentionally minimal stubs; skip schema validation.
  if (pathValue.startsWith("apps/hatch/src/pipeline/fixtures/")) {
    return false;
  }
  return !pathValue.startsWith("docs/skills/factory-design-workspace/");
}

function usage() {
  return [
    "Usage:",
    "  node scripts/run-gates.mjs --profile fast|strict|full [--staged-file-list <path>] [--all-tracked] [--telemetry-prefix <prefix>] [--json]",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    profile: "",
    stagedFileList: "",
    allTracked: false,
    telemetryPrefix: "",
    json: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--profile") {
      const value = argv[index + 1];
      if (!value) throw new Error("--profile requires a value");
      options.profile = value;
      index += 1;
      continue;
    }
    if (arg === "--staged-file-list") {
      const value = argv[index + 1];
      if (!value) throw new Error("--staged-file-list requires a path");
      options.stagedFileList = value;
      index += 1;
      continue;
    }
    if (arg === "--all-tracked") {
      options.allTracked = true;
      continue;
    }
    if (arg === "--telemetry-prefix") {
      const value = argv[index + 1];
      if (!value) throw new Error("--telemetry-prefix requires a value");
      options.telemetryPrefix = value;
      index += 1;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.help && !new Set(["fast", "strict", "full"]).has(options.profile)) {
    throw new Error("--profile must be one of: fast, strict, full");
  }

  if (options.allTracked && options.stagedFileList) {
    throw new Error("Use only one input mode: --all-tracked or --staged-file-list");
  }

  if (options.profile !== "full" && options.allTracked) {
    throw new Error("--all-tracked is supported only with --profile full");
  }

  return options;
}

function parsePathListBuffer(buffer) {
  const text = String(buffer || "");
  if (text.length === 0) return [];

  if (text.includes("\0")) {
    return text.split("\0").map((entry) => entry.trim()).filter(Boolean);
  }

  return text
    .split(/\r?\n/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function toNulBuffer(paths) {
  if (!paths.length) {
    return Buffer.alloc(0);
  }
  return Buffer.from(`${paths.join("\0")}\0`, "utf8");
}

function readInputPaths(options) {
  if (options.allTracked) {
    const output = execFileSync("git", ["ls-files", "-z"], { encoding: "buffer" });
    return parsePathListBuffer(output);
  }

  if (options.stagedFileList) {
    return parsePathListBuffer(readFileSync(options.stagedFileList));
  }

  const output = execFileSync("git", STAGED_DIFF_ARGS, { encoding: "buffer" });
  return parsePathListBuffer(output);
}

export function buildCommandEnv({ cwd = process.cwd(), env = process.env, command = "" } = {}) {
  const baseEnv = { ...env };
  // @context:regression !critical Git hooks export repository plumbing vars
  // like GIT_DIR/GIT_INDEX_FILE. Child gate processes should resolve the repo
  // from cwd instead; inheriting the hook plumbing env breaks Node ESM package
  // resolution across symlinked workspace packages under the linked worktree.
  for (const key of [
    "GIT_COMMON_DIR",
    "GIT_DIR",
    "GIT_IMPLICIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_PREFIX",
    "GIT_WORK_TREE",
    "NODE_OPTIONS",
    "NODE_PATH",
  ]) {
    delete baseEnv[key];
  }
  if (command === "pnpm") {
    delete baseEnv.INIT_CWD;
  } else {
    for (const key of Object.keys(baseEnv)) {
      if (key === "INIT_CWD" || key.startsWith("npm_") || key.startsWith("PNPM_")) {
        delete baseEnv[key];
      }
    }
  }
  const localBin = join(cwd, "node_modules", ".bin");
  if (!existsSync(localBin)) return baseEnv;

  const pathKey = Object.keys(baseEnv).find((key) => key.toUpperCase() === "PATH") || "PATH";
  const delimiter = process.platform === "win32" ? ";" : ":";
  const currentPath = String(baseEnv[pathKey] || "");
  const segments = currentPath.split(delimiter).filter(Boolean);
  if (!segments.includes(localBin)) {
    baseEnv[pathKey] = currentPath ? `${localBin}${delimiter}${currentPath}` : localBin;
  }
  return baseEnv;
}

function resolveGateTimeoutMs(timeoutMs = null, env = process.env) {
  if (Number.isInteger(timeoutMs) && timeoutMs > 0) {
    return timeoutMs;
  }

  const configured = Number.parseInt(String(env.HATCH_GATE_TIMEOUT_MS || ""), 10);
  if (Number.isInteger(configured) && configured > 0) {
    return configured;
  }

  return DEFAULT_GATE_TIMEOUT_MS;
}

export function runCommand(command, args, {
  cwd = process.cwd(),
  env = process.env,
  stdio = "inherit",
  timeoutMs = null,
} = {}) {
  const resolvedTimeoutMs = resolveGateTimeoutMs(timeoutMs, env);
  const run = spawnSync(command, args, {
    cwd,
    env: buildCommandEnv({ cwd, env, command }),
    stdio,
    encoding: stdio === "pipe" ? "utf8" : undefined,
    timeout: resolvedTimeoutMs,
    killSignal: "SIGKILL",
  });
  const timedOut = run.error?.code === "ETIMEDOUT";
  if (run.error) {
    return {
      ok: false,
      exitStatus: 1,
      error: run.error,
      stdout: String(run.stdout || ""),
      stderr: String(run.stderr || ""),
      signal: run.signal ?? null,
      timedOut,
      timeoutMs: resolvedTimeoutMs,
    };
  }
  const exitStatus = Number.isInteger(run.status) ? run.status : 1;
  return {
    ok: exitStatus === 0,
    exitStatus,
    stdout: String(run.stdout || ""),
    stderr: String(run.stderr || ""),
    signal: run.signal ?? null,
    timedOut: false,
    timeoutMs: resolvedTimeoutMs,
  };
}

// @context:decision — kill the process directly, not the process group.
// Children are no longer detached, so process.kill(-pid) would fail.
export function terminateProcessTree(pid, signal = "SIGTERM") {
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }

  try {
    process.kill(pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") {
      throw error;
    }
  }
}

export function createAsyncChildRegistry() {
  const children = new Set();

  return {
    track(child) {
      children.add(child);
      return () => {
        children.delete(child);
      };
    },
    terminateAll(signal = "SIGTERM") {
      for (const child of children) {
        terminateProcessTree(child.pid, signal);
      }
      children.clear();
    },
    size() {
      return children.size;
    },
  };
}

function runCommandAsync(command, args, {
  cwd = process.cwd(),
  env = process.env,
  stdio = "inherit",
  childRegistry = null,
  timeoutMs = null,
} = {}) {
  return new Promise((resolvePromise) => {
    // @context:decision !critical — detached:false so children die with parent.
    // Previously detached:true caused orphan process accumulation when the OS
    // OOM-killed the parent (SIGKILL cannot be caught, so cleanup never ran).
    const resolvedTimeoutMs = resolveGateTimeoutMs(timeoutMs, env);
    const child = spawn(command, args, {
      cwd,
      env: buildCommandEnv({ cwd, env, command }),
      stdio,
    });
    const releaseChild = childRegistry ? childRegistry.track(child) : () => {};
    let settled = false;
    let timeoutHandle = null;

    const settle = (payload) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      releaseChild();
      if (settled) return;
      settled = true;
      resolvePromise(payload);
    };

    timeoutHandle = setTimeout(() => {
      terminateProcessTree(child.pid, "SIGTERM");
      terminateProcessTree(child.pid, "SIGKILL");
      settle({
        ok: false,
        exitStatus: 1,
        error: new Error(`command_timed_out_after_${resolvedTimeoutMs}ms`),
        stdout: "",
        stderr: "",
        signal: "SIGKILL",
        timedOut: true,
        timeoutMs: resolvedTimeoutMs,
      });
    }, resolvedTimeoutMs);

    child.on("error", (error) => {
      settle({
        ok: false,
        exitStatus: 1,
        error,
        stdout: "",
        stderr: "",
        signal: null,
        timedOut: false,
        timeoutMs: resolvedTimeoutMs,
      });
    });

    child.on("close", (code, signal) => {
      const exitStatus = Number.isInteger(code) ? code : 1;
      settle({
        ok: exitStatus === 0,
        exitStatus,
        stdout: "",
        stderr: "",
        signal: signal ?? null,
        timedOut: false,
        timeoutMs: resolvedTimeoutMs,
      });
    });
  });
}

function topologicalBatches(gates) {
  const gateById = new Map(gates.map((gate) => [gate.id, gate]));
  const indegree = new Map(gates.map((gate) => [gate.id, 0]));
  const outgoing = new Map(gates.map((gate) => [gate.id, []]));
  const order = new Map(gates.map((gate, index) => [gate.id, index]));

  for (const gate of gates) {
    for (const dep of gate.dependsOn || []) {
      if (!gateById.has(dep)) continue;
      indegree.set(gate.id, (indegree.get(gate.id) || 0) + 1);
      outgoing.get(dep).push(gate.id);
    }
  }

  let frontier = gates.filter((gate) => (indegree.get(gate.id) || 0) === 0)
    .sort((left, right) => (order.get(left.id) || 0) - (order.get(right.id) || 0));

  const batches = [];
  const seen = new Set();

  while (frontier.length > 0) {
    const batch = [...frontier];
    batches.push(batch);
    frontier = [];

    for (const gate of batch) {
      seen.add(gate.id);
      for (const nextId of outgoing.get(gate.id) || []) {
        const nextValue = (indegree.get(nextId) || 0) - 1;
        indegree.set(nextId, nextValue);
        if (nextValue === 0) {
          frontier.push(gateById.get(nextId));
        }
      }
    }

    frontier.sort((left, right) => (order.get(left.id) || 0) - (order.get(right.id) || 0));
  }

  if (seen.size !== gates.length) {
    throw new Error("gate_manifest_cycle_detected");
  }

  return batches;
}

function emitFirstFailure(state, {
  phase,
  target,
  exitStatus,
  prefix,
  command = "",
  extra = "",
}) {
  if (state.firstFailureEmitted) return;
  const commandPart = command ? ` command=${JSON.stringify(command)}` : "";
  const extraPart = extra ? ` ${extra}` : "";
  process.stderr.write(`[${prefix}] first_failure phase=${phase} target=${target}${extraPart}${commandPart} exit=${exitStatus}\n`);
  state.firstFailureEmitted = true;
}

function preflightFailureTarget(gate) {
  return gate.failureTarget || gate.id;
}

function shouldRunGate(gate, contract) {
  if (!gate.triggerField) return true;
  return Boolean(contract[gate.triggerField]);
}

function appendRuntimeArgs(gate, context) {
  const args = [...gate.args];

  if (gate.runtime?.stagedFileList) {
    if (context.allTracked) {
      args.push("--all-tracked");
    } else {
      args.push("--staged-file-list", context.normalizedStagedPathList);
    }
  }

  if (gate.runtime?.allTracked) {
    args.push("--all-tracked");
  }

  if (gate.runtime?.telemetryPrefix && context.telemetryPrefix !== "pre-commit") {
    args.push("--telemetry-prefix", context.telemetryPrefix);
  }

  if (gate.id === "line_limit" && context.profile === "fast") {
    args.push("--all-tracked");
  }

  return args;
}

function executeDotValidateGate(gate, context, state) {
  if (context.allTracked) {
    const run = runCommand("node", ["scripts/check-dot-quality.mjs"]);
    if (!run.ok) {
      emitFirstFailure(state, {
        phase: gate.telemetryPhase,
        target: gate.id,
        exitStatus: run.exitStatus,
        prefix: context.telemetryPrefix,
      });
      return { ok: false, exitStatus: run.exitStatus };
    }
    return { ok: true, exitStatus: 0 };
  }

  for (const file of context.contract.stagedDotFiles || []) {
    if (!shouldValidateStagedDotPath(file)) continue;
    if (!existsSync(file)) continue;

    process.stdout.write(`Validating ${file}\n`);

    const validateRun = runCommand("./node_modules/.bin/hatch", ["validate", file]);
    if (!validateRun.ok) {
      emitFirstFailure(state, {
        phase: gate.telemetryPhase,
        target: file,
        exitStatus: validateRun.exitStatus,
        prefix: context.telemetryPrefix,
      });
      return { ok: false, exitStatus: validateRun.exitStatus };
    }

    const lintRun = runCommand("node", ["scripts/lint-dot.mjs", file]);
    if (!lintRun.ok) {
      emitFirstFailure(state, {
        phase: gate.telemetryPhase,
        target: file,
        exitStatus: lintRun.exitStatus,
        prefix: context.telemetryPrefix,
      });
      return { ok: false, exitStatus: lintRun.exitStatus };
    }
  }

  return { ok: true, exitStatus: 0 };
}

async function executePreflightGate(gate, context, state) {
  if (gate.runner === "dot_validate") {
    return executeDotValidateGate(gate, context, state);
  }

  return executeCommandGate(gate, context, state);
}

async function executeSelectedGates(gates, context, state) {
  const batches = topologicalBatches(gates);
  let firstFailure = null;
  for (const batch of batches) {
    const runnableBatch = batch.filter((gate) => !(firstFailure && gate.phase !== "preflight"));
    const preflightBatch = runnableBatch.filter((gate) => gate.phase === "preflight");

    // @context:regression !critical Hook fan-out was launching multiple heavy
    // gate/build processes at once, which amplified swap pressure and left
    // orphaned work behind when the parent was killed under memory stress.
    // Keep preflight serial so the hook fails closed under constrained hosts.
    for (const gate of preflightBatch) {
      const result = await executePreflightGate(gate, context, state);
      if (!result.ok) {
        if (!firstFailure) {
          firstFailure = result;
        }
      }
    }

    if (firstFailure) {
      continue;
    }

    const qualityBatch = runnableBatch.filter((gate) => gate.phase === "quality");
    for (const gate of qualityBatch) {
      const result = await executeQualityGate(gate, context, state);
      if (result.ok) {
        continue;
      }
      return result;
    }
  }

  return firstFailure || { ok: true, exitStatus: 0 };
}

function runOneTestSuite(suite, context, state) {
  const commandDisplay = formatCommandInvocation(suite.command, suite.args);
  const contextPart = suite.commandContext ? ` context=${JSON.stringify(suite.commandContext)}` : "";
  process.stdout.write(`[${context.telemetryPrefix}] test_suite_start suite=${suite.name} command=${JSON.stringify(commandDisplay)}${contextPart}\n`);

  const run = runCommand(suite.command, suite.args);
  if (!run.ok) {
    process.stderr.write(`[${context.telemetryPrefix}] test_suite_failed suite=${suite.name} command=${JSON.stringify(commandDisplay)}${contextPart} exit=${run.exitStatus}\n`);
    emitFirstFailure(state, {
      phase: "test_suite",
      target: suite.name,
      exitStatus: run.exitStatus,
      prefix: context.telemetryPrefix,
      command: commandDisplay,
    });
    return { ok: false, exitStatus: run.exitStatus };
  }

  state.executedSuiteNames.push(suite.name);
  process.stdout.write(`[${context.telemetryPrefix}] test_suite_pass suite=${suite.name} command=${JSON.stringify(commandDisplay)} exit=0\n`);
  return { ok: true, exitStatus: 0 };
}

function runWholeRepoQualityProof(context, state) {
  const commandArgs = [
    "scripts/whole-repo-quality-proof.mjs",
    "--telemetry-prefix",
    context.telemetryPrefix,
  ];

  for (const gateId of state.executedGateIds) {
    commandArgs.push("--executed-gate", gateId);
  }
  for (const suiteName of state.executedSuiteNames) {
    commandArgs.push("--executed-suite", suiteName);
  }

  const commandDisplay = ["node", ...commandArgs].join(" ");
  process.stdout.write(`[${context.telemetryPrefix}] gate_start gate=whole_repo_quality_proof command=${JSON.stringify(commandDisplay)}\n`);
  const run = runCommand("node", commandArgs);
  if (!run.ok) {
    process.stderr.write(`[${context.telemetryPrefix}] gate_failed gate=whole_repo_quality_proof command=${JSON.stringify(commandDisplay)} exit=${run.exitStatus}\n`);
    emitFirstFailure(state, {
      phase: "whole_repo_quality_proof",
      target: "whole_repo_quality_proof",
      exitStatus: run.exitStatus,
      prefix: context.telemetryPrefix,
      command: commandDisplay,
    });
    return { ok: false, exitStatus: run.exitStatus };
  }
  process.stdout.write(`[${context.telemetryPrefix}] gate_pass gate=whole_repo_quality_proof command=${JSON.stringify(commandDisplay)} exit=0\n`);
  return { ok: true, exitStatus: 0 };
}

function runTestSuites(context, state) {
  if (context.profile === "fast" || context.profile === "strict") {
    const policy = resolveTestSuitePolicy(context.contract);

    if (!policy.runTestSuites) {
      process.stdout.write(`[${context.telemetryPrefix}] test_suites_decision action=skip reason=${policy.reason}\n`);
      for (const suite of PRE_COMMIT_TEST_SUITES) {
        process.stdout.write(`[${context.telemetryPrefix}] test_suite_skip suite=${suite.name} reason=${policy.reason}\n`);
      }
      return { ok: true, exitStatus: 0 };
    }

    process.stdout.write(
      `[${context.telemetryPrefix}] test_suites_decision action=run reason=${policy.reason} bucket=${policy.selectedBucket} selection=${policy.bucketKey}\n`,
    );

    for (const route of policy.pathRoutes) {
      process.stdout.write(
        `[${context.telemetryPrefix}] test_suite_route path=${JSON.stringify(route.path)} pattern=${JSON.stringify(route.pattern)} bucket=${route.bucket}\n`,
      );
    }

    for (const neutralPath of policy.neutralPaths) {
      process.stdout.write(
        `[${context.telemetryPrefix}] test_suite_route path=${JSON.stringify(neutralPath)} pattern=${JSON.stringify("excluded_docs_or_dot")} bucket=neutral\n`,
      );
    }

    const selectedSuiteNames = new Set(policy.selectedSuites.map((suite) => suite.name));
    for (const suite of PRE_COMMIT_TEST_SUITES) {
      if (!selectedSuiteNames.has(suite.name)) {
        process.stdout.write(
          `[${context.telemetryPrefix}] test_suite_skip suite=${suite.name} reason=not_selected_by_bucket bucket=${policy.selectedBucket}\n`,
        );
      }
    }

    for (const suite of policy.selectedSuites) {
      const run = runOneTestSuite(suite, context, state);
      if (!run.ok) return run;
    }

    return { ok: true, exitStatus: 0 };
  }

  if (!context.contract.hasStagedPaths) {
    process.stdout.write(`[${context.telemetryPrefix}] test_suites_decision action=skip reason=no_staged_paths\n`);
    for (const suite of PRE_COMMIT_TEST_SUITES) {
      process.stdout.write(`[${context.telemetryPrefix}] test_suite_skip suite=${suite.name} reason=no_staged_paths\n`);
    }
    return { ok: true, exitStatus: 0 };
  }

  const profileReason = "full_profile_all_suites";
  process.stdout.write(
    `[${context.telemetryPrefix}] test_suites_decision action=run reason=${profileReason} bucket=all_suites selection=guard_only+wave_claim_only\n`,
  );

  const guardSuite = PRE_COMMIT_TEST_SUITES.find((suite) => suite.name === "test:guard-gates");
  const waveSuite = PRE_COMMIT_TEST_SUITES.find((suite) => suite.name === "test:wave-claim-gates");

  for (const suite of [guardSuite, waveSuite].filter(Boolean)) {
    const run = runOneTestSuite(suite, context, state);
    if (!run.ok) return run;
  }

  return { ok: true, exitStatus: 0 };
}

function runClassifier(normalizedStagedPathList) {
  const run = runCommand("node", [CLASSIFIER_PATH, "--staged-file-list", normalizedStagedPathList], {
    stdio: "pipe",
  });
  if (!run.ok) {
    if (run.stdout) process.stdout.write(run.stdout);
    if (run.stderr) process.stderr.write(run.stderr);
    return { ok: false, exitStatus: run.exitStatus, contract: null };
  }

  const payload = String(run.stdout || "").trim();
  try {
    return {
      ok: true,
      exitStatus: 0,
      contract: JSON.parse(payload || "{}"),
    };
  } catch (error) {
    process.stderr.write(`Failed to parse classifier output: ${error?.message || error}\n`);
    return { ok: false, exitStatus: 1, contract: null };
  }
}

function emitRunGatesResult({ ok, profile, telemetryPrefix, state, reason = "complete", exitStatus = 0 }) {
  const stream = ok ? process.stdout : process.stderr;
  const gateCount = state?.executedGateIds?.length ?? 0;
  const suiteCount = state?.executedSuiteNames?.length ?? 0;
  stream.write(
    `[run-gates] result=${ok ? "ok" : "fail"} profile=${profile} prefix=${telemetryPrefix} gates=${gateCount} suites=${suiteCount} reason=${reason} exit=${exitStatus}\n`,
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const telemetryPrefix = options.telemetryPrefix
    || (options.profile === "full" ? "pre-merge" : "pre-commit");

  const tempRoot = mkdtempSync(join(tmpdir(), "run-gates-"));
  const normalizedStagedPathList = join(tempRoot, "staged-files.list");
  const state = { firstFailureEmitted: false, executedGateIds: [], executedSuiteNames: [] };
  const asyncChildRegistry = createAsyncChildRegistry();
  const signalExitCodes = new Map([
    ["SIGINT", 130],
    ["SIGTERM", 143],
    ["SIGHUP", 129],
  ]);
  let signalTriggered = false;
  const signalHandlers = new Map();

  const installSignalHandler = (signal) => {
    const handler = () => {
      if (signalTriggered) {
        return;
      }
      signalTriggered = true;
      asyncChildRegistry.terminateAll("SIGTERM");
      asyncChildRegistry.terminateAll("SIGKILL");
      process.exit(signalExitCodes.get(signal) || 1);
    };
    signalHandlers.set(signal, handler);
    process.on(signal, handler);
  };

  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    installSignalHandler(signal);
  }

  try {
    const inputPaths = readInputPaths(options);
    writeFileSync(normalizedStagedPathList, toNulBuffer(inputPaths));

    const classifier = runClassifier(normalizedStagedPathList);
    if (!classifier.ok) {
      emitRunGatesResult({
        ok: false,
        profile: options.profile,
        telemetryPrefix,
        state,
        reason: "classifier_failed",
        exitStatus: classifier.exitStatus || 1,
      });
      process.exit(classifier.exitStatus || 1);
      return;
    }

    const contract = classifier.contract;
    if (!contract || typeof contract !== "object") {
      process.stderr.write("Classifier output missing contract payload\n");
      emitRunGatesResult({ ok: false, profile: options.profile, telemetryPrefix, state, reason: "classifier_contract_missing", exitStatus: 1 });
      process.exit(1);
      return;
    }

    if (!contract.hasStagedPaths) {
      process.stdout.write(`[${telemetryPrefix}] gates_skipped branch=empty reason=no_staged_paths\n`);
      process.stdout.write(`[${telemetryPrefix}] test_suites_decision action=skip reason=no_staged_paths\n`);
      for (const suite of PRE_COMMIT_TEST_SUITES) {
        process.stdout.write(`[${telemetryPrefix}] test_suite_skip suite=${suite.name} reason=no_staged_paths\n`);
      }
      emitRunGatesResult({ ok: true, profile: options.profile, telemetryPrefix, state, reason: "no_staged_paths", exitStatus: 0 });
      return;
    }

    const profileGates = GATE_MANIFEST
      .filter((gate) => gate.profiles.includes(options.profile))
      .filter((gate) => shouldRunGate(gate, contract));

    const nonTestGates = profileGates.filter((gate) => gate.phase !== "test_suite");

    const context = {
      profile: options.profile,
      telemetryPrefix,
      allTracked: options.allTracked,
      normalizedStagedPathList,
      contract,
      classifierOutput: classifier.contract,
      asyncChildRegistry,
    };

    const gateRun = await executeSelectedGates(nonTestGates, context, state);
    if (!gateRun.ok) {
      emitRunGatesResult({
        ok: false,
        profile: options.profile,
        telemetryPrefix,
        state,
        reason: "gate_failed",
        exitStatus: gateRun.exitStatus || 1,
      });
      process.exit(gateRun.exitStatus || 1);
      return;
    }

    const suitesRun = runTestSuites(context, state);
    if (!suitesRun.ok) {
      emitRunGatesResult({
        ok: false,
        profile: options.profile,
        telemetryPrefix,
        state,
        reason: "test_suite_failed",
        exitStatus: suitesRun.exitStatus || 1,
      });
      process.exit(suitesRun.exitStatus || 1);
      return;
    }

    if (options.profile === "full") {
      const proofRun = runWholeRepoQualityProof(context, state);
      if (!proofRun.ok) {
        emitRunGatesResult({
          ok: false,
          profile: options.profile,
          telemetryPrefix,
          state,
          reason: "whole_repo_quality_proof_failed",
          exitStatus: proofRun.exitStatus || 1,
        });
        process.exit(proofRun.exitStatus || 1);
        return;
      }
    }

    if (options.json) {
      process.stdout.write(`${JSON.stringify({ ok: true, profile: options.profile, executedGateIds: state.executedGateIds, executedSuiteNames: state.executedSuiteNames }, null, 2)}\n`);
    }
    emitRunGatesResult({ ok: true, profile: options.profile, telemetryPrefix, state, reason: "complete", exitStatus: 0 });
  } finally {
    for (const [signal, handler] of signalHandlers) {
      process.off(signal, handler);
    }
    asyncChildRegistry.terminateAll("SIGTERM");
    asyncChildRegistry.terminateAll("SIGKILL");
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

const isEntryPoint = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isEntryPoint) {
  main().catch((error) => {
    emitRunGatesResult({
      ok: false,
      profile: process.argv.includes("--profile") ? process.argv[process.argv.indexOf("--profile") + 1] || "unknown" : "unknown",
      telemetryPrefix: process.argv.includes("--telemetry-prefix") ? process.argv[process.argv.indexOf("--telemetry-prefix") + 1] || "unknown" : "unknown",
      state: { executedGateIds: [], executedSuiteNames: [] },
      reason: "fatal_error",
      exitStatus: 1,
    });
    console.error(error?.message || error);
    process.exit(1);
  });
}
