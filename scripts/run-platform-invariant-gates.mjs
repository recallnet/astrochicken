#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  PLATFORM_INVARIANT_MANIFEST,
  RELEASE_QUALITY_FAMILY_MANIFEST,
  matchesPlatformInvariantPattern,
  resolvePlatformInvariantMatches,
  resolveReleaseQualityGatePlan,
} from "./lib/platform-invariant-manifest.ts";
import {
  STAGED_DIFF_ARGS,
  formatCommandInvocation,
  parseNulDelimitedPaths,
  resolveCommandInvocation,
} from "./pre-commit-staged-file-classifier.mjs";

const BASE_GATE_CONFIG = Object.freeze({
  platform_invariants: Object.freeze({
    idField: "invariant",
    noMatchesReason: "no_matching_invariants",
    executionMode: "parallel",
    resolve(stagedPaths) {
      const invariants = resolvePlatformInvariantMatches(stagedPaths);
      const releaseQualityPlan = resolveReleaseQualityGatePlan(stagedPaths);
      const releaseQualitySourceInvariantIds = new Set(
        (releaseQualityPlan.families || []).map((family) => family.sourceInvariantId).filter(Boolean),
      );
      const dedupedInvariants = invariants.filter((invariant) => !releaseQualitySourceInvariantIds.has(invariant.id));
      return {
        shouldRun: dedupedInvariants.length > 0,
        entries: dedupedInvariants,
      };
    },
  }),
  release_quality: Object.freeze({
    idField: "family",
    noMatchesReason: "no_matching_families",
    executionMode: "sequential",
    resolve(stagedPaths) {
      const plan = resolveReleaseQualityGatePlan(stagedPaths);
      return {
        shouldRun: plan.shouldRun,
        entries: plan.families,
      };
    },
  }),
});

function singleInvariantGateConfig(invariant) {
  return Object.freeze({
    idField: "invariant",
    noMatchesReason: "direct_gate",
    executionMode: "parallel",
    resolve(stagedPaths) {
      const inputs = Array.isArray(stagedPaths) ? stagedPaths : [];
      const matchedPaths = inputs.filter((pathValue) =>
        invariant.triggerGlobs.some((pattern) => matchesPlatformInvariantPattern(pathValue, pattern)),
      );

      if (inputs.length > 0 && matchedPaths.length === 0) {
        return {
          shouldRun: false,
          entries: [],
        };
      }

      return {
        shouldRun: true,
        entries: [invariant],
      };
    },
  });
}

function buildGateConfig() {
  const config = {
    ...BASE_GATE_CONFIG,
  };

  for (const invariant of PLATFORM_INVARIANT_MANIFEST) {
    config[invariant.id] = singleInvariantGateConfig(invariant);
  }

  for (const family of RELEASE_QUALITY_FAMILY_MANIFEST) {
    if (!config[family.id]) {
      config[family.id] = Object.freeze({
        idField: "family",
        noMatchesReason: "direct_gate",
        resolve() {
          return {
            shouldRun: true,
            entries: [family],
          };
        },
      });
    }
  }

  return Object.freeze(config);
}

const GATE_CONFIG = buildGateConfig();
const GIT_HOOK_ENV_KEYS = Object.freeze([
  "GIT_COMMON_DIR",
  "GIT_DIR",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_PREFIX",
  "GIT_WORK_TREE",
  "NODE_OPTIONS",
  "NODE_PATH",
]);

function currentRssBytes() {
  return process.memoryUsage().rss;
}

export function buildPlatformGateEnv(baseEnv = process.env, { command = "" } = {}) {
  const env = { ...baseEnv };
  for (const key of GIT_HOOK_ENV_KEYS) {
    delete env[key];
  }
  if (command === "pnpm") {
    delete env.INIT_CWD;
  } else {
    for (const key of Object.keys(env)) {
      if (key === "INIT_CWD" || key.startsWith("npm_") || key.startsWith("PNPM_")) {
        delete env[key];
      }
    }
  }
  return env;
}

export function resolveParallelGateConcurrency(options = {}) {
  if (Number.isInteger(options.maxParallelEntries) && options.maxParallelEntries > 0) {
    return options.maxParallelEntries;
  }
  const configured = Number.parseInt(String(process.env.HATCH_PLATFORM_GATE_MAX_CONCURRENCY || ""), 10);
  if (Number.isInteger(configured) && configured > 0) {
    return configured;
  }
  // @context:regression !critical The heaviest platform invariants spawn full
  // pnpm/vitest/turbo stacks. A default of 4 still overcommits memory on
  // developer laptops during hook-time QA, so fail closed at 2 unless the
  // operator explicitly opts into a higher bound.
  return 2;
}

