#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { formatLintDotSummary, LINT_DOT_RESULT } from "./lib/lint-dot-contract.ts";

const DOT_LINT_SCRIPT = resolve(process.cwd(), "scripts/dot-lint.mjs");
const STRICT_WARNINGS_FLAG = "--strict-warnings";

function usage() {
  return "usage: node scripts/lint-dot.mjs [--strict-warnings] <dot-lint-args>";
}

function parsePayload(stdout) {
  const raw = String(stdout || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function summarizeDiagnostics(payload) {
  if (!Array.isArray(payload)) return null;

  const errors = payload.filter((entry) => entry?.severity === "error").length;
  const warnings = payload.filter((entry) => entry?.severity === "warning").length;

  return {
    diagnostics: payload.length,
    errors,
    warnings,
  };
}

function extractTarget(args) {
  const targets = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === STRICT_WARNINGS_FLAG) continue;
    if (arg === "--compat-file" || arg === "--inline-script-baseline-file") {
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) continue;
    targets.push(arg);
  }

  return targets.join(",");
}

function emitSummary({ result, target, diagnostics, errors, warnings }) {
  process.stderr.write(`${formatLintDotSummary({ result, target, diagnostics, errors, warnings })}\n`);
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const strictWarnings = rawArgs.includes(STRICT_WARNINGS_FLAG);
  const args = rawArgs.filter((arg) => arg !== STRICT_WARNINGS_FLAG);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }

  const run = spawnSync(process.execPath, [DOT_LINT_SCRIPT, ...args], {
    encoding: "utf8",
    env: process.env,
  });

  if (run.stdout) process.stdout.write(run.stdout);
  if (run.stderr) process.stderr.write(run.stderr);

  if (run.error) {
    process.stderr.write(`${String(run.error?.message || run.error)}\n`);
    emitSummary({
      result: LINT_DOT_RESULT.fail,
      target: extractTarget(args),
      diagnostics: 0,
      errors: 1,
      warnings: 0,
    });
    process.exit(2);
  }

  const payload = parsePayload(run.stdout);
  const summary = summarizeDiagnostics(payload);
  if (!summary) {
    const childStatus = Number.isInteger(run.status) ? run.status : 1;
    const exitStatus = childStatus === 0 ? 2 : childStatus;
    emitSummary({
      result: LINT_DOT_RESULT.fail,
      target: extractTarget(args),
      diagnostics: 0,
      errors: 1,
      warnings: 0,
    });
    process.exit(exitStatus);
  }

  const warningOnly = run.status === 0 && summary.warnings > 0;
  const result = warningOnly
    ? (strictWarnings ? LINT_DOT_RESULT.fail : LINT_DOT_RESULT.warningOnly)
    : (run.status === 0 ? LINT_DOT_RESULT.ok : LINT_DOT_RESULT.fail);

  emitSummary({
    result,
    target: extractTarget(args),
    diagnostics: summary.diagnostics,
    errors: summary.errors,
    warnings: summary.warnings,
  });

  if (warningOnly && strictWarnings) {
    process.exit(1);
  }

  process.exit(run.status ?? 1);
}

const isEntryPoint = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isEntryPoint) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.message || error)}\n`);
    emitSummary({
      result: LINT_DOT_RESULT.fail,
      target: extractTarget(process.argv.slice(2)),
      diagnostics: 0,
      errors: 1,
      warnings: 0,
    });
    process.exit(2);
  });
}
