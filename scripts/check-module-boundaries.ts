#!/usr/bin/env node

/**
 * check-module-boundaries.mjs
 *
 * Pre-commit guard: rejects staged source files that import across
 * forbidden module boundaries in the monorepo.
 *
 * Enforced rules:
 *   1. apps/hatch/src/** must NOT import from packages/factory-ops/
 *   2. packages/factory-ops/src/** must NOT import from apps/hatch/src/
 *   3. packages/factory-telemetry/src/** must NOT import from apps/ or packages/factory-ops/
 *
 * Contract tests (*.contract.test.*) are exempt — they intentionally
 * cross boundaries to assert structural invariants.
 */

import { readFileSync } from "node:fs";
import { relative } from "node:path";

// ── boundary rules ──────────────────────────────────────────────────
// Each rule: { source glob prefix, forbidden import target, id }
const RULES = [
  {
    id: "hatch_imports_ops",
    sourcePrefix: "apps/hatch/src/",
    forbiddenImport: /factory-ops/,
    description: "apps/hatch must not import from factory-ops",
  },
  {
    id: "ops_imports_hatch_src",
    sourcePrefix: "packages/factory-ops/src/",
    forbiddenImport: /apps\/hatch\/src\//,
    description: "factory-ops must not import from apps/hatch source",
  },
  {
    id: "telemetry_imports_ops",
    sourcePrefix: "packages/factory-telemetry/src/",
    forbiddenImport: /factory-ops/,
    description: "factory-telemetry must not import from factory-ops",
  },
  {
    id: "telemetry_imports_hatch",
    sourcePrefix: "packages/factory-telemetry/src/",
    forbiddenImport: /apps\/hatch/,
    description: "factory-telemetry must not import from apps/hatch",
  },
];

// ── helpers ──────────────────────────────────────────────────────────

function isContractTest(filePath) {
  return /\.contract\.test\.(?:mjs|cjs|js|mts|cts|ts|tsx)$/.test(filePath);
}

function isSourceFile(filePath) {
  return /\.(?:mjs|cjs|js|mts|cts|ts|tsx)$/.test(filePath);
}

// Match static import/require/re-export specifiers.
const IMPORT_PATTERN =
  /(?:^|\s)(?:import|export)\s+.*?from\s+["']([^"']+)["']|(?:^|\s)(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/gm;

function extractImportSpecifiers(content) {
  const specifiers = [];
  for (const m of content.matchAll(IMPORT_PATTERN)) {
    specifiers.push(m[1] || m[2]);
  }
  return specifiers;
}

// ── core analysis ───────────────────────────────────────────────────

export function analyzeModuleBoundaries({ files = [], readFile = defaultReadFile } = {}) {
  const violations = [];
  let checked = 0;

  for (const filePath of files) {
    if (!isSourceFile(filePath)) continue;
    if (isContractTest(filePath)) continue;

    // Find applicable rules for this source file.
    const applicableRules = RULES.filter((r) => filePath.startsWith(r.sourcePrefix));
    if (applicableRules.length === 0) continue;

    checked++;

    let content;
    try {
      content = readFile(filePath);
    } catch {
      continue; // File may have been deleted in this commit.
    }

    const specifiers = extractImportSpecifiers(content);

    for (const spec of specifiers) {
      for (const rule of applicableRules) {
        if (rule.forbiddenImport.test(spec)) {
          violations.push({
            file: filePath,
            rule_id: rule.id,
            import_specifier: spec,
            description: rule.description,
          });
        }
      }
    }
  }

  return { checked, violations };
}

function defaultReadFile(filePath) {
  return readFileSync(filePath, "utf8");
}

// ── CLI ─────────────────────────────────────────────────────────────

function argValue(args, flag) {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

function readStagedPaths(path) {
  if (!path) return [];
  try {
    return readFileSync(path, "utf8").split("\0").filter(Boolean);
  } catch {
    return [];
  }
}

function main() {
  const args = process.argv.slice(2);
  const stagedFileList = argValue(args, "--staged-file-list");
  const jsonOutput = args.includes("--json");
  const files = readStagedPaths(stagedFileList);
  const result = analyzeModuleBoundaries({ files });

  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.violations.length > 0) {
    for (const v of result.violations) {
      console.error(
        `[module-boundaries] violation file=${JSON.stringify(v.file)} rule=${v.rule_id} import=${JSON.stringify(v.import_specifier)}`,
      );
    }
    console.error(
      `[module-boundaries] result=fail checked=${result.checked} violations=${result.violations.length}`,
    );
  } else {
    console.log(
      `[module-boundaries] result=ok checked=${result.checked} violations=0`,
    );
  }

  process.exit(result.violations.length > 0 ? 1 : 0);
}

const isDirectRun = process.argv[1]?.endsWith("check-module-boundaries.ts") || process.argv[1]?.endsWith("check-module-boundaries.mjs") === true;
if (isDirectRun) {
  main();
}
