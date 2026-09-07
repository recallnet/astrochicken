import assert from "node:assert/strict";
import test from "node:test";

import { classifyChangedPaths, resolvePackageTestPlan } from "./run-fast-tests.mjs";

const WORKSPACE_TARGETS = [
  { workspaceRoot: "apps/hatch", packageName: "hatch" },
  { workspaceRoot: "packages/capability-foreman", packageName: "@hatch/capability-foreman" },
  { workspaceRoot: "packages/factory-ops", packageName: "@hatch/factory-ops" },
];

test("classifyChangedPaths runs both suites when there are no local changes", () => {
  assert.deepEqual(classifyChangedPaths([], { workspaceTargets: WORKSPACE_TARGETS }), {
    changedPaths: [],
    hasChangedPaths: false,
    runPackageTests: true,
    packageTestMode: "all",
    packageTestFilters: [],
    runRepoTests: true,
  });
});

test("classifyChangedPaths routes script-only changes to repo tests only", () => {
  const result = classifyChangedPaths(["scripts/run-gates.mjs"], { workspaceTargets: WORKSPACE_TARGETS });
  assert.equal(result.runRepoTests, true);
  assert.equal(result.runPackageTests, false);
  assert.equal(result.packageTestMode, "skip");
});

test("classifyChangedPaths routes package source changes to package tests only", () => {
  const result = classifyChangedPaths(["packages/capability-foreman/src/host.ts"], { workspaceTargets: WORKSPACE_TARGETS });
  assert.equal(result.runRepoTests, false);
  assert.equal(result.runPackageTests, true);
  assert.equal(result.packageTestMode, "changed");
  assert.deepEqual(result.packageTestFilters, ["@hatch/capability-foreman"]);
});

test("classifyChangedPaths routes root command-model changes to both repo and package tests", () => {
  const result = classifyChangedPaths(["package.json"], { workspaceTargets: WORKSPACE_TARGETS });
  assert.equal(result.runRepoTests, true);
  assert.equal(result.runPackageTests, true);
  assert.equal(result.packageTestMode, "all");
  assert.deepEqual(result.packageTestFilters, []);
});

test("resolvePackageTestPlan scopes package tests to changed workspaces", () => {
  const plan = resolvePackageTestPlan([
    "apps/hatch/src/cli.ts",
    "packages/factory-ops/src/cli.ts",
    "packages/factory-ops/test/supervisor/daemon.unit.test.ts",
  ], WORKSPACE_TARGETS);

  assert.equal(plan.runPackageTests, true);
  assert.equal(plan.packageTestMode, "changed");
  assert.deepEqual(plan.packageTestFilters, ["hatch", "@hatch/factory-ops"]);
});

test("resolvePackageTestPlan escalates to full workspace coverage for root infra changes", () => {
  const plan = resolvePackageTestPlan(["pnpm-lock.yaml"], WORKSPACE_TARGETS);

  assert.equal(plan.runPackageTests, true);
  assert.equal(plan.packageTestMode, "all");
  assert.deepEqual(plan.packageTestFilters, []);
});
