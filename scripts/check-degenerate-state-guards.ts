#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_BASELINE_PATH = "scripts/degenerate-state-guard-baseline.json";
const TELEMETRY_PREFIX = "degenerate_state_guards";

function argValue(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : "";
}

export function parseArgs(argv) {
  const fileList = argValue(argv, "--file-list");
  const stagedFileList = argValue(argv, "--staged-file-list");
  const allTracked = argv.includes("--all-tracked");
  const updateBaseline = argv.includes("--update-baseline");
  const json = argv.includes("--json");
  const baselinePath = argValue(argv, "--baseline") || DEFAULT_BASELINE_PATH;
  const repoRoot = argValue(argv, "--repo-root") || process.cwd();

  if (fileList && stagedFileList) {
    throw new Error("Use only one file-list mode: --file-list or --staged-file-list");
  }

  const selectedFileList = fileList || stagedFileList;
  if (allTracked && selectedFileList) {
    throw new Error("Use only one input mode: --file-list/--staged-file-list or --all-tracked");
  }

  return {
    fileList: selectedFileList || "",
    allTracked,
    updateBaseline,
    json,
    baselinePath,
    repoRoot,
  };
}

export function parsePathListBuffer(buffer) {
  const text = String(buffer || "");
  if (text.length === 0) {
    return [];
  }

  if (text.includes("\0")) {
    return text
      .split("\0")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return text
    .split(/\r?\n/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function collectTrackedPaths({ cwd }) {
  const output = execFileSync("git", ["ls-files", "-z"], { cwd, encoding: "buffer" });
  return parsePathListBuffer(output);
}

function readPathList(path) {
  if (!path) {
    return [];
  }
  return parsePathListBuffer(readFileSync(path));
}

function resolveBaselinePath(baselinePath, repoRoot) {
  return resolve(repoRoot, baselinePath);
}

export function normalizeBaselineEntry(entry) {
  return {
    id: String(entry.id || "").trim(),
    graph: String(entry.graph || "").trim(),
    node: String(entry.node || "").trim(),
    condition: String(entry.condition || "").trim(),
    test_file: String(entry.test_file || "").trim(),
    test_pattern: String(entry.test_pattern || "").trim(),
    expected_behavior: String(entry.expected_behavior || "").trim(),
  };
}

export function validateBaselineSchema(baseline) {
  if (!baseline || typeof baseline !== "object" || Array.isArray(baseline)) {
    throw new Error("baseline must be a JSON object");
  }

  if (baseline.schema_version !== 1) {
    throw new Error("baseline.schema_version must be 1");
  }

  if (!Array.isArray(baseline.states)) {
    throw new Error("baseline.states must be an array");
  }

  const requiredFields = [
    "id",
    "graph",
    "node",
    "condition",
    "test_file",
    "test_pattern",
    "expected_behavior",
  ];

  for (let index = 0; index < baseline.states.length; index += 1) {
    const entry = normalizeBaselineEntry(baseline.states[index]);
    for (const field of requiredFields) {
      if (!entry[field]) {
        throw new Error(`baseline.states[${index}].${field} is required`);
      }
    }
  }
}

export function loadBaseline(baselineFilePath) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(baselineFilePath, "utf8"));
  } catch (error) {
    throw new Error(`failed to parse baseline JSON at ${baselineFilePath}: ${error?.message || error}`);
  }

  validateBaselineSchema(parsed);
  return {
    schema_version: 1,
    states: parsed.states.map(normalizeBaselineEntry),
  };
}

export function baselineEntryKey(entry) {
  return `${entry.graph}::${entry.node}::${entry.condition}`;
}

export function evaluateBaseline(baseline, { repoRoot }) {
  let guarded = 0;
  const unguardedEntries = [];

  for (const state of baseline.states) {
    const reasons = [];
    const testPath = resolve(repoRoot, state.test_file);

    if (!existsSync(testPath)) {
      reasons.push("missing_test_file");
    } else {
      const content = readFileSync(testPath, "utf8");
      if (!content.includes(state.test_pattern)) {
        reasons.push("missing_test_pattern");
      }
    }

    if (reasons.length === 0) {
      guarded += 1;
      continue;
    }

    unguardedEntries.push({
      id: state.id,
      key: baselineEntryKey(state),
      reasons,
      test_file: state.test_file,
    });
  }

  return {
    guarded,
    unguarded: unguardedEntries.length,
    unguardedEntries,
  };
}

export function enforceRatchet(existingStates, nextStates) {
  const existingKeys = new Set(existingStates.map((entry) => baselineEntryKey(entry)));
  const nextKeys = new Set(nextStates.map((entry) => baselineEntryKey(entry)));
  const removed = [...existingKeys].filter((key) => !nextKeys.has(key));

  if (removed.length > 0) {
    throw new Error(`baseline ratchet violation: removing ${removed.length} state(s) is not allowed`);
  }
}

function canonicalizeBaseline(baseline) {
  const states = baseline.states
    .map(normalizeBaselineEntry)
    .sort((left, right) => baselineEntryKey(left).localeCompare(baselineEntryKey(right), "en"));

  return {
    schema_version: 1,
    states,
  };
}

export function emitTelemetry({ ok, guarded, unguarded }) {
  const result = ok ? "ok" : "fail";
  const line = `[${TELEMETRY_PREFIX}] result=${result} guarded=${guarded} unguarded=${unguarded}`;
  console.log(line);
}

export function runDegenerateStateGuardCheck(options) {
  const candidatePaths = options.allTracked
    ? collectTrackedPaths({ cwd: options.repoRoot })
    : readPathList(options.fileList);

  const baselineFilePath = resolveBaselinePath(options.baselinePath, options.repoRoot);
  const baseline = loadBaseline(baselineFilePath);

  if (options.updateBaseline) {
    const nextBaseline = canonicalizeBaseline(baseline);
    enforceRatchet(baseline.states, nextBaseline.states);
    writeFileSync(baselineFilePath, `${JSON.stringify(nextBaseline, null, 2)}\n`);
  }

  const evaluation = evaluateBaseline(baseline, { repoRoot: options.repoRoot });
  return {
    ok: evaluation.unguarded === 0,
    guarded: evaluation.guarded,
    unguarded: evaluation.unguarded,
    candidate_paths: candidatePaths.length,
    unguarded_entries: evaluation.unguardedEntries,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = runDegenerateStateGuardCheck(options);
  emitTelemetry(result);

  if (options.json) {
    console.log(JSON.stringify(result));
  }

  if (!result.ok) {
    process.exit(1);
  }
}

const isDirectRun = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isDirectRun) {
  try {
    main();
  } catch (error) {
    console.error(error?.message || error);
    emitTelemetry({ ok: false, guarded: 0, unguarded: 1 });
    process.exit(1);
  }
}
