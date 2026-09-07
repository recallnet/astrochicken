#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, normalize, relative, resolve } from "node:path";

const DEFAULT_BASELINE_PATH = "scripts/workspace-export-coverage-baseline.json";

export const WORKSPACE_EXPORT_COVERAGE_MANIFEST = Object.freeze([
  Object.freeze({
    id: "apps_hatch",
    label: "apps/hatch",
    workspaceRoot: "apps/hatch",
    srcDir: "apps/hatch/src",
    testFilePattern: /\.test\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)$/,
  }),
  Object.freeze({
    id: "factory_telemetry",
    label: "packages/factory-telemetry",
    workspaceRoot: "packages/factory-telemetry",
    srcDir: "packages/factory-telemetry/src",
    testFilePattern: /\.test\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)$/,
  }),
]);

export const WORKSPACE_EXPORT_PRIORITY_MANIFEST = Object.freeze({
  apps_hatch: Object.freeze({
    critical: Object.freeze([
      "src/cli.ts",
      "src/cli/run-config.ts",
      "src/dispatch/loop.ts",
      "src/dispatch/store.ts",
      "src/factory/init.ts",
      "src/factory/registry-update.ts",
      "src/factory/tracking-issue.ts",
      "src/pipeline/alignment-summary.ts",
      "src/pipeline/checkpoint.ts",
      "src/pipeline/decision-artifacts.ts",
      "src/pipeline/engine.ts",
      "src/pipeline/run-lifecycle-events.ts",
      "src/pipeline/run-state.ts",
      "src/pipeline/runtime-env.ts",
      "src/server/context.ts",
      "src/server/runtime-summary.ts",
      "src/server/status.ts",
    ]),
    high: Object.freeze([
      "src/factory/config-schema.ts",
      "src/factory/model-policy.ts",
      "src/factory/policy-pack.ts",
      "src/help.ts",
      "src/intent/loader.ts",
      "src/intent/schema.ts",
      "src/server/index.ts",
    ]),
  }),
  factory_telemetry: Object.freeze({
    critical: Object.freeze([
      "src/cli.ts",
      "src/emitter.ts",
      "src/query-store.ts",
      "src/runtime.ts",
      "src/spans.ts",
    ]),
    high: Object.freeze([
      "src/langfuse.ts",
      "src/schema.ts",
    ]),
  }),
});

const SOURCE_EXTENSIONS = Object.freeze([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]);
const EXPORT_DECL_RE = /^export\s+(?:async\s+function|function|const|let|class|enum)\s+(\w+)/gm;
const EXPORT_NAMED_RE = /^export\s*\{([^}]+)\}/gm;
const IMPORT_RE = /import\s+(?:type\s+)?(?:[\w*\s{},]+)\s+from\s+["']([^"']+)["']/g;
const NAMED_IMPORT_RE = /import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g;
const DYNAMIC_IMPORT_BINDING_RE = /const\s+(\w+)\s*=\s*await\s+import\(\s*["']([^"']+)["']\s*\)/g;

function normalizePath(path) {
  return normalize(path).replace(/\\/g, "/");
}

export function parsePathListBuffer(buffer) {
  const text = String(buffer || "");
  if (text.length === 0) return [];
  if (text.includes("\0")) {
    return text.split("\0").map((entry) => entry.trim()).filter(Boolean);
  }
  return text.split(/\r?\n/g).map((entry) => entry.trim()).filter(Boolean);
}

function walkFiles(root, files = []) {
  if (!existsSync(root)) return files;
  const stats = statSync(root);
  if (!stats.isDirectory()) return files;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, files);
      continue;
    }
    files.push(normalizePath(full));
  }
  return files;
}

function isSourceFile(path) {
  return SOURCE_EXTENSIONS.includes(extname(path));
}

function isTestFile(path, testPattern) {
  return testPattern.test(path);
}

export function parseExports(content) {
  const names = new Set();

  for (const match of content.matchAll(EXPORT_DECL_RE)) {
    names.add(match[1]);
  }

  for (const match of content.matchAll(EXPORT_NAMED_RE)) {
    const rawNames = match[1].split(",");
    for (const rawName of rawNames) {
      const candidate = rawName.trim();
      if (!candidate) continue;
      if (candidate.startsWith("type ")) continue;
      const [left] = candidate.split(/\s+as\s+/);
      if (left) names.add(left.trim());
    }
  }

  return [...names].sort((left, right) => left.localeCompare(right, "en"));
}

