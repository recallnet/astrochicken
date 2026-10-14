import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  baselineEntryKey,
  emitTelemetry,
  enforceRatchet,
  evaluateBaseline,
  loadBaseline,
  normalizeBaselineEntry,
  parseArgs,
  parsePathListBuffer,
  runDegenerateStateGuardCheck,
  validateBaselineSchema,
} from "./check-degenerate-state-guards.ts";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const checkerPath = join(scriptsDir, "check-degenerate-state-guards.ts");
const repoRoot = resolve(scriptsDir, "..");

// Baseline contract markers referenced by scripts/degenerate-state-guard-baseline.json.
const guardPatternSentinels = Object.freeze([
  "guard_zero_commit_build",
  "guard_empty_llm_json",
  "guard_handler_failure_empty_output",
]);
void guardPatternSentinels;

function captureConsole(methodName, fn) {
  const original = console[methodName];
  const lines = [];
  console[methodName] = (...args) => {
    lines.push(args.join(" "));
  };
  try {
    fn();
  } finally {
    console[methodName] = original;
  }
  return lines;
}

function writeFixtureBaseline(dir, content) {
  const path = join(dir, "scripts", "degenerate-state-guard-baseline.json");
  mkdirSync(join(dir, "scripts"), { recursive: true });
  writeFileSync(path, JSON.stringify(content, null, 2));
  return path;
}

function writeFixtureTest(dir, relativePath, content) {
  const fullPath = join(dir, relativePath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content);
}

