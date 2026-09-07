import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  parseArgs,
  parsePathListBuffer,
  selectCandidatePaths,
  runPipelineSegmentCoverageCheck,
} from "./check-pipeline-segment-coverage.ts";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const checkerPath = join(scriptsDir, "check-pipeline-segment-coverage.mjs");
const repoRoot = resolve(scriptsDir, "..");

test("parseArgs accepts file-list aliases and json flag", () => {
  assert.deepEqual(parseArgs(["--file-list", "/tmp/list", "--json"]), {
    fileList: "/tmp/list",
    allTracked: false,
    json: true,
  });

  assert.deepEqual(parseArgs(["--staged-file-list", "/tmp/staged"]), {
    fileList: "/tmp/staged",
    allTracked: false,
    json: false,
  });

  assert.deepEqual(parseArgs(["--all-tracked"]), {
    fileList: "",
    allTracked: true,
    json: false,
  });
});

test("parseArgs rejects conflicting modes", () => {
  assert.throws(
    () => parseArgs(["--file-list", "/tmp/a", "--staged-file-list", "/tmp/b"]),
    /Use only one file-list mode/,
  );

  assert.throws(
    () => parseArgs(["--all-tracked", "--staged-file-list", "/tmp/a"]),
    /Use only one input mode/,
  );
});

test("parsePathListBuffer handles nul and newline formats", () => {
  assert.deepEqual(parsePathListBuffer(Buffer.from("a\0b\0", "utf8")), ["a", "b"]);
  assert.deepEqual(parsePathListBuffer(Buffer.from("a\nb\n", "utf8")), ["a", "b"]);
  assert.deepEqual(parsePathListBuffer(Buffer.alloc(0)), []);
});

test("selectCandidatePaths reads staged file list", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "pipeline-segment-coverage-"));
  const listPath = join(tempDir, "staged-files.list");
  writeFileSync(listPath, Buffer.from("a\0b\0", "utf8"));

  const paths = selectCandidatePaths({ fileList: listPath, allTracked: false });
  assert.deepEqual(paths, ["a", "b"]);
});

test("runPipelineSegmentCoverageCheck defaults to ok stub contract", () => {
  const result = runPipelineSegmentCoverageCheck({ candidatePaths: ["a.dot"] });
  assert.equal(result.ok, true);
  assert.equal(result.mode, "stub");
  assert.equal(result.covered, 0);
  assert.equal(result.uncovered, 0);
  assert.equal(result.exitStatus, 0);
});

test("runPipelineSegmentCoverageCheck supports forced failure env contract", () => {
  const prior = process.env.PIPELINE_SEGMENT_COVERAGE_FORCE_EXIT;
  process.env.PIPELINE_SEGMENT_COVERAGE_FORCE_EXIT = "9";
  try {
    const result = runPipelineSegmentCoverageCheck({ candidatePaths: ["a.dot"] });
    assert.equal(result.ok, false);
    assert.equal(result.exitStatus, 9);
  } finally {
    if (prior === undefined) {
      delete process.env.PIPELINE_SEGMENT_COVERAGE_FORCE_EXIT;
    } else {
      process.env.PIPELINE_SEGMENT_COVERAGE_FORCE_EXIT = prior;
    }
  }
});

test("cli prints deterministic telemetry and json payload", () => {
  const run = spawnSync("node", [checkerPath, "--all-tracked", "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /\[pipeline_segment_coverage\] result=ok covered=0 uncovered=0 mode=stub/);
  assert.match(run.stdout, /"mode":"stub"/);
});
