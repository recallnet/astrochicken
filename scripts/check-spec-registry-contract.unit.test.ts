import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  parseArgs,
  validateSpecRegistry,
} from "./check-spec-registry-contract.ts";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const checkerPath = join(scriptsDir, "check-spec-registry-contract.mjs");
const repoRoot = resolve(scriptsDir, "..");

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

function createFixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), "spec-registry-contract-"));

  writeJson(join(dir, "config", "testing", "subsystem-ownership.json"), {
    schema: "hatch.subsystem-ownership.v1",
    scan_roots: [],
    owners: [
      {
        id: "factory_ops.supervisor",
        package: "@hatch/factory-ops",
        subsystem: "supervisor",
        description: "Supervisor subsystem.",
      },
    ],
    path_rules: [],
  });

  writeJson(join(dir, "config", "testing", "spec-registry.json"), {
    schema: "hatch.spec-registry.v1",
    required_owner_ids: ["factory_ops.supervisor"],
    specs: [
      {
        id: "factory-ops.supervisor.tick",
        title: "Supervisor Tick Orchestration Contract",
        owner_id: "factory_ops.supervisor",
        owner_package: "@hatch/factory-ops",
        subsystem: "supervisor",
        status: "active",
        path: "packages/factory-ops/specs/supervisor/supervisor-tick.md",
        authoritative_configs: [
          "config/testing/spec-registry.json",
          "config/testing/subsystem-ownership.json",
        ],
        test_surfaces: [
          {
            kind: "contract",
            path: "packages/factory-ops/test/supervisor/supervisor-tick.contract.test.ts",
          },
        ],
        merge_blockers: [
          "Keep spec and proof aligned.",
        ],
      },
    ],
  });

  writeText(
    join(dir, "packages", "factory-ops", "specs", "supervisor", "supervisor-tick.md"),
    `---
id: "factory-ops.supervisor.tick"
title: "Supervisor Tick Orchestration Contract"
owner_package: "@hatch/factory-ops"
subsystem: "supervisor"
status: "active"
---

# Supervisor Tick Orchestration Contract

## Scope

Spec scope.

## Inputs

- input

## Outputs

- output

## Required Invariants

- invariant

## Failure Modes

- failure

## Authoritative Configs

- \`config/testing/spec-registry.json\`
- \`config/testing/subsystem-ownership.json\`

## Test Surfaces

- \`packages/factory-ops/test/supervisor/supervisor-tick.contract.test.ts\`

## Merge Blockers

- blocker
`,
  );

  writeText(
    join(dir, "packages", "factory-ops", "test", "supervisor", "supervisor-tick.contract.test.mjs"),
    "import test from 'node:test';\n",
  );

  return dir;
}

test("parseArgs reads repo-root, registry, ownership, and json mode", () => {
  assert.deepEqual(parseArgs(["--repo-root", "/tmp/repo", "--registry", "specs.json", "--ownership", "owners.json", "--json"]), {
    repoRoot: "/tmp/repo",
    registryPath: "specs.json",
    ownershipPath: "owners.json",
    json: true,
  });
});

test("validateSpecRegistry accepts a valid canonical fixture", () => {
  const dir = createFixtureRepo();
  assert.deepEqual(validateSpecRegistry({ repoRoot: dir }), {
    ok: true,
    diagnostics: [],
    spec_count: 1,
    proof_surface_count: 1,
    owner_count: 1,
  });
});