function resolveImportTarget(importerFile, specifier) {
  if (!specifier.startsWith(".")) return null;
  const importerDir = dirname(importerFile);
  const base = resolve(importerDir, specifier);
  const ext = extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  const candidates = [
    base,
    stem,
    ...SOURCE_EXTENSIONS.map((ext) => `${base}${ext}`),
    ...SOURCE_EXTENSIONS.map((extension) => `${stem}${extension}`),
    ...SOURCE_EXTENSIONS.map((ext) => join(base, `index${ext}`)),
    ...SOURCE_EXTENSIONS.map((extension) => join(stem, `index${extension}`)),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return normalizePath(candidate);
    }
  }
  return null;
}

function parseImportCoverage(content, importerFile) {
  const imported = [];

  for (const match of content.matchAll(NAMED_IMPORT_RE)) {
    const specifier = match[2];
    const target = resolveImportTarget(importerFile, specifier);
    if (!target) continue;
    const names = match[1]
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => value.split(/\s+as\s+/)[0]?.trim())
      .filter(Boolean);
    for (const name of names) {
      imported.push({ target, name });
    }
  }

  for (const match of content.matchAll(IMPORT_RE)) {
    const specifier = match[1];
    const target = resolveImportTarget(importerFile, specifier);
    if (!target) continue;
    const sourceClause = match[0].slice("import".length, match[0].indexOf("from")).trim();
    if (sourceClause.startsWith("{") || sourceClause.startsWith("type {")) continue;
    const defaultBinding = sourceClause.split(",")[0]?.trim();
    if (defaultBinding && !defaultBinding.startsWith("*")) {
      imported.push({ target, name: "default" });
    }
  }

  for (const match of content.matchAll(DYNAMIC_IMPORT_BINDING_RE)) {
    const binding = match[1];
    const specifier = match[2];
    const target = resolveImportTarget(importerFile, specifier);
    if (!target) continue;
    const memberRe = new RegExp(`\\b${binding}\\.([A-Za-z_$][\\w$]*)\\b`, "g");
    for (const memberMatch of content.matchAll(memberRe)) {
      imported.push({ target, name: memberMatch[1] });
    }
  }

  return imported;
}

function analyzeWorkspaceSurface(surface, { sourceScope = [] } = {}) {
  const files = walkFiles(surface.srcDir).filter(isSourceFile).sort();
  const sourceFileScope = new Set((Array.isArray(sourceScope) ? sourceScope : []).map((file) => normalizePath(file)));
  const sourceFiles = files.filter((file) =>
    !isTestFile(file, surface.testFilePattern)
    && !/^index\./.test(basename(file))
    && (sourceFileScope.size === 0 || sourceFileScope.has(normalizePath(file)))
  );
  const testFiles = files.filter((file) => isTestFile(file, surface.testFilePattern));

  const exports = [];
  const coverageSet = new Set();

  for (const file of sourceFiles) {
    const content = readFileSync(file, "utf8");
    const names = parseExports(content);
    const relSource = normalizePath(relative(surface.workspaceRoot, file));
    for (const name of names) {
      exports.push({ source: relSource, export: name, absSource: file });
    }
  }

  for (const file of testFiles) {
    const content = readFileSync(file, "utf8");
    const imports = parseImportCoverage(content, file);
    for (const entry of imports) {
      if (!entry.target.startsWith(normalizePath(resolve(surface.srcDir)))) continue;
      const relSource = normalizePath(relative(surface.workspaceRoot, entry.target));
      coverageSet.add(`${relSource}::${entry.name}`);
    }
  }

  const uncovered = exports
    .filter((entry) => !coverageSet.has(`${entry.source}::${entry.export}`))
    .map(({ source, export: exported }) => ({ source, export: exported }));

  return {
    id: surface.id,
    label: surface.label,
    total_exports: exports.length,
    covered_exports: exports.length - uncovered.length,
    uncovered,
  };
}

export function analyzeWorkspaceExportCoverage({
  manifest = WORKSPACE_EXPORT_COVERAGE_MANIFEST,
  sourceScopeByWorkspaceId = {},
} = {}) {
  const workspaces = manifest.map((surface) =>
    analyzeWorkspaceSurface(surface, {
      sourceScope: sourceScopeByWorkspaceId?.[surface.id] || [],
    }),
  );
  const totalExports = workspaces.reduce((sum, workspace) => sum + workspace.total_exports, 0);
  const totalCovered = workspaces.reduce((sum, workspace) => sum + workspace.covered_exports, 0);
  const totalUncovered = workspaces.reduce((sum, workspace) => sum + workspace.uncovered.length, 0);
  return {
    workspaces,
    total_exports: totalExports,
    total_covered: totalCovered,
    total_uncovered: totalUncovered,
  };
}