async function runWithConcurrencyLimit(entries, concurrency, worker) {
  const results = new Array(entries.length);
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= entries.length) {
        return;
      }
      results[index] = await worker(entries[index], index);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, entries.length));
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

function usage() {
  return [
    "Usage:",
    "  node scripts/run-platform-invariant-gates.mjs [--gate <platform_invariants|release_quality|<invariant-id>>] [--staged-file-list <path> | --stdin0 | --all-tracked | --files <path[,path...]>] [--dry-run] [--dry-run-fail <id>] [--telemetry-prefix <pre-commit|pre-push|pre-merge>]",
    "",
    "Defaults to reading staged paths from git diff --cached --name-only --diff-filter=ACMRD -M -z.",
  ].join("\n");
}

async function readStdin(proc) {
  const chunks = [];
  for await (const chunk of proc.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function parseArgs(argv) {
  const options = {
    gate: "platform_invariants",
    stagedFileList: null,
    stdin0: false,
    allTracked: false,
    files: null,
    dryRun: false,
    dryRunFail: new Set(),
    telemetryPrefix: "pre-commit",
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--gate") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--gate requires a value");
      }
      if (!Object.hasOwn(GATE_CONFIG, value)) {
        throw new Error(`Unsupported --gate value: ${value}`);
      }
      options.gate = value;
      index += 1;
      continue;
    }

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

    if (arg === "--all-tracked") {
      options.allTracked = true;
      continue;
    }

    if (arg === "--files") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--files requires a comma-separated path list");
      }
      options.files = value;
      index += 1;
      continue;
    }

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--dry-run-fail") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--dry-run-fail requires an invariant/family id");
      }
      options.dryRunFail.add(value);
      index += 1;
      continue;
    }

    if (arg === "--telemetry-prefix") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--telemetry-prefix requires a value");
      }
      options.telemetryPrefix = value;
      index += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  const selectedInputModes = [options.stdin0, Boolean(options.stagedFileList), options.allTracked, Boolean(options.files)]
    .filter(Boolean)
    .length;
  if (selectedInputModes > 1) {
    throw new Error("Use only one input mode: --stdin0, --staged-file-list, --all-tracked, or --files");
  }

  return options;
}

export function runGateEntry(entry, options, gateConfig) {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const cwd = options.cwd ?? process.cwd();
  const prefix = options.telemetryPrefix;
  const invocation = resolveCommandInvocation(entry.check.command, entry.check.args, cwd);
  const env = buildPlatformGateEnv(options.env ?? process.env, { command: invocation.command });
  const commandToken = JSON.stringify(formatCommandInvocation(invocation.command, invocation.args));
  const gateName = options.gate;
  const idField = gateConfig.idField;
  const entryId = entry.id;

  stdout.write(
    `[${prefix}] gate_start gate=${gateName} ${idField}=${entryId} command=${commandToken} rss_bytes=${currentRssBytes()}\n`,
  );

  if (options.dryRun) {
    const shouldFail = options.dryRunFail.has(entryId);
    if (shouldFail) {
      stderr.write(
        `[${prefix}] gate_failed gate=${gateName} ${idField}=${entryId} command=${commandToken} exit=1 dry_run=true\n`,
      );
      stderr.write(
        `[${prefix}] first_failure phase=quality_gate target=${gateName} ${idField}=${entryId} command=${commandToken} exit=1\n`,
      );
      return { ok: false, exitStatus: 1 };
    }

    stdout.write(
      `[${prefix}] gate_pass gate=${gateName} ${idField}=${entryId} command=${commandToken} exit=0 dry_run=true\n`,
    );
    return { ok: true, exitStatus: 0 };
  }

  return new Promise((resolvePromise) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd,
      env,
      stdio: "inherit",
    });

    let settled = false;
    child.on("error", () => {
      if (settled) return;
      settled = true;
      stderr.write(
        `[${prefix}] gate_failed gate=${gateName} ${idField}=${entryId} command=${commandToken} exit=1 rss_bytes=${currentRssBytes()}\n`,
      );
      stderr.write(
        `[${prefix}] first_failure phase=quality_gate target=${gateName} ${idField}=${entryId} command=${commandToken} exit=1\n`,
      );
      resolvePromise({ ok: false, exitStatus: 1 });
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      const exitStatus = Number.isInteger(code) ? code : 1;
      if (exitStatus !== 0) {
        stderr.write(
          `[${prefix}] gate_failed gate=${gateName} ${idField}=${entryId} command=${commandToken} exit=${exitStatus} rss_bytes=${currentRssBytes()}\n`,
        );
        stderr.write(
          `[${prefix}] first_failure phase=quality_gate target=${gateName} ${idField}=${entryId} command=${commandToken} exit=${exitStatus}\n`,
        );
        resolvePromise({ ok: false, exitStatus });
        return;
      }

      stdout.write(
        `[${prefix}] gate_pass gate=${gateName} ${idField}=${entryId} command=${commandToken} exit=0 rss_bytes=${currentRssBytes()}\n`,
      );
      resolvePromise({ ok: true, exitStatus: 0 });
    });
  });
}

