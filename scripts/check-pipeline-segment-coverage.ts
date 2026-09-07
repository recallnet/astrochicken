#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const FORCE_EXIT_ENV = "PIPELINE_SEGMENT_COVERAGE_FORCE_EXIT";

function argValue(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : undefined;
}

export function parseArgs(argv) {
  const fileList = argValue(argv, "--file-list");
  const stagedFileList = argValue(argv, "--staged-file-list");
  const allTracked = argv.includes("--all-tracked");
  const json = argv.includes("--json");

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
    json,
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

function readPathList(path) {
  if (!path) {
    return [];
  }
  return parsePathListBuffer(readFileSync(path));
}

function collectTrackedPaths({ cwd = process.cwd() } = {}) {
  const run = spawnSync("git", ["ls-files", "-z"], {
    cwd,
    encoding: "utf8",
  });

  if (run.status !== 0) {
    throw new Error(`git ls-files failed: ${String(run.stderr || run.stdout || "unknown_error")}`);
  }

  return parsePathListBuffer(run.stdout || "");
}

export function selectCandidatePaths({ fileList, allTracked }) {
  return allTracked
    ? collectTrackedPaths()
    : readPathList(fileList);
}

export function runPipelineSegmentCoverageCheck({ candidatePaths }) {
  const forcedExitRaw = process.env[FORCE_EXIT_ENV] || "0";
  const forcedExit = Number.parseInt(forcedExitRaw, 10);
  const exitStatus = Number.isInteger(forcedExit) ? forcedExit : 0;
  const ok = exitStatus === 0;

  return {
    ok,
    mode: "stub",
    covered: 0,
    uncovered: 0,
    candidate_paths: candidatePaths.length,
    exitStatus: ok ? 0 : exitStatus,
  };
}

function emitTelemetry(result) {
  const line = `[pipeline_segment_coverage] result=${result.ok ? "ok" : "fail"} covered=${result.covered} uncovered=${result.uncovered} mode=${result.mode}`;
  console.log(line);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const candidatePaths = selectCandidatePaths(options);
  const result = runPipelineSegmentCoverageCheck({ candidatePaths });

  if (process.env.PRE_COMMIT_PIPELINE_SEGMENT_COVERAGE_STUB_LOG) {
    appendFileSync(
      process.env.PRE_COMMIT_PIPELINE_SEGMENT_COVERAGE_STUB_LOG,
      process.argv.slice(2).join(" ") + "\n",
      "utf8",
    );
  }

  emitTelemetry(result);

  if (options.json) {
    console.log(JSON.stringify(result));
  }

  if (!result.ok) {
    process.exit(result.exitStatus || 1);
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
    process.exit(1);
  }
}
