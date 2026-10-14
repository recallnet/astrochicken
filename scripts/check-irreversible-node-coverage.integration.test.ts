import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { analyzeIrreversibleNodeCoverage } from "./check-irreversible-node-coverage.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "..");
const scriptPath = join(repoRoot, "scripts", "check-irreversible-node-coverage.ts");

function write(root, relativePath, content) {
  const absolute = join(root, relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
  return absolute;
}

test("analyzeIrreversibleNodeCoverage accepts a fully covered manifest entry", () => {
  const root = mkdtempSync(join(tmpdir(), "irreversible-node-coverage-"));
  const graph = write(
    root,
    "graphs/test.dot",
    `digraph test { sample [type="tool" governance="irreversible" prompt="hatch-ops goal run --op sweep-completed"]; }`,
  );
  const command = write(root, "src/command.mjs", "export function sweepCompletedGoals() {}\n");
  const contract = write(
    root,
    "test/sample.contract.test.mjs",
    `const graph = "${graph}";\nconst marker = "hatch-ops goal run --op sweep-completed";\nvoid graph; void marker;\n`,
  );
  const exec = write(
    root,
    "test/sample.integration.test.mjs",
    `import { sweepCompletedGoals } from "${command}";\nvoid sweepCompletedGoals;\n`,
  );

  const out = analyzeIrreversibleNodeCoverage({
    manifest: [
      {
        graph,
        node: "sample",
        command_module: command,
        prompt_pattern: "hatch-ops goal run --op sweep-completed",
        contract_tests: [contract],
        executable_tests: [exec],
      },
    ],
    exclusions: [],
    graphInventory: [graph],
  });

  assert.equal(out.violations.length, 0);
});

test("analyzeIrreversibleNodeCoverage rejects missing executable coverage", () => {
  const root = mkdtempSync(join(tmpdir(), "irreversible-node-coverage-"));
  const graph = write(
    root,
    "graphs/test.dot",
    `digraph test { sample [type="tool" governance="irreversible" prompt="goal post-retry-comment"]; }`,
  );
  const command = write(root, "src/command.mjs", "export function postGoalRetryComment() {}\n");
  const contract = write(
    root,
    "test/sample.contract.test.mjs",
    `const graph = "${graph}";\nconst marker = "goal post-retry-comment";\nvoid graph; void marker;\n`,
  );

  const out = analyzeIrreversibleNodeCoverage({
    manifest: [
      {
        graph,
        node: "sample",
        command_module: command,
        prompt_pattern: "goal post-retry-comment",
        contract_tests: [contract],
        executable_tests: [],
      },
    ],
    exclusions: [],
    graphInventory: [graph],
  });

  assert.deepEqual(out.violations, [
    {
      graph,
      node: "sample",
      reason: "missing_executable_tests",
    },
  ]);
});

test("CLI passes on repository manifest", () => {
  const run = spawnSync("node", [scriptPath], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /\[irreversible-node-coverage\] result=ok/);
});

test("CLI accepts a manifest override", () => {
  const root = mkdtempSync(join(tmpdir(), "irreversible-node-coverage-cli-"));
  const graph = write(
    root,
    "graphs/test.dot",
    `digraph test { sample [type="tool" governance="irreversible" prompt="goal post-retry-comment"]; }`,
  );
  const command = write(root, "src/command.mjs", "export function postGoalRetryComment() {}\n");
  const contract = write(
    root,
    "test/sample.contract.test.mjs",
    `const graph = "${graph}";\nconst marker = "goal post-retry-comment";\nvoid graph; void marker;\n`,
  );
  const exec = write(
    root,
    "test/sample.integration.test.mjs",
    `import { postGoalRetryComment } from "${command}";\nvoid postGoalRetryComment;\n`,
  );
  const manifest = write(
    root,
    "manifest.mjs",
    `export const IRREVERSIBLE_NODE_COVERAGE_MANIFEST = ${JSON.stringify([
      {
        graph,
        node: "sample",
        command_module: command,
        prompt_pattern: "goal post-retry-comment",
        contract_tests: [contract],
        executable_tests: [exec],
      },
    ], null, 2)};\nexport const IRREVERSIBLE_NODE_COVERAGE_EXCLUSIONS = [];\nexport const IRREVERSIBLE_NODE_COVERAGE_GRAPH_INVENTORY = ${JSON.stringify([graph], null, 2)};\n`,
  );

  const run = spawnSync("node", [scriptPath, "--manifest", manifest], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /\[irreversible-node-coverage\] result=ok/);
});

test("analyzeIrreversibleNodeCoverage fails when an inventory node is neither covered nor excluded", () => {
  const root = mkdtempSync(join(tmpdir(), "irreversible-node-inventory-"));
  const graph = write(
    root,
    "graphs/test.dot",
    `digraph test { sample [type="tool" governance="irreversible" prompt="goal post-retry-comment"]; }`,
  );

  const out = analyzeIrreversibleNodeCoverage({
    manifest: [],
    exclusions: [],
    graphInventory: [graph],
  });

  assert.deepEqual(out.violations, [
    {
      graph,
      node: "sample",
      reason: "node_unaccounted_for",
    },
  ]);
});

test("analyzeIrreversibleNodeCoverage accepts excluded inventory nodes with reasons", () => {
  const root = mkdtempSync(join(tmpdir(), "irreversible-node-exclusion-"));
  const graph = write(
    root,
    "graphs/test.dot",
    `digraph test { sample [type="tool" governance="irreversible" prompt="goal post-retry-comment"]; }`,
  );

  const out = analyzeIrreversibleNodeCoverage({
    manifest: [],
    exclusions: [
      {
        graph,
        node: "sample",
        reason: "temporary exclusion while executable coverage is added",
      },
    ],
    graphInventory: [graph],
  });

  assert.equal(out.violations.length, 0);
});

test("analyzeIrreversibleNodeCoverage renders workflow source graph semantics before checking nodes", () => {
  const out = analyzeIrreversibleNodeCoverage({
    manifest: [
      {
        graph: "packages/capability-release-reporting/workflows/release_report_flow/release_report_flow.workflow-source.mjs",
        node: "publish_release_report",
        command_module: "packages/factory-ops/src/commands/release-publish-report.ts",
        prompt_pattern: "action_id=\"release.publish_report\"",
        contract_tests: [
          "packages/factory-ops/test/commands/release-publish-report.contract.test.ts",
          "packages/factory-ops/test/commands/prompt-golden-snapshot.contract.test.ts",
        ],
        executable_tests: [
          "packages/factory-ops/test/commands/release-publish-report.unit.test.ts",
        ],
      },
    ],
    exclusions: [],
    graphInventory: [],
  });

  assert.equal(out.violations.length, 0);
});

test("analyzeIrreversibleNodeCoverage does not require contract tests to mention workflow source paths", () => {
  const out = analyzeIrreversibleNodeCoverage({
    manifest: [
      {
        graph: "packages/capability-release-reporting/workflows/release_report_flow/release_report_flow.workflow-source.mjs",
        node: "publish_release_report",
        command_module: "packages/factory-ops/src/commands/release-publish-report.ts",
        prompt_pattern: "action_id=\"release.publish_report\"",
        contract_tests: [
          "packages/factory-ops/test/commands/release-publish-report.contract.test.ts",
        ],
        executable_tests: [
          "packages/factory-ops/test/commands/release-publish-report.unit.test.ts",
        ],
      },
    ],
    exclusions: [],
    graphInventory: [],
  });

  assert.equal(out.violations.length, 0);
});