export async function runGateEntries(entries, options, gateConfig, executor = runGateEntry) {
  const maxRetries = Number.isInteger(options.maxRetries)
    ? Math.max(0, options.maxRetries)
    : (options.gate === "release_quality" ? 1 : 0);

  async function runEntryWithRetry(entry) {
    let attempts = 0;
    while (true) {
      const result = await executor(entry, options, gateConfig);
      if (result.ok || attempts >= maxRetries) {
        return result;
      }
      attempts += 1;
      const retryStream = options.stdout ?? process.stdout;
      retryStream.write(
        `[${options.telemetryPrefix}] gate_retry gate=${options.gate} ${gateConfig.idField}=${entry.id} attempt=${attempts}\n`,
      );
    }
  }

  if (gateConfig.executionMode === "sequential") {
    for (const entry of entries) {
      const result = await runEntryWithRetry(entry);
      if (!result.ok) {
        return result;
      }
    }
    return { ok: true, exitStatus: 0 };
  }

  const results = await runWithConcurrencyLimit(
    entries,
    resolveParallelGateConcurrency(options),
    (entry) => runEntryWithRetry(entry),
  );
  for (const result of results) {
    if (!result.ok) {
      return result;
    }
  }
  return { ok: true, exitStatus: 0 };
}

function emitGateResult({ gate, ok, count, mode = "run", exitStatus = 0 }) {
  const stream = ok ? process.stdout : process.stderr;
  stream.write(`[${gate}] result=${ok ? "ok" : "fail"} entries=${count} mode=${mode} exit=${exitStatus}\n`);
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
  } else if (options.allTracked) {
    stagedBuffer = execFileSync("git", ["ls-files", "-z"], { encoding: "buffer" });
  } else if (options.files) {
    const entries = String(options.files)
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    stagedBuffer = Buffer.from(entries.length > 0 ? `${entries.join("\0")}\0` : "", "utf8");
  } else {
    stagedBuffer = execFileSync("git", STAGED_DIFF_ARGS, { encoding: "buffer" });
  }

  const stagedPaths = parseNulDelimitedPaths(stagedBuffer);
  const gateConfig = GATE_CONFIG[options.gate];
  const gatePlan = gateConfig.resolve(stagedPaths);

  if (!gatePlan.shouldRun) {
    process.stdout.write(`[${options.telemetryPrefix}] gate_skip gate=${options.gate} reason=${gateConfig.noMatchesReason}\n`);
    emitGateResult({ gate: options.gate, ok: true, count: 0, mode: "skip", exitStatus: 0 });
    return;
  }

  if (gateConfig.executionMode === "parallel") {
    process.stdout.write(
      `[${options.telemetryPrefix}] gate_plan gate=${options.gate} entries=${gatePlan.entries.length} execution_mode=parallel max_parallel_entries=${resolveParallelGateConcurrency(options)} rss_bytes=${currentRssBytes()}\n`,
    );
  }

  const run = await runGateEntries(gatePlan.entries, options, gateConfig);
  if (!run.ok) {
    emitGateResult({
      gate: options.gate,
      ok: false,
      count: gatePlan.entries.length,
      mode: options.dryRun ? "dry_run" : "run",
      exitStatus: run.exitStatus || 1,
    });
    process.exit(run.exitStatus || 1);
  }

  emitGateResult({
    gate: options.gate,
    ok: true,
    count: gatePlan.entries.length,
    mode: options.dryRun ? "dry_run" : "run",
    exitStatus: 0,
  });
}

const isEntryPoint = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isEntryPoint) {
  main().catch((error) => {
    emitGateResult({ gate: "platform_invariants", ok: false, count: 0, mode: "error", exitStatus: 1 });
    console.error(error.message);
    process.exit(1);
  });
}
