import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { buildWholeRepoQualityProof } from "./whole-repo-quality-proof.mjs";

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeFile(path, content = "export {};\n") {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function createFixtureRepo({ legacyNames = false, conflictingGuardAlias = false } = {}) {
  const repoRoot = mkdtempSync(join(tmpdir(), "whole-repo-quality-proof-"));

  writeJson(join(repoRoot, "config", "testing", "package-test-manifests", "apps-hatch.json"), {
    schema: "hatch.package-test-manifest.v1",
    package_name: "hatch",
    package_path: "apps/hatch",
    default_suite: "default",
    suites: [
      { name: "default", runner: "vitest", working_directory: "apps/hatch", entrypoints: ["src"], command: "vitest --run" },
      { name: legacyNames ? "test:guard-gates" : "guard-gates", runner: "vitest", working_directory: "apps/hatch", entrypoints: ["src"], command: "vitest --run" },
      ...(conflictingGuardAlias ? [{ name: "guard-gates", runner: "vitest", working_directory: "apps/hatch", entrypoints: ["src"], command: "vitest --run" }] : []),
    ],
  });
  writeJson(join(repoRoot, "config", "testing", "package-test-manifests", "packages-factory-ops.json"), {
    schema: "hatch.package-test-manifest.v1",
    package_name: "@hatch/factory-ops",
    package_path: "packages/factory-ops",
    default_suite: "default",
    suites: [
      { name: "default", runner: "node:test", working_directory: ".", entrypoints: ["packages/factory-ops/test"], command: "node --test" },
      { name: legacyNames ? "test:wave-claim-gates" : "wave-claim-gates", runner: "node:test", working_directory: ".", entrypoints: ["packages/factory-ops/test"], command: "node --test" },
    ],
  });
  writeJson(join(repoRoot, "config", "testing", "package-test-manifests", "packages-factory-telemetry.json"), {
    schema: "hatch.package-test-manifest.v1",
    package_name: "@recallnet/factory-telemetry",
    package_path: "packages/factory-telemetry",
    default_suite: "default",
    suites: [
      { name: "default", runner: "vitest", working_directory: "packages/factory-telemetry", entrypoints: ["src"], command: "vitest --run" },
    ],
  });

  writeJson(join(repoRoot, "config", "testing", "subsystem-ownership.json"), {
    schema: "hatch.subsystem-ownership.v1",
    owners: [
      { id: "hatch.runtime", package: "hatch", subsystem: "runtime", description: "runtime" },
      { id: "factory_ops.supervisor", package: "@hatch/factory-ops", subsystem: "supervisor", description: "supervisor" },
    ],
  });

  writeJson(join(repoRoot, "config", "testing", "spec-registry.json"), {
    schema: "hatch.spec-registry.v1",
    specs: [
      {
        id: "hatch.runtime.example",
        owner_id: "hatch.runtime",
        owner_package: "hatch",
        subsystem: "runtime",
        status: "active",
        path: "apps/hatch/specs/runtime/example.md",
        test_surfaces: [
          { kind: "contract", path: "apps/hatch/src/pipeline/runtime/example.contract.test.ts" },
        ],
      },
      {
        id: "factory-ops.supervisor.example",
        owner_id: "factory_ops.supervisor",
        owner_package: "@hatch/factory-ops",
        subsystem: "supervisor",
        status: "active",
        path: "packages/factory-ops/specs/supervisor/example.md",
        test_surfaces: [
          { kind: "contract", path: "packages/factory-ops/test/supervisor/example.contract.test.mjs" },
        ],
      },
    ],
  });

  writeFile(join(repoRoot, "apps", "hatch", "specs", "runtime", "example.md"), "# Example\n");
  writeFile(join(repoRoot, "packages", "factory-ops", "specs", "supervisor", "example.md"), "# Example\n");
  writeFile(join(repoRoot, "apps", "hatch", "src", "pipeline", "runtime", "example.contract.test.ts"));
  writeFile(join(repoRoot, "packages", "factory-ops", "test", "supervisor", "example.contract.test.mjs"));

  return repoRoot;
}

test("buildWholeRepoQualityProof groups specs and subsystems by executed suite coverage", () => {
  const repoRoot = createFixtureRepo();
  const result = buildWholeRepoQualityProof({
    repoRoot,
    executedGateIds: ["build", "dead_code", "duplication_scan", "typecheck"],
    executedSuiteNames: ["test:guard-gates", "test:wave-claim-gates"],
  });

  assert.equal(result.ok, true, result.diagnostics.join("\n"));
  assert.deepEqual(result.executedSuiteNames, ["test:guard-gates", "test:wave-claim-gates"]);
  assert.equal(result.specs.length, 2);
  assert.deepEqual(result.specs.map((entry) => [entry.id, entry.provingSuites]), [
    ["factory-ops.supervisor.example", ["test:wave-claim-gates"]],
    ["hatch.runtime.example", ["test:guard-gates"]],
  ]);
  assert.deepEqual(result.subsystems.map((entry) => entry.subsystem), ["runtime", "supervisor"]);
});

test("buildWholeRepoQualityProof fails closed when a spec surface is not covered by an executed suite", () => {
  const repoRoot = createFixtureRepo();
  const result = buildWholeRepoQualityProof({
    repoRoot,
    executedGateIds: ["build"],
    executedSuiteNames: ["test:guard-gates"],
  });

  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join("\n"), /unproven test surface for spec factory-ops\.supervisor\.example/);
});


test("package-qualified default suites prove only the packages actually executed", () => {
  const repoRoot = createFixtureRepo();
  const hatchOnly = buildWholeRepoQualityProof({ repoRoot, executedSuiteNames: ["hatch#default"] });
  assert.equal(hatchOnly.ok, false);
  assert.deepEqual(hatchOnly.specs.find((spec) => spec.id === "hatch.runtime.example").provingSuites, ["hatch#default"]);
  assert.match(hatchOnly.diagnostics.join("\n"), /unproven test surface for spec factory-ops/);
  assert.deepEqual(hatchOnly.packages.find((pkg) => pkg.packageName === "@hatch/factory-ops").executedSuites, []);
  const both = buildWholeRepoQualityProof({ repoRoot, executedSuiteNames: ["hatch#default", "@hatch/factory-ops#default"] });
  assert.equal(both.ok, true, both.diagnostics.join("\n"));
});

test("ambiguous default and unknown suite identities fail closed", () => {
  const repoRoot = createFixtureRepo();
  for (const name of ["default", "test:not-declared", "hatch#not-declared"]) {
    const result = buildWholeRepoQualityProof({ repoRoot, executedSuiteNames: [name] });
    assert.equal(result.ok, false);
    assert.match(result.diagnostics.join("\n"), name === "default" ? /ambiguous executed suite/ : /executed suite is not declared/);
    assert.equal(result.specs.every((spec) => spec.provingSuites.length === 0), true);
  }
});

test("legacy prefixed manifest names remain valid aliases", () => {
  const result = buildWholeRepoQualityProof({ repoRoot: createFixtureRepo({ legacyNames: true }), executedSuiteNames: ["test:guard-gates", "test:wave-claim-gates"] });
  assert.equal(result.ok, true, result.diagnostics.join("\n"));
});


test("a root test alias cannot choose between conflicting legacy and canonical suites", () => {
  const result = buildWholeRepoQualityProof({ repoRoot: createFixtureRepo({ legacyNames: true, conflictingGuardAlias: true }), executedSuiteNames: ["test:guard-gates"] });
  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join("\n"), /ambiguous executed suite/);
  assert.equal(result.specs.every((spec) => spec.provingSuites.length === 0), true);
});
