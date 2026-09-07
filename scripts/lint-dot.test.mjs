import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { ensureHatchBuild } from "./lib/ensure-hatch-build.ts";
import { LINT_DOT_MARKER_PREFIX, LINT_DOT_RESULT } from "./lib/lint-dot-contract.ts";

const HATCH_PARSE_ARTIFACT = resolve("apps/hatch/dist/pipeline/parse.js");
const LINT_DOT_SCRIPT = resolve("scripts/lint-dot.mjs");
const COMPAT_EMPTY = resolve("scripts/test/fixtures/dot-lint/compat-empty.json");
const FIXTURES_DIR = resolve("scripts/test/fixtures/lint-dot");

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function firstMarkerFromStderr(stderr) {
  return String(stderr || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .find((line) => line.startsWith(LINT_DOT_MARKER_PREFIX));
}

function runLintDot(args) {
  if (!existsSync(HATCH_PARSE_ARTIFACT)) {
    ensureHatchBuild({ repoRoot: resolve("."), silent: true });
  }
  const run = spawnSync("node", [LINT_DOT_SCRIPT, ...args], {
    encoding: "utf8",
  });

  const payloadRaw = String(run.stdout || "").trim();
  const payload = payloadRaw ? JSON.parse(payloadRaw) : [];
  const markerLine = firstMarkerFromStderr(run.stderr);

  return {
    ...run,
    payload,
    markerLine,
  };
}

test("lint-dot valid fixture emits deterministic success marker and exits 0", () => {
  const run = runLintDot([
    `${FIXTURES_DIR}/valid.dot`,
    "--compat-file",
    COMPAT_EMPTY,
  ]);

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(Array.isArray(run.payload), true);
  assert.equal(run.payload.filter((entry) => entry.severity === "error").length, 0);
  assert.equal(run.payload.filter((entry) => entry.severity === "warning").length, 0);
  assert.match(run.markerLine || "", new RegExp(`^${escapeRegex(LINT_DOT_MARKER_PREFIX)} result=${LINT_DOT_RESULT.ok} `));
  assert.match(run.markerLine || "", /diagnostics=0 errors=0 warnings=0$/);
});

test("lint-dot warning-only fixture exits 0 and emits warning_only marker", () => {
  const run = runLintDot([
    `${FIXTURES_DIR}/warning.dot`,
    "--compat-file",
    COMPAT_EMPTY,
  ]);

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(Array.isArray(run.payload), true);
  assert.equal(run.payload.some((entry) => entry.severity === "warning"), true);
  assert.equal(run.payload.some((entry) => entry.severity === "error"), false);
  assert.match(run.markerLine || "", new RegExp(`^${escapeRegex(LINT_DOT_MARKER_PREFIX)} result=${LINT_DOT_RESULT.warningOnly} `));
});

test("lint-dot strict warnings mode exits non-zero and emits fail marker for warning-only fixture", () => {
  const run = runLintDot([
    "--strict-warnings",
    `${FIXTURES_DIR}/warning.dot`,
    "--compat-file",
    COMPAT_EMPTY,
  ]);

  assert.equal(run.status, 1, run.stderr || run.stdout);
  assert.equal(Array.isArray(run.payload), true);
  assert.equal(run.payload.some((entry) => entry.severity === "warning"), true);
  assert.equal(run.payload.some((entry) => entry.severity === "error"), false);
  assert.match(run.markerLine || "", new RegExp(`^${escapeRegex(LINT_DOT_MARKER_PREFIX)} result=${LINT_DOT_RESULT.fail} `));
});

test("lint-dot fail fixture exits non-zero and emits fail marker", () => {
  const run = runLintDot([
    `${FIXTURES_DIR}/fail.txt`,
    "--compat-file",
    COMPAT_EMPTY,
  ]);

  assert.equal(run.status, 1, "expected hard lint failure status");
  assert.equal(Array.isArray(run.payload), true);
  assert.equal(run.payload.some((entry) => entry.severity === "error"), true);
  assert.match(run.markerLine || "", new RegExp(`^${escapeRegex(LINT_DOT_MARKER_PREFIX)} result=${LINT_DOT_RESULT.fail} `));
});

test("lint-dot fail marker includes prompt.shell_metasyntax fixture", () => {
  const run = runLintDot([
    "scripts/test/fixtures/dot-lint/shell-metasyntax-invalid.txt",
    "--compat-file",
    COMPAT_EMPTY,
  ]);

  assert.equal(run.status, 1, run.stderr || run.stdout);
  assert.equal(Array.isArray(run.payload), true);
  assert.equal(run.payload.some((entry) => entry.rule_id === "prompt.shell_metasyntax"), true);
  assert.match(run.markerLine || "", new RegExp(`^${escapeRegex(LINT_DOT_MARKER_PREFIX)} result=${LINT_DOT_RESULT.fail} `));
});

test("lint-dot fails closed when dot-lint payload is non-diagnostic", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "lint-dot-payload-"));
  const scriptsDir = join(tempDir, "scripts");
  mkdirSync(scriptsDir, { recursive: true });
  writeFileSync(
    join(scriptsDir, "dot-lint.mjs"),
    "#!/usr/bin/env node\nprocess.stdout.write('{\"unexpected\":true}\\n');\nprocess.exit(0);\n",
    "utf8",
  );

  const run = spawnSync("node", [LINT_DOT_SCRIPT, "fake.dot"], {
    cwd: tempDir,
    encoding: "utf8",
  });

  assert.equal(run.status, 2, run.stderr || run.stdout);
  const markerLine = firstMarkerFromStderr(run.stderr);
  assert.match(markerLine || "", new RegExp(`^${escapeRegex(LINT_DOT_MARKER_PREFIX)} result=${LINT_DOT_RESULT.fail} `));
});

test("lint-dot uses JS-compatible wrapper path and avoids direct TS runtime imports", () => {
  const source = readFileSync(LINT_DOT_SCRIPT, "utf8");
  assert.match(source, /scripts\/dot-lint\.mjs/);
  assert.doesNotMatch(source, /apps\/hatch\/src\//);
});
