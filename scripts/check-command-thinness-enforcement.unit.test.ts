import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { analyzeCommandThinnessEnforcement } from "./check-command-thinness-enforcement.ts";

test("command thinness enforcement ignores legacy command surfaces", () => {
  const result = analyzeCommandThinnessEnforcement({
    files: ["packages/factory-ops/src/cli/commands/other.ts"],
    manifest: {
      schema_version: "active_surface_manifest/v1",
      graph_families: [
        {
          id: "graphs",
          classification: "historical_or_test_only",
          include: ["scripts/test/fixtures/**/*.dot"],
        },
      ],
      runtime_surfaces: [
        {
          id: "runtime_tests",
          classification: "test_only",
          include: ["packages/**/*.test.mjs"],
        },
      ],
      command_surfaces: [
        {
          id: "legacy_cli",
          classification: "legacy_or_deletion_candidate",
          include: ["packages/factory-ops/src/cli/commands/**/*.mjs"],
        },
      ],
    },
    readFile() {
      return `${"x\n".repeat(900)}`;
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.violations, []);
});

test("command thinness enforcement ignores external/operator CLI files", () => {
  const result = analyzeCommandThinnessEnforcement({
    files: ["packages/factory-ops/src/cli/commands/release-delivery-cmds.ts"],
    manifest: {
      schema_version: "active_surface_manifest/v1",
      graph_families: [
        {
          id: "graphs",
          classification: "historical_or_test_only",
          include: ["scripts/test/fixtures/**/*.dot"],
        },
      ],
      runtime_surfaces: [
        {
          id: "runtime_tests",
          classification: "test_only",
          include: ["packages/**/*.test.mjs"],
        },
      ],
      command_surfaces: [
        {
          id: "operator_cli",
          classification: "external_operator_cli",
          include: ["packages/factory-ops/src/cli/commands/**/*.mjs"],
        },
      ],
    },
    readFile() {
      return `${"x\n".repeat(401)}`;
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.violations, []);
});

test("command thinness enforcement ignores operator support surfaces", () => {
  const result = analyzeCommandThinnessEnforcement({
    files: ["packages/factory-ops/src/commands/factory-subscribe.ts"],
    manifest: {
      schema_version: "active_surface_manifest/v1",
      graph_families: [
        {
          id: "graphs",
          classification: "historical_or_test_only",
          include: ["scripts/test/fixtures/**/*.dot"],
        },
      ],
      runtime_surfaces: [
        {
          id: "runtime_tests",
          classification: "test_only",
          include: ["packages/**/*.test.mjs"],
        },
      ],
      command_surfaces: [
        {
          id: "operator_support",
          classification: "operator_support_surface",
          include: ["packages/factory-ops/src/commands/factory-subscribe.ts"],
        },
      ],
    },
    readFile() {
      return `${"x\n".repeat(900)}`;
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.violations, []);
});

test("command thinness enforcement fails oversized active deterministic owner files", () => {
  const result = analyzeCommandThinnessEnforcement({
    files: ["packages/factory-ops/src/commands/release-build-report-context.ts"],
    manifest: {
      schema_version: "active_surface_manifest/v1",
      graph_families: [
        {
          id: "graphs",
          classification: "historical_or_test_only",
          include: ["scripts/test/fixtures/**/*.dot"],
        },
      ],
      runtime_surfaces: [
        {
          id: "runtime_tests",
          classification: "test_only",
          include: ["packages/**/*.test.mjs"],
        },
      ],
      command_surfaces: [
        {
          id: "owner_commands",
          classification: "active_deterministic_owner",
          include: ["packages/factory-ops/src/commands/release-build-report-context.ts"],
        },
      ],
    },
    readFile() {
      return `${"x\n".repeat(401)}`;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.violations[0]?.file, "packages/factory-ops/src/commands/release-build-report-context.ts");
});

test("command thinness enforcement CLI supports --all-tracked", () => {
  const repoDir = mkdtempSync(join(tmpdir(), "command-thinness-enforcement-all-tracked-"));
  mkdirSync(join(repoDir, "docs", "contracts"), { recursive: true });
  mkdirSync(join(repoDir, "packages", "factory-ops", "src", "commands"), { recursive: true });

  writeFileSync(join(repoDir, "packages", "factory-ops", "src", "commands", "sample.mjs"), `${"x\n".repeat(10)}`);
  writeFileSync(join(repoDir, "docs", "contracts", "active-surface-manifest.json"), JSON.stringify({
    schema_version: "active_surface_manifest/v1",
    graph_families: [
      {
        id: "historical_graphs",
        classification: "historical_or_test_only",
        include: ["graphs/**/*.dot"],
      },
    ],
    runtime_surfaces: [
      {
        id: "test_runtime",
        classification: "test_only",
        include: ["runtime/**/*.mjs"],
      },
    ],
    command_surfaces: [
      {
        id: "owner_commands",
        classification: "active_deterministic_owner",
        include: ["packages/factory-ops/src/commands/sample.mjs"],
      },
    ],
  }, null, 2));
  const gitInit = spawnSync("git", ["init"], { cwd: repoDir, encoding: "utf8" });
  assert.equal(gitInit.status, 0, gitInit.stderr || gitInit.stdout);
  const gitAdd = spawnSync("git", ["add", "."], { cwd: repoDir, encoding: "utf8" });
  assert.equal(gitAdd.status, 0, gitAdd.stderr || gitAdd.stdout);

  const scriptPath = join(process.cwd(), "scripts", "check-command-thinness-enforcement.mjs");
  const run = spawnSync("node", [scriptPath, "--all-tracked"], {
    cwd: repoDir,
    encoding: "utf8",
    env: process.env,
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /\[command-thinness-enforcement\] result=ok/);
});