export function classifyWorkspaceGapPriority(workspaceId, sourcePath, priorityManifest = WORKSPACE_EXPORT_PRIORITY_MANIFEST) {
  const priorities = priorityManifest[workspaceId] || {};
  const normalizedSource = normalizePath(sourcePath);
  if ((priorities.critical || []).includes(normalizedSource)) return "critical";
  if ((priorities.high || []).includes(normalizedSource)) return "high";
  return "standard";
}

export function summarizeWorkspaceGapPriorities(workspaceId, gaps = [], priorityManifest = WORKSPACE_EXPORT_PRIORITY_MANIFEST) {
  const summary = { critical: 0, high: 0, standard: 0 };
  for (const gap of gaps) {
    const priority = classifyWorkspaceGapPriority(workspaceId, gap?.source || "", priorityManifest);
    summary[priority] += 1;
  }
  return summary;
}

function loadBaseline(path = DEFAULT_BASELINE_PATH) {
  if (!existsSync(path)) {
    return {
      schema: "workspace_export_coverage_baseline/v1",
      workspaces: [],
    };
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

export function compareWorkspaceBaseline(result, baseline) {
  const baselineByWorkspace = new Map(
    (baseline.workspaces || []).map((workspace) => [
      workspace.id,
      new Set((workspace.gaps || []).map((entry) => `${entry.source}::${entry.export}`)),
    ]),
  );

  const comparisons = result.workspaces.map((workspace) => {
    const baselineSet = baselineByWorkspace.get(workspace.id) || new Set();
    const currentSet = new Set(workspace.uncovered.map((entry) => `${entry.source}::${entry.export}`));
    const newGaps = workspace.uncovered.filter((entry) => !baselineSet.has(`${entry.source}::${entry.export}`));
    const closedGaps = [...baselineSet]
      .filter((key) => !currentSet.has(key))
      .map((key) => {
        const [source, exported] = key.split("::");
        return { source, export: exported };
      });
    return {
      id: workspace.id,
      label: workspace.label,
      total_exports: workspace.total_exports,
      covered_exports: workspace.covered_exports,
      uncovered: workspace.uncovered,
      baseline_gaps: baselineSet.size,
      new_gaps: newGaps,
      closed_gaps: closedGaps,
      priority_buckets: summarizeWorkspaceGapPriorities(workspace.id, workspace.uncovered),
      new_gap_priority_buckets: summarizeWorkspaceGapPriorities(workspace.id, newGaps),
    };
  });

  return {
    workspaces: comparisons,
    new_gap_count: comparisons.reduce((sum, workspace) => sum + workspace.new_gaps.length, 0),
  };
}

export function hasPriorityDebt(comparison) {
  return comparison.workspaces.some((workspace) =>
    (workspace.priority_buckets?.critical || 0) > 0 || (workspace.priority_buckets?.high || 0) > 0
  );
}

export function writeWorkspaceCoverageBaseline(path, result) {
  const payload = {
    schema: "workspace_export_coverage_baseline/v1",
    generated: new Date().toISOString(),
    description: "Known uncovered exports for critical workspaces. Debt can only decrease, never increase.",
    workspaces: result.workspaces.map((workspace) => ({
      id: workspace.id,
      label: workspace.label,
      gaps: workspace.uncovered,
    })),
  };
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}

function argValue(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) return "";
  return args[index + 1] || "";
}

export function resolveWorkspaceExportCoverageScope({
  stagedPaths = [],
  manifest = WORKSPACE_EXPORT_COVERAGE_MANIFEST,
} = {}) {
  const normalizedPaths = [...new Set((Array.isArray(stagedPaths) ? stagedPaths : []).map((path) => normalizePath(path)).filter(Boolean))];
  const sourceScopeByWorkspaceId = {};

  for (const surface of manifest) {
    const workspaceRoot = normalizePath(surface.workspaceRoot);
    const srcDir = normalizePath(surface.srcDir);
    const workspacePaths = normalizedPaths.filter((path) => path.startsWith(`${workspaceRoot}/`) || path === workspaceRoot);
    if (workspacePaths.length === 0) {
      continue;
    }

    const stagedTests = workspacePaths.filter((path) => isTestFile(path, surface.testFilePattern));
    const stagedSources = workspacePaths.filter((path) =>
      path.startsWith(`${srcDir}/`)
      && isSourceFile(path)
      && !isTestFile(path, surface.testFilePattern)
      && !/^index\./.test(basename(path))
    );

    if (stagedTests.length > 0 || stagedSources.length === 0) {
      sourceScopeByWorkspaceId[surface.id] = [];
      continue;
    }

    sourceScopeByWorkspaceId[surface.id] = stagedSources.map((path) => resolve(path));
  }

  return { sourceScopeByWorkspaceId };
}

function readStagedPaths(stagedFileListPath = "") {
  if (!stagedFileListPath) {
    return [];
  }
  return parsePathListBuffer(readFileSync(stagedFileListPath, "utf8"));
}

async function main() {
  const args = process.argv.slice(2);
  const baselinePath = argValue(args, "--baseline") || DEFAULT_BASELINE_PATH;
  const updateBaseline = args.includes("--update-baseline");
  const jsonOutput = args.includes("--json");
  const stagedFileListPath = argValue(args, "--staged-file-list");
  const scope = resolveWorkspaceExportCoverageScope({
    stagedPaths: readStagedPaths(stagedFileListPath),
  });

  const result = analyzeWorkspaceExportCoverage({
    sourceScopeByWorkspaceId: scope.sourceScopeByWorkspaceId,
  });

  if (updateBaseline) {
    writeWorkspaceCoverageBaseline(baselinePath, result);
    console.log(`[workspace-export-coverage] baseline_updated path=${baselinePath} workspaces=${result.workspaces.length} uncovered=${result.total_uncovered}`);
    return;
  }

  const baseline = loadBaseline(baselinePath);
  const comparison = compareWorkspaceBaseline(result, baseline);
  const hasNewGaps = comparison.new_gap_count > 0;
  const hasPriorityDebtViolation = hasPriorityDebt(comparison);

  if (jsonOutput) {
    console.log(JSON.stringify({
      ...result,
      comparison,
      priority_debt_violation: hasPriorityDebtViolation,
      scope: scope.sourceScopeByWorkspaceId,
    }, null, 2));
    process.exit(hasNewGaps || hasPriorityDebtViolation ? 1 : 0);
  }

  for (const workspace of comparison.workspaces) {
    console.log(
      `Workspace export coverage ${workspace.label}: ${workspace.covered_exports}/${workspace.total_exports} covered, ${workspace.uncovered.length} uncovered (baseline: ${workspace.baseline_gaps})`,
    );
    console.log(
      `Workspace export priorities ${workspace.label}: critical=${workspace.priority_buckets.critical} high=${workspace.priority_buckets.high} standard=${workspace.priority_buckets.standard}`,
    );
    if (workspace.new_gaps.length > 0) {
      console.log(
        `Workspace export new-gap priorities ${workspace.label}: critical=${workspace.new_gap_priority_buckets.critical} high=${workspace.new_gap_priority_buckets.high} standard=${workspace.new_gap_priority_buckets.standard}`,
      );
      for (const gap of workspace.new_gaps) {
        console.error(
          `[workspace-export-coverage] new_gap workspace=${workspace.id} source=${JSON.stringify(gap.source)} export=${JSON.stringify(gap.export)}`,
        );
      }
    }
    if ((workspace.priority_buckets.critical || 0) > 0 || (workspace.priority_buckets.high || 0) > 0) {
      console.error(
        `[workspace-export-coverage] priority_debt workspace=${workspace.id} critical=${workspace.priority_buckets.critical} high=${workspace.priority_buckets.high}`,
      );
    }
  }

  console.log(
    `[workspace-export-coverage] result=${hasNewGaps || hasPriorityDebtViolation ? "fail" : "ok"} total=${result.total_exports} covered=${result.total_covered} uncovered=${result.total_uncovered} new_gaps=${comparison.new_gap_count} priority_debt_violation=${hasPriorityDebtViolation ? 1 : 0}`,
  );
  process.exit(hasNewGaps || hasPriorityDebtViolation ? 1 : 0);
}

const isDirectRun = basename(process.argv[1] || "") === "check-workspace-export-coverage.mjs";
if (isDirectRun) {
  main().catch((error) => {
    console.error(`[workspace-export-coverage] error=${JSON.stringify(String(error?.message || error))}`);
    process.exit(1);
  });
}
