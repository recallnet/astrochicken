#!/usr/bin/env node
/**
 * Structural test coverage enforcement for ops commands.
 *
 * Scans packages/factory-ops/src/commands/*.mjs for exports and
 * packages/factory-ops/test recursive test files for imports. Compares uncovered
 * exports against a baseline. Mutating exports require behavioral
 * coverage from non-contract tests. Exits non-zero if NEW gaps appear.
 *
 * Usage:
 *   node scripts/check-export-coverage.ts                   # check
 *   node scripts/check-export-coverage.ts --update-baseline  # snapshot
 *   node scripts/check-export-coverage.ts --json             # machine output
 */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, basename, normalize } from "node:path";

// ---------------------------------------------------------------------------
// Config defaults
// ---------------------------------------------------------------------------
const FACTORY_OPS_WORKSPACE_ROOT = "packages/factory-ops";
const DEFAULT_SRC_DIR = `${FACTORY_OPS_WORKSPACE_ROOT}/src/commands`;
const DEFAULT_TEST_DIR = `${FACTORY_OPS_WORKSPACE_ROOT}/test`;
const DEFAULT_BASELINE = `${FACTORY_OPS_WORKSPACE_ROOT}/test/.coverage-baseline.json`;

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

/** Extract exported names from a source file. */
export function parseExports(content) {
  const exports = [];
  const re = /^export\s+(?:async\s+function|function|const|let|class)\s+(\w+)/gm;
  let m;
  while ((m = re.exec(content)) !== null) {
    exports.push(m[1]);
  }
  return exports;
}

/** Extract import bindings from a file that import from ../src/commands/. */
export function parseImportsFromCommands(content) {
  const imports = [];
  // Match: import { a, b, c } from "../src/commands/file.mjs"
  // Also match: import { a, b, c } from "../../src/commands/file.mjs" (for nested helpers)
  const re = /import\s*\{([^}]+)\}\s*from\s*["'](?:\.\.\/)+src\/commands\/([^"']+)["']/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const names = m[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
    const sourceFile = basename(m[2]);
    for (const name of names) {
      imports.push({ name, sourceFile });
    }
  }
  return imports;
}

function normalizePath(path) {
  return normalize(path).replace(/\\/g, "/");
}

export function normalizeCoverageSourceFile(file = "") {
  const normalized = basename(String(file || "").trim());
  if (normalized.endsWith(".ts")) {
    return `${normalized.slice(0, -3)}.mjs`;
  }
  return normalized;
}

export function parsePathListBuffer(buffer) {
  const text = String(buffer || "");
  if (text.length === 0) return [];
  if (text.includes("\0")) {
    return text.split("\0").map((entry) => entry.trim()).filter(Boolean);
  }
  return text.split(/\r?\n/g).map((entry) => entry.trim()).filter(Boolean);
}

export function resolveExportCoverageScope(stagedPaths = []) {
  const normalizedPaths = [...new Set((Array.isArray(stagedPaths) ? stagedPaths : []).map((path) => normalizePath(path)).filter(Boolean))];
  const commandPaths = normalizedPaths
    .filter((path) => path.startsWith(`${DEFAULT_SRC_DIR}/`) && (path.endsWith(".mjs") || path.endsWith(".ts")))
    .sort((left, right) => left.localeCompare(right, "en"));
  const testPaths = normalizedPaths
    .filter((path) => path.startsWith(`${DEFAULT_TEST_DIR}/`) && (path.endsWith(".mjs") || path.endsWith(".ts")))
    .sort((left, right) => left.localeCompare(right, "en"));

  if (normalizedPaths.length === 0) {
    return {
      mode: "full",
      sourceFiles: [],
      stagedCommandPaths: commandPaths,
      stagedTestPaths: testPaths,
    };
  }

  if (commandPaths.length > 0) {
    return {
      mode: "scoped_sources",
      sourceFiles: commandPaths.map((path) => normalizeCoverageSourceFile(path)),
      stagedCommandPaths: commandPaths,
      stagedTestPaths: testPaths,
    };
  }

  return {
    mode: "skip",
    sourceFiles: [],
    stagedCommandPaths: commandPaths,
    stagedTestPaths: testPaths,
  };
}

const MUTATION_SIGNAL_PATTERN =
  /issue",\s*"(?:edit|comment|close|create|reopen)"|label",\s*"create"|api",\s*"-X",\s*"PATCH"|writeFileSync\(|appendFileSync\(|saveRunState\(|mkdirSync\(|rmSync\(/;