test("parseArgs accepts file-list aliases and flags", () => {
  assert.deepEqual(parseArgs(["--file-list", "/tmp/list", "--json"]), {
    fileList: "/tmp/list",
    allTracked: false,
    updateBaseline: false,
    json: true,
    baselinePath: "scripts/degenerate-state-guard-baseline.json",
    repoRoot: process.cwd(),
  });

  assert.deepEqual(parseArgs(["--staged-file-list", "/tmp/staged", "--update-baseline"]), {
    fileList: "/tmp/staged",
    allTracked: false,
    updateBaseline: true,
    json: false,
    baselinePath: "scripts/degenerate-state-guard-baseline.json",
    repoRoot: process.cwd(),
  });

  assert.deepEqual(parseArgs(["--all-tracked", "--baseline", "custom-baseline.json", "--repo-root", "/tmp/repo"]), {
    fileList: "",
    allTracked: true,
    updateBaseline: false,
    json: false,
    baselinePath: "custom-baseline.json",
    repoRoot: "/tmp/repo",
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

test("parsePathListBuffer handles nul/newline inputs", () => {
  assert.deepEqual(parsePathListBuffer(Buffer.from("a\0b\0", "utf8")), ["a", "b"]);
  assert.deepEqual(parsePathListBuffer(Buffer.from("a\nb\n", "utf8")), ["a", "b"]);
  assert.deepEqual(parsePathListBuffer(Buffer.alloc(0)), []);
});

test("normalizeBaselineEntry and key are deterministic", () => {
  const normalized = normalizeBaselineEntry({
    id: " x ",
    graph: " g ",
    node: " n ",
    condition: " c ",
    test_file: " t ",
    test_pattern: " p ",
    expected_behavior: " e ",
  });

  assert.deepEqual(normalized, {
    id: "x",
    graph: "g",
    node: "n",
    condition: "c",
    test_file: "t",
    test_pattern: "p",
    expected_behavior: "e",
  });
  assert.equal(baselineEntryKey(normalized), "g::n::c");
});

test("validateBaselineSchema enforces required fields", () => {
  assert.throws(() => validateBaselineSchema(null), /baseline must be a JSON object/);
  assert.throws(() => validateBaselineSchema({ schema_version: 2, states: [] }), /schema_version must be 1/);
  assert.throws(() => validateBaselineSchema({ schema_version: 1, states: [{}] }), /baseline\.states\[0\]\.id is required/);

  assert.doesNotThrow(() => {
    validateBaselineSchema({
      schema_version: 1,
      states: [{
        id: "x",
        graph: "g",
        node: "n",
        condition: "c",
        test_file: "scripts/check-degenerate-state-guards.unit.test.ts",
        test_pattern: "guard_x",
        expected_behavior: "fail_closed",
      }],
    });
  });
});

test("loadBaseline rejects malformed json", () => {
  const dir = mkdtempSync(join(tmpdir(), "degenerate-state-guards-"));
  const baselinePath = join(dir, "baseline.json");
  writeFileSync(baselinePath, "{\n");
  assert.throws(() => loadBaseline(baselinePath), /failed to parse baseline JSON/);
});

test("evaluateBaseline verifies test file existence and test pattern detection", () => {
  const dir = mkdtempSync(join(tmpdir(), "degenerate-state-guards-"));
  writeFixtureTest(dir, "scripts/guards.test.mjs", "test('guard_zero_commit_build', () => {});\n");

  const baseline = {
    schema_version: 1,
    states: [
      {
        id: "guarded",
        graph: "g",
        node: "n1",
        condition: "c1",
        test_file: "scripts/guards.test.mjs",
        test_pattern: "guard_zero_commit_build",
        expected_behavior: "fail",
      },
      {
        id: "missing_file",
        graph: "g",
        node: "n2",
        condition: "c2",
        test_file: "scripts/missing.test.mjs",
        test_pattern: "guard_missing",
        expected_behavior: "fail",
      },
      {
        id: "missing_pattern",
        graph: "g",
        node: "n3",
        condition: "c3",
        test_file: "scripts/guards.test.mjs",
        test_pattern: "guard_not_present",
        expected_behavior: "fail",
      },
    ],
  };

  const result = evaluateBaseline(baseline, { repoRoot: dir });
  assert.equal(result.guarded, 1);
  assert.equal(result.unguarded, 2);
  assert.equal(result.unguardedEntries.length, 2);
  assert.deepEqual(result.unguardedEntries[0].reasons, ["missing_test_file"]);
  assert.deepEqual(result.unguardedEntries[1].reasons, ["missing_test_pattern"]);
});

test("runDegenerateStateGuardCheck returns candidate path count for --file-list mode", () => {
  const dir = mkdtempSync(join(tmpdir(), "degenerate-state-guards-"));
  writeFixtureTest(dir, "scripts/guard-checks.test.mjs", "test('guard_zero_commit_build', () => {});\n");

  const baselinePath = writeFixtureBaseline(dir, {
    schema_version: 1,
    states: [
      {
        id: "guard_zero_commit_build",
        graph: "docs/contracts/workflow-ir/mothership/wave_execute.dot",
        node: "builder",
        condition: "builder_output_empty_or_zero_commits",
        test_file: "scripts/guard-checks.test.mjs",
        test_pattern: "guard_zero_commit_build",
        expected_behavior: "fail_closed_no_force_approval",
      },
    ],
  });

  const stagedListPath = join(dir, "staged-files.list");
  writeFileSync(
    stagedListPath,
    Buffer.from("docs/contracts/workflow-ir/mothership/wave_execute.dot\0packages/factory-ops/src/commands/wave.mjs\0", "utf8"),
  );

  const result = runDegenerateStateGuardCheck({
    fileList: stagedListPath,
    allTracked: false,
    updateBaseline: false,
    json: false,
    baselinePath,
    repoRoot: dir,
  });

  assert.equal(result.ok, true);
  assert.equal(result.guarded, 1);
  assert.equal(result.unguarded, 0);
  assert.equal(result.candidate_paths, 2);
});

test("enforceRatchet disallows baseline removals", () => {
  const existing = [
    { graph: "g", node: "n1", condition: "c1" },
    { graph: "g", node: "n2", condition: "c2" },
  ];
  const next = [
    { graph: "g", node: "n1", condition: "c1" },
  ];

  assert.throws(() => enforceRatchet(existing, next), /baseline ratchet violation/);
  assert.doesNotThrow(() => enforceRatchet(existing, [...existing, { graph: "g", node: "n3", condition: "c3" }]));
});

test("emitTelemetry contract line is stable", () => {
  const lines = captureConsole("log", () => {
    emitTelemetry({ ok: true, guarded: 3, unguarded: 0 });
    emitTelemetry({ ok: false, guarded: 2, unguarded: 1 });
  });

  assert.equal(lines[0], "[degenerate_state_guards] result=ok guarded=3 unguarded=0");
  assert.equal(lines[1], "[degenerate_state_guards] result=fail guarded=2 unguarded=1");
});

test("runDegenerateStateGuardCheck validates baseline against declared tests", () => {
  const dir = mkdtempSync(join(tmpdir(), "degenerate-state-guards-"));
  writeFixtureTest(dir, "scripts/guard-checks.test.mjs", "test('guard_zero_commit_build', () => {});\n");

  const baselinePath = writeFixtureBaseline(dir, {
    schema_version: 1,
    states: [
      {
        id: "guard_zero_commit_build",
        graph: "docs/contracts/workflow-ir/mothership/wave_execute.dot",
        node: "builder",
        condition: "builder_output_empty_or_zero_commits",
        test_file: "scripts/guard-checks.test.mjs",
        test_pattern: "guard_zero_commit_build",
        expected_behavior: "fail_closed_no_force_approval",
      },
      {
        id: "guard_empty_llm_json",
        graph: "factories/mothership/graphs/goal_run.dot",
        node: "reviewer",
        condition: "empty_or_malformed_json",
        test_file: "scripts/guard-checks.test.mjs",
        test_pattern: "guard_empty_llm_json",
        expected_behavior: "fallback_or_defect_not_silent_continue",
      },
    ],
  });

  const stagedListPath = join(dir, "staged-files.list");
  writeFileSync(stagedListPath, Buffer.from("docs/contracts/workflow-ir/mothership/wave_execute.dot\0", "utf8"));

  const result = runDegenerateStateGuardCheck({
    fileList: stagedListPath,
    allTracked: false,
    updateBaseline: false,
    json: false,
    baselinePath: baselinePath,
    repoRoot: dir,
  });

  assert.equal(result.ok, false);
  assert.equal(result.guarded, 1);
  assert.equal(result.unguarded, 1);
});

test("--update-baseline keeps ratchet and rewrites sorted canonical baseline", () => {
  const dir = mkdtempSync(join(tmpdir(), "degenerate-state-guards-"));
  writeFixtureTest(dir, "scripts/guard-checks.test.mjs", "test('guard_a', () => {});\n\ntest('guard_b', () => {});\n");

  const baselinePath = writeFixtureBaseline(dir, {
    schema_version: 1,
    states: [
      {
        id: "b",
        graph: "g",
        node: "n2",
        condition: "c2",
        test_file: "scripts/guard-checks.test.mjs",
        test_pattern: "guard_b",
        expected_behavior: "fail",
      },
      {
        id: "a",
        graph: "g",
        node: "n1",
        condition: "c1",
        test_file: "scripts/guard-checks.test.mjs",
        test_pattern: "guard_a",
        expected_behavior: "fail",
      },
    ],
  });

  const stagedListPath = join(dir, "staged-files.list");
  writeFileSync(stagedListPath, Buffer.from("docs/contracts/workflow-ir/mothership/wave_execute.dot\0", "utf8"));

  const result = runDegenerateStateGuardCheck({
    fileList: stagedListPath,
    allTracked: false,
    updateBaseline: true,
    json: false,
    baselinePath: baselinePath,
    repoRoot: dir,
  });

  assert.equal(result.ok, true);
  const rewritten = JSON.parse(readFileSync(baselinePath, "utf8"));
  assert.equal(rewritten.states[0].condition, "c1");
  assert.equal(rewritten.states[1].condition, "c2");
});

test("cli emits telemetry and json contracts", () => {
  const run = spawnSync("node", [checkerPath, "--all-tracked", "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /\[degenerate_state_guards\] result=ok guarded=\d+ unguarded=0/);
  assert.match(run.stdout, /"candidate_paths":\d+/);
});
