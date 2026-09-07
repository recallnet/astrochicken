import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { ensureHatchBuild } from "./lib/ensure-hatch-build.ts";

const HATCH_PARSE_ARTIFACT = resolve("apps/hatch/dist/pipeline/parse.js");
const DOT_LINT_SCRIPT = resolve("scripts/dot-lint.mjs");
export const FIXTURES_DIR = "scripts/test/fixtures/dot-lint";

export function runDotLint(args, options = {}) {
  if (!existsSync(HATCH_PARSE_ARTIFACT)) {
    ensureHatchBuild({ repoRoot: resolve("."), silent: true });
  }
  const run = spawnSync("node", [DOT_LINT_SCRIPT, ...args], {
    encoding: "utf8",
    cwd: options.cwd,
    env: { ...process.env, ...(options.env || {}) },
  });
  let payload = [];
  const stdout = String(run.stdout || "").trim();
  if (stdout) payload = JSON.parse(stdout);
  const diagnostics = Array.isArray(payload) ? payload : [];
  return {
    ...run,
    payload,
    diagnostics,
    errors: diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
    warnings: diagnostics.filter((diagnostic) => diagnostic.severity === "warning"),
  };
}

export function writeTmpDot(content) {
  const dir = mkdtempSync(join(tmpdir(), "dot-lint-test-"));
  const path = join(dir, "test.dot");
  writeFileSync(path, content, "utf8");
  return path;
}

export function writeFixtureFiles(files) {
  const dir = mkdtempSync(join(tmpdir(), "dot-lint-fixture-"));
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(dir, relativePath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content, "utf8");
  }
  return dir;
}

export function parseInlineTelemetry(stderr) {
  return String(stderr || "").split("\n").map((line) => line.trim()).filter((line) => line.startsWith("[dot-lint] inline_script_") && !line.startsWith("[dot-lint] inline_script_debt_"));
}

export function parseDebtTelemetry(stderr) {
  return String(stderr || "").split("\n").map((line) => line.trim()).filter((line) => line.startsWith("[dot-lint] inline_script_debt_"));
}

export function parseToolPolicyTelemetry(stderr) {
  return String(stderr || "").split("\n").map((line) => line.trim()).filter((line) => line.startsWith("[dot-lint] tool_prompt_policy_violation"));
}

export function parseShellMetasyntaxTelemetry(stderr) {
  return String(stderr || "").split("\n").map((line) => line.trim()).filter((line) => line.startsWith("[dot-lint] shell_metasyntax_violation"));
}

export function warningDiagnostics(run) {
  return run.warnings;
}

export function runDotLintSource({ name, source }) {
  const tempDir = mkdtempSync(join(tmpdir(), "dot-lint-inline-"));
  const filePath = join(tempDir, `${name}.dot`);
  writeFileSync(filePath, source, "utf8");
  return runDotLint([filePath, "--compat-file", `${FIXTURES_DIR}/compat-empty.json`]);
}

export function assertDiagnosticShape(diagnostic) {
  assert.deepEqual(Object.keys(diagnostic), ["file", "severity", "rule_id", "message", "line", "column", "node"]);
}
