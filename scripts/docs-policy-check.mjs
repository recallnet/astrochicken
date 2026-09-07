#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { runCanonicalDocsGuard } from "./lib/canonical-docs-guard.ts";
import {
  formatDocsPolicySummary,
  loadAndValidateDocsPolicy,
} from "./lib/docs-policy-validator.ts";

function parseArgs(argv) {
  const options = {
    policyPath: undefined,
    schemaPath: undefined,
    canonicalDocsPath: undefined,
    skipRequiredDocPathCheck: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--policy") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--policy requires a path");
      }
      options.policyPath = value;
      index += 1;
      continue;
    }

    if (arg === "--schema") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--schema requires a path");
      }
      options.schemaPath = value;
      index += 1;
      continue;
    }

    if (arg === "--canonical-docs") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--canonical-docs requires a path");
      }
      options.canonicalDocsPath = value;
      index += 1;
      continue;
    }

    if (arg === "--skip-required-doc-path-check") {
      options.skipRequiredDocPathCheck = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      process.stdout.write("Usage: node scripts/docs-policy-check.mjs [--policy <path>] [--schema <path>] [--canonical-docs <json-path>] [--skip-required-doc-path-check]\n");
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function resolveCanonicalDocsOverride(cwd, canonicalDocsPath) {
  if (!canonicalDocsPath) {
    return undefined;
  }

  const absolutePath = resolve(cwd, canonicalDocsPath);
  const payload = JSON.parse(readFileSync(absolutePath, "utf8"));

  const docsToCheck = Array.isArray(payload)
    ? payload
    : payload && Array.isArray(payload.docsToCheck)
      ? payload.docsToCheck
      : null;

  if (!Array.isArray(docsToCheck) || docsToCheck.some((value) => typeof value !== "string" || !value.trim())) {
    throw new Error("--canonical-docs must point to a JSON array of file paths or an object with a docsToCheck string[] field");
  }

  return [...new Set(docsToCheck.map((value) => value.trim()).filter(Boolean))];
}

try {
  const options = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const docsToCheck = resolveCanonicalDocsOverride(cwd, options.canonicalDocsPath);

  const policyResult = loadAndValidateDocsPolicy({
    cwd,
    policyPath: options.policyPath,
    schemaPath: options.schemaPath,
    skipRequiredDocPathCheck: options.skipRequiredDocPathCheck,
  });

  const canonicalDocsResult = runCanonicalDocsGuard({
    cwd,
    docsToCheck,
  });

  const diagnostics = [...policyResult.diagnostics, ...canonicalDocsResult.diagnostics];
  const result = {
    ...policyResult,
    ok: policyResult.ok && canonicalDocsResult.ok,
    diagnostics,
  };

  for (const diagnostic of result.diagnostics) {
    process.stderr.write(`[docs-policy] diagnostic=${JSON.stringify(diagnostic)}\n`);
  }

  process.stderr.write(`${formatDocsPolicySummary(result)}\n`);

  if (!result.ok) {
    process.exit(1);
  }
} catch (error) {
  process.stderr.write(`[docs-policy] fatal=${JSON.stringify({ message: error.message })}\n`);
  process.exit(1);
}
