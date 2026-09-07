import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  parseExports,
  parseImportsFromCommands,
  analyzeCoverage,
  compareBaseline,
  compareBehavioralBaseline,
  compareSideEffectBaseline,
  exportRequiresBehavioralCoverage,
  fileAssertsDurableSideEffects,
  isBehavioralCoverageFile,
  normalizeCoverageSourceFile,
  resolveExportCoverageScope,
  sliceExportSource,
} from "./check-export-coverage.ts";

// ---------------------------------------------------------------------------
// parseExports
// ---------------------------------------------------------------------------

test("parseExports extracts exported functions", () => {
  const content = `
function internal() {}
export function foo() {}
export function bar(a, b) {}
`;
  assert.deepEqual(parseExports(content), ["foo", "bar"]);
});

test("parseExports extracts exported const", () => {
  const content = `
const internal = 1;
export const FOO = "hello";
export const bar = (x) => x + 1;
`;
  assert.deepEqual(parseExports(content), ["FOO", "bar"]);
});

test("parseExports extracts mixed export types", () => {
  const content = `
export function compute() {}
export const CONSTANT = 42;
export let mutable = null;
export class MyClass {}
function helper() {}
`;
  assert.deepEqual(parseExports(content), ["compute", "CONSTANT", "mutable", "MyClass"]);
});

test("parseExports extracts async exported functions", () => {
  const content = `
export async function ingestArtifactIssues() {}
export async function reconcileGoalFinalState() {}
`;
  assert.deepEqual(parseExports(content), ["ingestArtifactIssues", "reconcileGoalFinalState"]);
});

test("parseExports handles empty file", () => {
  assert.deepEqual(parseExports(""), []);
});

test("normalizeCoverageSourceFile keeps baseline keys stable across ts migration", () => {
  assert.equal(normalizeCoverageSourceFile("goal-run-state.ts"), "goal-run-state.mjs");
  assert.equal(normalizeCoverageSourceFile("goal-run-state.mjs"), "goal-run-state.mjs");
});

// ---------------------------------------------------------------------------
// parseImportsFromCommands
// ---------------------------------------------------------------------------

test("parseImportsFromCommands extracts single import", () => {
  const content = `import { foo } from "../src/commands/bar.mjs";`;
  assert.deepEqual(parseImportsFromCommands(content), [
    { name: "foo", sourceFile: "bar.mjs" },
  ]);
});

test("parseImportsFromCommands extracts .ts import paths", () => {
  const content = `import { foo } from "../../src/commands/bar.ts";`;
  assert.deepEqual(parseImportsFromCommands(content), [
    { name: "foo", sourceFile: "bar.ts" },
  ]);
});

test("parseImportsFromCommands extracts multi-import line", () => {
  const content = `import { a, b, c } from "../src/commands/file.mjs";`;
  const result = parseImportsFromCommands(content);
  assert.equal(result.length, 3);
  assert.deepEqual(result.map((r) => r.name), ["a", "b", "c"]);
  assert.ok(result.every((r) => r.sourceFile === "file.mjs"));
});

test("parseImportsFromCommands handles 'as' aliases", () => {
  const content = `import { foo as bar } from "../src/commands/baz.mjs";`;
  const result = parseImportsFromCommands(content);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "foo");
  assert.equal(result[0].sourceFile, "baz.mjs");
});

test("parseImportsFromCommands ignores non-commands imports", () => {
  const content = `
import { readFileSync } from "node:fs";
import { helper } from "../src/lib/util.mjs";
import { foo } from "../src/commands/bar.mjs";
`;
  const result = parseImportsFromCommands(content);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "foo");
});

test("parseImportsFromCommands handles multiline imports", () => {
  // Multiline imports within braces still captured since regex is global
  const content = `import {
  alpha,
  beta,
  gamma
} from "../src/commands/greek.mjs";`;
  const result = parseImportsFromCommands(content);
  assert.equal(result.length, 3);
  assert.deepEqual(result.map((r) => r.name), ["alpha", "beta", "gamma"]);
});

