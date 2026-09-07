import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  analyzeWorkspaceExportCoverage,
  classifyWorkspaceGapPriority,
  compareWorkspaceBaseline,
  hasPriorityDebt,
  parseExports,
  resolveWorkspaceExportCoverageScope,
  summarizeWorkspaceGapPriorities,
  writeWorkspaceCoverageBaseline,
} from "./check-workspace-export-coverage.mjs";

function write(root, relativePath, content) {
  const target = join(root, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  return target;
}

test("parseExports ignores type-only exports and retains runtime exports", () => {
  const names = parseExports(`
export interface IgnoreMe {}
export type IgnoreMeToo = string;
export function keepMe() {}
export const ALSO_KEEP = true;
export { keepMe as aliasKeep, type IgnoreMe };
`);

  assert.deepEqual(names, ["ALSO_KEEP", "keepMe"]);
});

test("analyzeWorkspaceExportCoverage counts relative test imports as coverage", () => {
  const root = mkdtempSync(join(tmpdir(), "workspace-export-coverage-"));
  write(root, "workspace-a/src/math.ts", "export function add(a, b) { return a + b; }\nexport const SUB = 1;\n");
  write(root, "workspace-a/src/math.test.ts", "import { add } from './math.js';\nvoid add;\n");

  const result = analyzeWorkspaceExportCoverage({
    manifest: [
      {
        id: "workspace_a",
        label: "workspace-a",
        workspaceRoot: join(root, "workspace-a"),
        srcDir: join(root, "workspace-a", "src"),
        testFilePattern: /\.test\.ts$/,
      },
    ],
  });

  assert.equal(result.total_exports, 2);
  assert.equal(result.total_covered, 1);
  assert.deepEqual(result.workspaces[0].uncovered, [
    { source: "src/math.ts", export: "SUB" },
  ]);
});

test("analyzeWorkspaceExportCoverage counts dynamic import member access as coverage", () => {
  const root = mkdtempSync(join(tmpdir(), "workspace-export-coverage-dynamic-"));
  write(root, "workspace-a/src/cli.ts", "export function helper() { return 1; }\nexport function uncovered() { return 2; }\n");
  write(root, "workspace-a/src/cli.integration.test.ts", "const cli = await import('./cli.js');\nvoid cli.helper();\n");

  const result = analyzeWorkspaceExportCoverage({
    manifest: [
      {
        id: "workspace_a",
        label: "workspace-a",
        workspaceRoot: join(root, "workspace-a"),
        srcDir: join(root, "workspace-a", "src"),
        testFilePattern: /\.test\.ts$/,
      },
    ],
  });

  assert.equal(result.total_exports, 2);
  assert.equal(result.total_covered, 1);
  assert.deepEqual(result.workspaces[0].uncovered, [
    { source: "src/cli.ts", export: "uncovered" },
  ]);
});

test("analyzeWorkspaceExportCoverage scopes source-only checks to changed files", () => {
  const root = mkdtempSync(join(tmpdir(), "workspace-export-coverage-scope-"));
  const alphaPath = write(root, "workspace-a/src/alpha.ts", "export function covered() { return 1; }\n");
  write(root, "workspace-a/src/beta.ts", "export function skipped() { return 2; }\n");
  write(root, "workspace-a/src/alpha.test.ts", "import { covered } from './alpha.js';\nvoid covered;\n");
  write(root, "workspace-a/src/beta.test.ts", "import { skipped } from './beta.js';\nvoid skipped;\n");

  const result = analyzeWorkspaceExportCoverage({
    manifest: [
      {
        id: "workspace_a",
        label: "workspace-a",
        workspaceRoot: join(root, "workspace-a"),
        srcDir: join(root, "workspace-a", "src"),
        testFilePattern: /\.test\.ts$/,
      },
    ],
    sourceScopeByWorkspaceId: {
      workspace_a: [alphaPath],
    },
  });

  assert.equal(result.total_exports, 1);
  assert.equal(result.total_uncovered, 0);
});

test("resolveWorkspaceExportCoverageScope scopes source edits and falls back to full workspace coverage for test edits", () => {
  const root = mkdtempSync(join(tmpdir(), "workspace-export-coverage-scope-manifest-"));
  const manifest = [
    {
      id: "workspace_a",
      label: "workspace-a",
      workspaceRoot: join(root, "workspace-a"),
      srcDir: join(root, "workspace-a", "src"),
      testFilePattern: /\.test\.ts$/,
    },
  ];

  const sourceScope = resolveWorkspaceExportCoverageScope({
    stagedPaths: [join(root, "workspace-a", "src", "alpha.ts")],
    manifest,
  });
  assert.deepEqual(sourceScope.sourceScopeByWorkspaceId, {
    workspace_a: [join(root, "workspace-a", "src", "alpha.ts")],
  });

  const testScope = resolveWorkspaceExportCoverageScope({
    stagedPaths: [join(root, "workspace-a", "src", "alpha.test.ts")],
    manifest,
  });
  assert.deepEqual(testScope.sourceScopeByWorkspaceId, {
    workspace_a: [],
  });
});

test("compareWorkspaceBaseline detects new and closed workspace gaps", () => {
  const result = {
    workspaces: [
      {
        id: "workspace_a",
        label: "workspace-a",
        total_exports: 2,
        covered_exports: 1,
        uncovered: [{ source: "src/math.ts", export: "SUB" }],
      },
    ],
  };
  const baseline = {
    workspaces: [
      {
        id: "workspace_a",
        gaps: [
          { source: "src/math.ts", export: "SUB" },
          { source: "src/old.ts", export: "oldFn" },
        ],
      },
    ],
  };

  const comparison = compareWorkspaceBaseline(result, baseline);

  assert.equal(comparison.new_gap_count, 0);
  assert.deepEqual(comparison.workspaces[0].closed_gaps, [
    { source: "src/old.ts", export: "oldFn" },
  ]);
});

test("writeWorkspaceCoverageBaseline writes deterministic workspace payload", () => {
  const root = mkdtempSync(join(tmpdir(), "workspace-export-baseline-"));
  const path = join(root, "baseline.json");
  writeWorkspaceCoverageBaseline(path, {
    workspaces: [
      {
        id: "workspace_a",
        label: "workspace-a",
        uncovered: [{ source: "src/math.ts", export: "SUB" }],
      },
    ],
  });

  const payload = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(payload.schema, "workspace_export_coverage_baseline/v1");
  assert.deepEqual(payload.workspaces, [
    {
      id: "workspace_a",
      label: "workspace-a",
      gaps: [{ source: "src/math.ts", export: "SUB" }],
    },
  ]);
});

test("classifyWorkspaceGapPriority marks critical, high, and standard workspace gaps", () => {
  assert.equal(classifyWorkspaceGapPriority("apps_hatch", "src/dispatch/loop.ts"), "critical");
  assert.equal(classifyWorkspaceGapPriority("apps_hatch", "src/help.ts"), "high");
  assert.equal(classifyWorkspaceGapPriority("apps_hatch", "src/other.ts"), "standard");
  assert.equal(classifyWorkspaceGapPriority("factory_telemetry", "src/emitter.ts"), "critical");
});

test("compareWorkspaceBaseline reports priority buckets for uncovered and new gaps", () => {
  const result = {
    workspaces: [
      {
        id: "apps_hatch",
        label: "apps/hatch",
        total_exports: 3,
        covered_exports: 0,
        uncovered: [
          { source: "src/dispatch/loop.ts", export: "runDispatchLoop" },
          { source: "src/help.ts", export: "printHelpTopic" },
          { source: "src/other.ts", export: "helper" },
        ],
      },
    ],
  };
  const baseline = {
    workspaces: [
      {
        id: "apps_hatch",
        gaps: [
          { source: "src/help.ts", export: "printHelpTopic" },
        ],
      },
    ],
  };

  const comparison = compareWorkspaceBaseline(result, baseline);
  assert.deepEqual(comparison.workspaces[0].priority_buckets, {
    critical: 1,
    high: 1,
    standard: 1,
  });
  assert.deepEqual(comparison.workspaces[0].new_gap_priority_buckets, {
    critical: 1,
    high: 0,
    standard: 1,
  });
});

test("summarizeWorkspaceGapPriorities counts gaps by bucket", () => {
  const summary = summarizeWorkspaceGapPriorities("factory_telemetry", [
    { source: "src/emitter.ts", export: "emitTelemetry" },
    { source: "src/schema.ts", export: "parseSchema" },
    { source: "src/misc.ts", export: "noop" },
  ]);
  assert.deepEqual(summary, {
    critical: 1,
    high: 1,
    standard: 1,
  });
});

test("hasPriorityDebt flags remaining critical or high uncovered exports", () => {
  assert.equal(hasPriorityDebt({
    workspaces: [
      {
        priority_buckets: { critical: 0, high: 0, standard: 2 },
      },
    ],
  }), false);

  assert.equal(hasPriorityDebt({
    workspaces: [
      {
        priority_buckets: { critical: 0, high: 1, standard: 0 },
      },
    ],
  }), true);
});