const SIDE_EFFECT_ASSERTION_PATTERNS = [
  /assert\.(?:deepEqual|equal|match|ok)\([\s\S]{0,240}(?:calls|invocations|labels|comments|artifacts|state|stdout|stderr|issues|milestones|files?)/,
  /readFileSync\(/,
  /existsSync\(/,
  /readdirSync\(/,
  /JSON\.parse\([^)]*stdout/,
  /\.issues\.get\(/,
  /\.getComments\(/,
  /\.listIssues\(/,
  /artifactType/,
];

const EXPORTED_SYMBOL_PATTERN = /^export\s+(?:async\s+function|function|const|let|class)\s+(\w+)\b/gm;

export function isBehavioralCoverageFile(file) {
  return (file.endsWith(".mjs") || file.endsWith(".ts")) && !file.includes(".contract.test.");
}

export function exportRequiresBehavioralCoverage(content, exportName) {
  const slice = sliceExportCoverageWindow(content, exportName);
  if (!slice) return false;
  return MUTATION_SIGNAL_PATTERN.test(slice);
}

export function fileAssertsDurableSideEffects(content) {
  return SIDE_EFFECT_ASSERTION_PATTERNS.some((pattern) => pattern.test(content));
}

export function sliceExportSource(content, exportName) {
  const match = [...content.matchAll(EXPORTED_SYMBOL_PATTERN)]
    .map((entry) => ({ index: entry.index, name: entry[1], raw: entry[0] }))
    .find((entry) => entry.name === exportName);
  if (!match) return "";

  const start = match.index;
  const header = match.raw;
  const bodyStart = content.indexOf("{", start + header.length - 1);

  if (header.includes("function") || header.includes("class")) {
    if (bodyStart < 0) return "";
    const end = findMatchingBlockEnd(content, bodyStart);
    return content.slice(start, end);
  }

  const end = findStatementEnd(content, start + header.length);
  return content.slice(start, end);
}

function sliceExportCoverageWindow(content, exportName) {
  const matches = [...content.matchAll(EXPORTED_SYMBOL_PATTERN)]
    .map((entry) => ({ index: entry.index, name: entry[1] }));
  const currentIndex = matches.findIndex((entry) => entry.name === exportName);
  if (currentIndex === -1) return "";
  const current = matches[currentIndex];
  const next = matches[currentIndex + 1];
  const end = next ? next.index : content.length;
  return content.slice(current.index, end);
}

function findMatchingBlockEnd(content, openBraceIndex) {
  let depth = 0;
  let quote = "";
  for (let index = openBraceIndex; index < content.length; index += 1) {
    const char = content[index];
    const prev = index > 0 ? content[index - 1] : "";

    if (quote) {
      if (char === quote && prev !== "\\") {
        quote = "";
      }
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }

    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
  }
  return content.length;
}

function findStatementEnd(content, startIndex) {
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let quote = "";

  for (let index = startIndex; index < content.length; index += 1) {
    const char = content[index];
    const prev = index > 0 ? content[index - 1] : "";

    if (quote) {
      if (char === quote && prev !== "\\") {
        quote = "";
      }
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }

    if (char === "(") parenDepth += 1;
    if (char === ")") parenDepth = Math.max(0, parenDepth - 1);
    if (char === "[") bracketDepth += 1;
    if (char === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    if (char === "{") braceDepth += 1;
    if (char === "}") braceDepth = Math.max(0, braceDepth - 1);

    if (char === ";" && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
      return index + 1;
    }
  }

  return content.length;
}
function listMjsFilesRecursive(rootDir) {
  const results = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile() && (entry.name.endsWith('.mjs') || entry.name.endsWith('.ts'))) {
        results.push(fullPath);
      }
    }
  };
  visit(rootDir);
  return results.sort();
}


// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

/** Scan source and test dirs, return coverage analysis. */
export function analyzeCoverage({ srcDir, testDir, sourceFiles = [] }) {
  // Phase 1: collect source exports
  const sourceExports = []; // { source, name }
  const behavioralRequired = [];
  const sourceFileScope = new Set(
    (Array.isArray(sourceFiles) ? sourceFiles : []).map((file) => normalizeCoverageSourceFile(file)),
  );
  const srcFiles = readdirSync(srcDir)
    .filter((f) => f.endsWith(".mjs") || f.endsWith(".ts"))
    .sort()
    .filter((file) => sourceFileScope.size === 0 || sourceFileScope.has(normalizeCoverageSourceFile(file)));
  for (const file of srcFiles) {
    const content = readFileSync(join(srcDir, file), "utf8");
    const names = parseExports(content);
    const normalizedSource = normalizeCoverageSourceFile(file);
    for (const name of names) {
      sourceExports.push({ source: normalizedSource, name });
      if (exportRequiresBehavioralCoverage(content, name)) {
        behavioralRequired.push({ source: normalizedSource, name });
      }
    }
  }

  // Phase 2: collect test imports (from all .mjs files under test dir, not just .test.mjs)
  const coveredSet = new Set(); // "source::name"
  const behavioralCoveredSet = new Set(); // "source::name"
  const sideEffectCoveredSet = new Set(); // "source::name"
  const testFiles = listMjsFilesRecursive(testDir);
  for (const file of testFiles) {
    const content = readFileSync(file, "utf8");
    const imports = parseImportsFromCommands(content);
    const behavioral = isBehavioralCoverageFile(file);
    const assertsSideEffects = fileAssertsDurableSideEffects(content);
    for (const imp of imports) {
      const normalizedImportSource = normalizeCoverageSourceFile(imp.sourceFile);
      coveredSet.add(`${normalizedImportSource}::${imp.name}`);
      if (behavioral) {
        behavioralCoveredSet.add(`${normalizedImportSource}::${imp.name}`);
        if (assertsSideEffects) {
          sideEffectCoveredSet.add(`${normalizedImportSource}::${imp.name}`);
        }
      }
    }
  }

  // Phase 3: compute coverage
  const covered = [];
  const uncovered = [];
  for (const exp of sourceExports) {
    const key = `${exp.source}::${exp.name}`;
    if (coveredSet.has(key)) {
      covered.push(exp);
    } else {
      uncovered.push(exp);
    }
  }

  const behavioralCovered = [];
  const behavioralUncovered = [];
  const sideEffectCovered = [];
  const sideEffectUncovered = [];
  for (const exp of behavioralRequired) {
    const key = `${exp.source}::${exp.name}`;
    if (behavioralCoveredSet.has(key)) {
      behavioralCovered.push(exp);
    } else {
      behavioralUncovered.push(exp);
    }
    if (sideEffectCoveredSet.has(key)) {
      sideEffectCovered.push(exp);
    } else {
      sideEffectUncovered.push(exp);
    }
  }

  return {
    sourceExports,
    covered,
    uncovered,
    behavioralRequired,
    behavioralCovered,
    behavioralUncovered,
    sideEffectCovered,
    sideEffectUncovered,
  };
}

/** Compare uncovered exports against baseline. */
export function compareBaseline(uncovered, baseline) {
  const baselineSet = new Set(
    (baseline.gaps || []).map((g) => `${g.source}::${g.export}`)
  );
  const currentSet = new Set(
    uncovered.map((u) => `${u.source}::${u.name}`)
  );

  const newGaps = uncovered.filter((u) => !baselineSet.has(`${u.source}::${u.name}`));
  const closedGaps = (baseline.gaps || []).filter(
    (g) => !currentSet.has(`${g.source}::${g.export}`)
  );

  return { newGaps, closedGaps };
}

export function compareBehavioralBaseline(uncovered, baseline) {
  const baselineSet = new Set(
    (baseline.behavior_gaps || []).map((g) => `${g.source}::${g.export}`),
  );
  const currentSet = new Set(
    uncovered.map((u) => `${u.source}::${u.name}`),
  );

  const newGaps = uncovered.filter((u) => !baselineSet.has(`${u.source}::${u.name}`));
  const closedGaps = (baseline.behavior_gaps || []).filter(
    (g) => !currentSet.has(`${g.source}::${g.export}`),
  );

  return { newGaps, closedGaps };
}

export function compareSideEffectBaseline(uncovered, baseline) {
  const baselineSet = new Set(
    (baseline.effect_gaps || []).map((g) => `${g.source}::${g.export}`),
  );
  const currentSet = new Set(
    uncovered.map((u) => `${u.source}::${u.name}`),
  );

  const newGaps = uncovered.filter((u) => !baselineSet.has(`${u.source}::${u.name}`));
  const closedGaps = (baseline.effect_gaps || []).filter(
    (g) => !currentSet.has(`${g.source}::${g.export}`),
  );

  return { newGaps, closedGaps };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function loadBaseline(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { schema: "export_coverage_baseline/v1", gaps: [] };
  }
}

function readStagedPaths(stagedFileListPath = "") {
  if (!stagedFileListPath) {
    return [];
  }
  return parsePathListBuffer(readFileSync(stagedFileListPath, "utf8"));
}

function main() {
  const args = process.argv.slice(2);
  const updateBaseline = args.includes("--update-baseline");
  const jsonOutput = args.includes("--json");

  const srcDir = argValue(args, "--src-dir") || DEFAULT_SRC_DIR;
  const testDir = argValue(args, "--test-dir") || DEFAULT_TEST_DIR;
  const baselinePath = argValue(args, "--baseline") || DEFAULT_BASELINE;
  const stagedFileListPath = argValue(args, "--staged-file-list");
  const scope = resolveExportCoverageScope(readStagedPaths(stagedFileListPath));

  if (scope.mode === "skip") {
    const summary = {
      total: 0,
      covered: 0,
      uncovered: 0,
      baseline: 0,
      new_gaps: 0,
      closed_gaps: 0,
      behavioral_required: 0,
      behavioral_covered: 0,
      behavioral_uncovered: 0,
      behavioral_baseline: 0,
      new_behavior_gaps: 0,
      closed_behavior_gaps: 0,
      side_effect_covered: 0,
      side_effect_uncovered: 0,
      side_effect_baseline: 0,
      new_side_effect_gaps: 0,
      closed_side_effect_gaps: 0,
      result: "ok",
      scope_mode: scope.mode,
    };
    if (jsonOutput) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log("[export-coverage] skipped: no staged command exports in scope");
    }
    process.exit(0);
  }

  const {
    sourceExports,
    covered,
    uncovered,
    behavioralRequired,
    behavioralCovered,
    behavioralUncovered,
    sideEffectCovered,
    sideEffectUncovered,
  } = analyzeCoverage({
    srcDir,
    testDir,
    sourceFiles: scope.mode === "scoped_sources" ? scope.sourceFiles : [],
  });

  if (updateBaseline) {
    const baseline = {
      schema: "export_coverage_baseline/v1",
      generated: new Date().toISOString(),
      description: "Known uncovered exports. Debt can only decrease, never increase.",
      gaps: uncovered
        .map((u) => ({ source: u.source, export: u.name }))
        .sort((a, b) => a.source.localeCompare(b.source) || a.export.localeCompare(b.export)),
      behavior_gaps: behavioralUncovered
        .map((u) => ({ source: u.source, export: u.name }))
        .sort((a, b) => a.source.localeCompare(b.source) || a.export.localeCompare(b.export)),
      effect_gaps: sideEffectUncovered
        .map((u) => ({ source: u.source, export: u.name }))
        .sort((a, b) => a.source.localeCompare(b.source) || a.export.localeCompare(b.export)),
    };
    writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + "\n");
    console.log(
      `[export-coverage] baseline_updated path=${baselinePath} gaps=${uncovered.length} behavior_gaps=${behavioralUncovered.length}`,
    );
    process.exit(0);
  }

  const baseline = loadBaseline(baselinePath);
  const { newGaps, closedGaps } = compareBaseline(uncovered, baseline);
  const {
    newGaps: newBehaviorGaps,
    closedGaps: closedBehaviorGaps,
  } = compareBehavioralBaseline(behavioralUncovered, baseline);
  const {
    newGaps: newEffectGaps,
    closedGaps: closedEffectGaps,
  } = compareSideEffectBaseline(sideEffectUncovered, baseline);

  const summary = {
    total: sourceExports.length,
    covered: covered.length,
    uncovered: uncovered.length,
    baseline: (baseline.gaps || []).length,
    new_gaps: newGaps.length,
    closed_gaps: closedGaps.length,
    behavioral_required: behavioralRequired.length,
    behavioral_covered: behavioralCovered.length,
    behavioral_uncovered: behavioralUncovered.length,
    behavioral_baseline: (baseline.behavior_gaps || []).length,
    new_behavior_gaps: newBehaviorGaps.length,
    closed_behavior_gaps: closedBehaviorGaps.length,
    side_effect_covered: sideEffectCovered.length,
    side_effect_uncovered: sideEffectUncovered.length,
    side_effect_baseline: (baseline.effect_gaps || []).length,
    new_side_effect_gaps: newEffectGaps.length,
    closed_side_effect_gaps: closedEffectGaps.length,
  };

  if (jsonOutput) {
    console.log(JSON.stringify({
      ...summary,
      result: newGaps.length > 0 || newBehaviorGaps.length > 0 || newEffectGaps.length > 0 ? "fail" : "ok",
      new_gap_details: newGaps.map((g) => ({ source: g.source, export: g.name })),
      closed_gap_details: closedGaps,
      new_behavior_gap_details: newBehaviorGaps.map((g) => ({ source: g.source, export: g.name })),
      closed_behavior_gap_details: closedBehaviorGaps,
      new_side_effect_gap_details: newEffectGaps.map((g) => ({ source: g.source, export: g.name })),
      closed_side_effect_gap_details: closedEffectGaps,
      scope_mode: scope.mode,
    }, null, 2));
  } else {
    console.log(`Ops export coverage: ${summary.covered}/${summary.total} covered, ${summary.uncovered} uncovered (baseline: ${summary.baseline})`);
    console.log(
      `Mutating export behavioral coverage: ${summary.behavioral_covered}/${summary.behavioral_required} covered, ${summary.behavioral_uncovered} uncovered (baseline: ${summary.behavioral_baseline})`,
    );
    console.log(
      `Mutating export side-effect coverage: ${summary.side_effect_covered}/${summary.behavioral_required} covered, ${summary.side_effect_uncovered} uncovered (baseline: ${summary.side_effect_baseline})`,
    );

    if (newGaps.length > 0) {
      console.error(`\nNEW UNCOVERED EXPORTS (${newGaps.length}):`);
      for (const g of newGaps) {
        console.error(`  ${g.source}::${g.name}`);
      }
      console.error("\nAdd tests that import these exports, or run --update-baseline if justified.");
    }

    if (newBehaviorGaps.length > 0) {
      console.error(`\nNEW MUTATING EXPORTS WITHOUT BEHAVIORAL COVERAGE (${newBehaviorGaps.length}):`);
      for (const g of newBehaviorGaps) {
        console.error(`  ${g.source}::${g.name}`);
      }
      console.error(
        "\nAdd a non-contract test that executes the production command/CLI boundary, or run --update-baseline if justified.",
      );
    }

    if (newEffectGaps.length > 0) {
      console.error(`\nNEW MUTATING EXPORTS WITHOUT SIDE-EFFECT ASSERTIONS (${newEffectGaps.length}):`);
      for (const g of newEffectGaps) {
        console.error(`  ${g.source}::${g.name}`);
      }
      console.error(
        "\nAdd a non-contract test that asserts durable side effects (GitHub mutation calls, label/comment state, written artifacts, or persisted run state), or run --update-baseline if justified.",
      );
    }

    if (closedGaps.length > 0) {
      console.log(`\nBaseline has ${closedGaps.length} stale entries (now covered — run --update-baseline to clean up):`);
      for (const g of closedGaps) {
        console.log(`  ${g.source}::${g.export}`);
      }
    }

    if (closedBehaviorGaps.length > 0) {
      console.log(
        `\nBehavioral baseline has ${closedBehaviorGaps.length} stale entries (now behaviorally covered — run --update-baseline to clean up):`,
      );
      for (const g of closedBehaviorGaps) {
        console.log(`  ${g.source}::${g.export}`);
      }
    }

    if (closedEffectGaps.length > 0) {
      console.log(
        `\nSide-effect baseline has ${closedEffectGaps.length} stale entries (now asserting durable effects — run --update-baseline to clean up):`,
      );
      for (const g of closedEffectGaps) {
        console.log(`  ${g.source}::${g.export}`);
      }
    }
  }

  const result = newGaps.length > 0 || newBehaviorGaps.length > 0 || newEffectGaps.length > 0 ? "fail" : "ok";
  console.log(
    `[export-coverage] result=${result} scope=${scope.mode} new_gaps=${summary.new_gaps} new_behavior_gaps=${summary.new_behavior_gaps} new_side_effect_gaps=${summary.new_side_effect_gaps} total=${summary.total} covered=${summary.covered} uncovered=${summary.uncovered} baseline=${summary.baseline}`,
  );

  process.exit(newGaps.length > 0 || newBehaviorGaps.length > 0 || newEffectGaps.length > 0 ? 1 : 0);
}

function argValue(args, flag) {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

// Only run CLI when executed directly (not when imported by tests)
const isDirectRun = process.argv[1]?.endsWith("check-export-coverage.ts") || process.argv[1]?.endsWith("check-export-coverage.mjs") === true;
if (isDirectRun) {
  main();
}