test("isBehavioralCoverageFile excludes contract tests", () => {
  assert.equal(isBehavioralCoverageFile("alpha.test.mjs"), true);
  assert.equal(isBehavioralCoverageFile("alpha.contract.test.mjs"), false);
});

test("exportRequiresBehavioralCoverage detects mutating exports", () => {
  const content = `
export function mutateThing() {
  return gh(["issue", "edit", "1", "--repo", "x/y"]);
}
export function describeThing() {
  return "noop";
}
`;
  assert.equal(exportRequiresBehavioralCoverage(content, "mutateThing"), true);
  assert.equal(exportRequiresBehavioralCoverage(content, "describeThing"), false);
});

test("sliceExportSource isolates a single export body", () => {
  const content = `
export function describeThing() {
  return "noop";
}

export function mutateThing() {
  return gh(["issue", "edit", "1", "--repo", "x/y"]);
}
`;
  assert.match(sliceExportSource(content, "describeThing"), /return "noop"/);
  assert.doesNotMatch(sliceExportSource(content, "describeThing"), /issue",\s*"edit"/);
  assert.match(sliceExportSource(content, "mutateThing"), /issue",\s*"edit"/);
});

test("exportRequiresBehavioralCoverage does not bleed into later mutating exports", () => {
  const content = `
export function stableStringify(value) {
  return JSON.stringify(value);
}

export function writeTickArtifact() {
  writeFileSync("tick.json", "{}");
}
`;
  assert.equal(exportRequiresBehavioralCoverage(content, "stableStringify"), false);
  assert.equal(exportRequiresBehavioralCoverage(content, "writeTickArtifact"), true);
});

test("sliceExportSource stops at the exported declaration and excludes private helpers below it", () => {
  const content = `
export function buildMergeFailureComments() {
  return [];
}

function ensureFollowupIssue() {
  return gh(["issue", "create", "--repo", "x/y"]);
}

export function commentMergeFailures() {
  return [];
}
`;

  const slice = sliceExportSource(content, "buildMergeFailureComments");
  assert.match(slice, /buildMergeFailureComments/);
  assert.doesNotMatch(slice, /ensureFollowupIssue/);
  assert.equal(
    exportRequiresBehavioralCoverage(content, "buildMergeFailureComments"),
    true,
    "mutation classification intentionally uses a wider export window so delegated private helpers still count as mutating behavior",
  );
});

test("fileAssertsDurableSideEffects distinguishes shallow imports from durable assertions", () => {
  assert.equal(
    fileAssertsDurableSideEffects('import { mutateThing } from "../src/commands/mutator.mjs";\nvoid mutateThing;\n'),
    false,
  );
  assert.equal(
    fileAssertsDurableSideEffects('const calls = [["issue", "edit", "1"]];\nassert.deepEqual(calls[0], ["issue", "edit", "1"]);'),
    true,
  );
  assert.equal(
    fileAssertsDurableSideEffects('const out = JSON.parse(run.stdout);\nassert.equal(out.ok, true);\n'),
    true,
  );
});

// ---------------------------------------------------------------------------
// analyzeCoverage
// ---------------------------------------------------------------------------

test("analyzeCoverage identifies covered and uncovered exports", () => {
  const dir = mkdtempSync(join(tmpdir(), "cov-test-"));
  const srcDir = join(dir, "src");
  const testDir = join(dir, "test");
  mkdirSync(srcDir, { recursive: true });
  mkdirSync(testDir, { recursive: true });

  writeFileSync(join(srcDir, "alpha.mjs"), `export function foo() {}\nexport function bar() {}\n`);
  writeFileSync(join(testDir, "alpha.test.mjs"), `import { foo } from "../src/commands/alpha.mjs";\n`);

  const result = analyzeCoverage({ srcDir, testDir });
  assert.equal(result.sourceExports.length, 2);
  assert.equal(result.covered.length, 1);
  assert.equal(result.covered[0].name, "foo");
  assert.equal(result.uncovered.length, 1);
  assert.equal(result.uncovered[0].name, "bar");
  assert.equal(result.behavioralRequired.length, 0);
});

test("analyzeCoverage counts helper file imports as coverage", () => {
  const dir = mkdtempSync(join(tmpdir(), "cov-test-"));
  const srcDir = join(dir, "src");
  const testDir = join(dir, "test");
  mkdirSync(srcDir, { recursive: true });
  mkdirSync(testDir, { recursive: true });

  writeFileSync(join(srcDir, "beta.mjs"), `export function compute() {}\n`);
  // Not a .test.mjs file but a helper in the test dir
  writeFileSync(join(testDir, "helpers.mjs"), `import { compute } from "../src/commands/beta.mjs";\n`);

  const result = analyzeCoverage({ srcDir, testDir });
  assert.equal(result.covered.length, 1);
  assert.equal(result.uncovered.length, 0);
});

test("analyzeCoverage scopes source evaluation to changed command files while keeping full test coverage", () => {
  const dir = mkdtempSync(join(tmpdir(), "cov-test-"));
  const srcDir = join(dir, "src");
  const testDir = join(dir, "test");
  mkdirSync(srcDir, { recursive: true });
  mkdirSync(testDir, { recursive: true });

  writeFileSync(join(srcDir, "alpha.mjs"), `export function foo() {}\nexport function bar() {}\n`);
  writeFileSync(join(srcDir, "beta.mjs"), `export function baz() {}\n`);
  writeFileSync(join(testDir, "alpha.test.mjs"), `import { foo } from "../src/commands/alpha.mjs";\n`);
  writeFileSync(join(testDir, "beta.test.mjs"), `import { baz } from "../src/commands/beta.mjs";\n`);

  const result = analyzeCoverage({ srcDir, testDir, sourceFiles: ["alpha.mjs"] });
  assert.deepEqual(result.sourceExports.map((entry) => entry.source), ["alpha.mjs", "alpha.mjs"]);
  assert.deepEqual(result.covered.map((entry) => entry.name), ["foo"]);
  assert.deepEqual(result.uncovered.map((entry) => entry.name), ["bar"]);
});

test("resolveExportCoverageScope scopes source-only command edits and skips non-command-only test edits", () => {
  assert.deepEqual(
    resolveExportCoverageScope(["packages/factory-ops/src/commands/goal-run-state.ts"]),
    {
      mode: "scoped_sources",
      sourceFiles: ["goal-run-state.mjs"],
      stagedCommandPaths: ["packages/factory-ops/src/commands/goal-run-state.ts"],
      stagedTestPaths: [],
    },
  );

  assert.deepEqual(
    resolveExportCoverageScope(["packages/factory-ops/test/commands/goal-run-state.test.ts"]),
    {
      mode: "skip",
      sourceFiles: [],
      stagedCommandPaths: [],
      stagedTestPaths: ["packages/factory-ops/test/commands/goal-run-state.test.ts"],
    },
  );
});

test("compareBaseline treats ts source exports as matching mjs baseline entries", () => {
  const { newGaps, closedGaps } = compareBaseline(
    [{ source: "goal-run-state.mjs", name: "writeGoalRunState" }],
    {
      gaps: [{ source: "goal-run-state.mjs", export: "writeGoalRunState" }],
    },
  );

  assert.deepEqual(newGaps, []);
  assert.deepEqual(closedGaps, []);
});

test("analyzeCoverage normalizes ts command sources onto mjs baseline keys", () => {
  const dir = mkdtempSync(join(tmpdir(), "cov-test-"));
  const srcDir = join(dir, "src");
  const testDir = join(dir, "test");
  mkdirSync(srcDir, { recursive: true });
  mkdirSync(testDir, { recursive: true });

  writeFileSync(join(srcDir, "alpha.ts"), `export function foo() {}\nexport function bar() {}\n`);
  writeFileSync(join(testDir, "alpha.test.mjs"), `import { foo } from "../src/commands/alpha.mjs";\n`);

  const result = analyzeCoverage({ srcDir, testDir, sourceFiles: ["alpha.ts"] });
  assert.deepEqual(result.sourceExports.map((entry) => entry.source), ["alpha.mjs", "alpha.mjs"]);
  assert.deepEqual(result.covered, [{ source: "alpha.mjs", name: "foo" }]);
  assert.deepEqual(result.uncovered, [{ source: "alpha.mjs", name: "bar" }]);
});

test("analyzeCoverage handles no source exports", () => {
  const dir = mkdtempSync(join(tmpdir(), "cov-test-"));
  const srcDir = join(dir, "src");
  const testDir = join(dir, "test");
  mkdirSync(srcDir, { recursive: true });
  mkdirSync(testDir, { recursive: true });

  writeFileSync(join(srcDir, "empty.mjs"), `function internal() {}\n`);

  const result = analyzeCoverage({ srcDir, testDir });
  assert.equal(result.sourceExports.length, 0);
  assert.equal(result.covered.length, 0);
  assert.equal(result.uncovered.length, 0);
});

test("analyzeCoverage separates contract imports from behavioral coverage for mutating exports", () => {
  const dir = mkdtempSync(join(tmpdir(), "cov-test-"));
  const srcDir = join(dir, "src");
  const testDir = join(dir, "test");
  mkdirSync(srcDir, { recursive: true });
  mkdirSync(testDir, { recursive: true });

  writeFileSync(
    join(srcDir, "mutator.mjs"),
    `export function mutateThing() { return gh(["issue", "edit", "1", "--repo", "x/y"]); }\nexport function pureThing() { return 1; }\n`,
  );
  writeFileSync(
    join(testDir, "mutator.contract.test.mjs"),
    `import { mutateThing } from "../src/commands/mutator.mjs";\nvoid mutateThing;\n`,
  );
  writeFileSync(
    join(testDir, "mutator.test.mjs"),
    `import { pureThing } from "../src/commands/mutator.mjs";\nvoid pureThing;\n`,
  );

  const result = analyzeCoverage({ srcDir, testDir });
  assert.deepEqual(result.behavioralRequired, [{ source: "mutator.mjs", name: "mutateThing" }]);
  assert.deepEqual(result.behavioralCovered, []);
  assert.deepEqual(result.behavioralUncovered, [{ source: "mutator.mjs", name: "mutateThing" }]);
  assert.deepEqual(result.sideEffectCovered, []);
  assert.deepEqual(result.sideEffectUncovered, [{ source: "mutator.mjs", name: "mutateThing" }]);
});

test("analyzeCoverage treats shallow mutator imports as side-effect gaps until tests assert effects", () => {
  const dir = mkdtempSync(join(tmpdir(), "cov-test-"));
  const srcDir = join(dir, "src");
  const testDir = join(dir, "test");
  mkdirSync(srcDir, { recursive: true });
  mkdirSync(testDir, { recursive: true });

  writeFileSync(
    join(srcDir, "mutator.mjs"),
    `export function mutateThing() { return gh(["issue", "edit", "1", "--repo", "x/y"]); }\n`,
  );
  writeFileSync(
    join(testDir, "mutator.cli.test.mjs"),
    `import { mutateThing } from "../src/commands/mutator.mjs";\nvoid mutateThing;\n`,
  );

  let result = analyzeCoverage({ srcDir, testDir });
  assert.deepEqual(result.behavioralCovered, [{ source: "mutator.mjs", name: "mutateThing" }]);
  assert.deepEqual(result.sideEffectCovered, []);
  assert.deepEqual(result.sideEffectUncovered, [{ source: "mutator.mjs", name: "mutateThing" }]);

  writeFileSync(
    join(testDir, "mutator.cli.test.mjs"),
    `import { mutateThing } from "../src/commands/mutator.mjs";\nconst calls = [["issue", "edit", "1"]];\nassert.deepEqual(calls[0], ["issue", "edit", "1"]);\nvoid mutateThing;\n`,
  );

  result = analyzeCoverage({ srcDir, testDir });
  assert.deepEqual(result.sideEffectCovered, [{ source: "mutator.mjs", name: "mutateThing" }]);
  assert.deepEqual(result.sideEffectUncovered, []);
});

// ---------------------------------------------------------------------------
// compareBaseline
// ---------------------------------------------------------------------------

test("compareBaseline detects new gaps", () => {
  const uncovered = [
    { source: "a.mjs", name: "foo" },
    { source: "b.mjs", name: "bar" },
    { source: "c.mjs", name: "baz" },
  ];
  const baseline = {
    gaps: [
      { source: "a.mjs", export: "foo" },
      { source: "b.mjs", export: "bar" },
    ],
  };

  const { newGaps, closedGaps } = compareBaseline(uncovered, baseline);
  assert.equal(newGaps.length, 1);
  assert.equal(newGaps[0].source, "c.mjs");
  assert.equal(newGaps[0].name, "baz");
  assert.equal(closedGaps.length, 0);
});

test("compareBaseline detects closed gaps", () => {
  const uncovered = [
    { source: "a.mjs", name: "foo" },
  ];
  const baseline = {
    gaps: [
      { source: "a.mjs", export: "foo" },
      { source: "b.mjs", export: "bar" },
    ],
  };

  const { newGaps, closedGaps } = compareBaseline(uncovered, baseline);
  assert.equal(newGaps.length, 0);
  assert.equal(closedGaps.length, 1);
  assert.equal(closedGaps[0].source, "b.mjs");
  assert.equal(closedGaps[0].export, "bar");
});

test("compareBaseline reports ok when baseline matches", () => {
  const uncovered = [
    { source: "a.mjs", name: "foo" },
  ];
  const baseline = {
    gaps: [
      { source: "a.mjs", export: "foo" },
    ],
  };

  const { newGaps, closedGaps } = compareBaseline(uncovered, baseline);
  assert.equal(newGaps.length, 0);
  assert.equal(closedGaps.length, 0);
});

test("compareBaseline handles empty baseline", () => {
  const uncovered = [
    { source: "a.mjs", name: "foo" },
  ];
  const baseline = { gaps: [] };

  const { newGaps, closedGaps } = compareBaseline(uncovered, baseline);
  assert.equal(newGaps.length, 1);
  assert.equal(closedGaps.length, 0);
});

test("compareBaseline handles empty uncovered", () => {
  const uncovered = [];
  const baseline = {
    gaps: [{ source: "a.mjs", export: "foo" }],
  };

  const { newGaps, closedGaps } = compareBaseline(uncovered, baseline);
  assert.equal(newGaps.length, 0);
  assert.equal(closedGaps.length, 1);
});

test("compareBehavioralBaseline detects new and closed behavioral gaps", () => {
  const uncovered = [{ source: "a.mjs", name: "mutateThing" }];
  const baseline = {
    behavior_gaps: [
      { source: "a.mjs", export: "mutateThing" },
      { source: "b.mjs", export: "emitArtifact" },
    ],
  };

  const { newGaps, closedGaps } = compareBehavioralBaseline(uncovered, baseline);
  assert.equal(newGaps.length, 0);
  assert.deepEqual(closedGaps, [{ source: "b.mjs", export: "emitArtifact" }]);
});

test("compareSideEffectBaseline detects new and closed durable side-effect gaps", () => {
  const uncovered = [{ source: "a.mjs", name: "mutateThing" }];
  const baseline = {
    effect_gaps: [
      { source: "a.mjs", export: "mutateThing" },
      { source: "b.mjs", export: "emitArtifact" },
    ],
  };

  const { newGaps, closedGaps } = compareSideEffectBaseline(uncovered, baseline);
  assert.equal(newGaps.length, 0);
  assert.deepEqual(closedGaps, [{ source: "b.mjs", export: "emitArtifact" }]);
});