test("validateSpecRegistry rejects missing coverage for required owners", () => {
  const dir = createFixtureRepo();
  writeJson(join(dir, "config", "testing", "subsystem-ownership.json"), {
    schema: "hatch.subsystem-ownership.v1",
    scan_roots: [],
    owners: [
      {
        id: "factory_ops.supervisor",
        package: "@hatch/factory-ops",
        subsystem: "supervisor",
        description: "Supervisor subsystem.",
      },
      {
        id: "factory_ops.scenarios",
        package: "@hatch/factory-ops",
        subsystem: "scenarios",
        description: "Scenario subsystem.",
      },
    ],
    path_rules: [],
  });
  writeJson(join(dir, "config", "testing", "spec-registry.json"), {
    schema: "hatch.spec-registry.v1",
    required_owner_ids: ["factory_ops.supervisor", "factory_ops.scenarios"],
    specs: [
      {
        id: "factory-ops.supervisor.tick",
        title: "Supervisor Tick Orchestration Contract",
        owner_id: "factory_ops.supervisor",
        owner_package: "@hatch/factory-ops",
        subsystem: "supervisor",
        status: "active",
        path: "packages/factory-ops/specs/supervisor/supervisor-tick.md",
        authoritative_configs: [
          "config/testing/spec-registry.json",
          "config/testing/subsystem-ownership.json",
        ],
        test_surfaces: [
          {
            kind: "contract",
            path: "packages/factory-ops/test/supervisor/supervisor-tick.contract.test.ts",
          },
        ],
        merge_blockers: [
          "Keep spec and proof aligned.",
        ],
      },
    ],
  });

  const result = validateSpecRegistry({ repoRoot: dir });
  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join("\n"), /missing spec coverage for required owner: factory_ops\.scenarios/);
});

test("validateSpecRegistry rejects a spec without proof surfaces", () => {
  const dir = createFixtureRepo();
  writeJson(join(dir, "config", "testing", "spec-registry.json"), {
    schema: "hatch.spec-registry.v1",
    specs: [
      {
        id: "factory-ops.supervisor.tick",
        title: "Supervisor Tick Orchestration Contract",
        owner_id: "factory_ops.supervisor",
        owner_package: "@hatch/factory-ops",
        subsystem: "supervisor",
        status: "active",
        path: "packages/factory-ops/specs/supervisor/supervisor-tick.md",
        authoritative_configs: ["config/testing/spec-registry.json"],
        test_surfaces: [],
        merge_blockers: ["blocker"],
      },
    ],
  });

  const result = validateSpecRegistry({ repoRoot: dir });
  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join("\n"), /test_surfaces must be a non-empty array/);
});

test("validateSpecRegistry rejects unknown owner references", () => {
  const dir = createFixtureRepo();
  writeJson(join(dir, "config", "testing", "spec-registry.json"), {
    schema: "hatch.spec-registry.v1",
    specs: [
      {
        id: "factory-ops.supervisor.tick",
        title: "Supervisor Tick Orchestration Contract",
        owner_id: "missing.owner",
        owner_package: "@hatch/factory-ops",
        subsystem: "supervisor",
        status: "active",
        path: "packages/factory-ops/specs/supervisor/supervisor-tick.md",
        authoritative_configs: ["config/testing/spec-registry.json"],
        test_surfaces: [{ kind: "contract", path: "packages/factory-ops/test/supervisor/supervisor-tick.contract.test.ts" }],
        merge_blockers: ["blocker"],
      },
    ],
  });

  const result = validateSpecRegistry({ repoRoot: dir });
  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join("\n"), /unknown owner/);
});

test("validateSpecRegistry rejects missing proof files", () => {
  const dir = createFixtureRepo();
  writeJson(join(dir, "config", "testing", "spec-registry.json"), {
    schema: "hatch.spec-registry.v1",
    specs: [
      {
        id: "factory-ops.supervisor.tick",
        title: "Supervisor Tick Orchestration Contract",
        owner_id: "factory_ops.supervisor",
        owner_package: "@hatch/factory-ops",
        subsystem: "supervisor",
        status: "active",
        path: "packages/factory-ops/specs/supervisor/supervisor-tick.md",
        authoritative_configs: ["config/testing/spec-registry.json"],
        test_surfaces: [{ kind: "contract", path: "packages/factory-ops/test/missing.contract.test.mjs" }],
        merge_blockers: ["blocker"],
      },
    ],
  });

  const result = validateSpecRegistry({ repoRoot: dir });
  assert.equal(result.ok, false);
  assert.match(result.diagnostics.join("\n"), /missing file: packages\/factory-ops\/test\/missing\.contract\.test\.mjs/);
});

test("CLI emits telemetry and json", () => {
  const dir = createFixtureRepo();
  const out = spawnSync("node", [checkerPath, "--repo-root", dir, "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /\[spec_registry_contract\] result=ok specs=1 proofs=1 owners=1 errors=0/);
  assert.match(out.stdout, /"ok":true/);
});
