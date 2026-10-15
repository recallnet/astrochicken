import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateManagedSupervisorShellContract } from "./check-managed-supervisor-shell-contract.ts";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const checkerPath = join(scriptsDir, "check-managed-supervisor-shell-contract.ts");
const fixturesRoot = join(scriptsDir, "test", "fixtures", "managed-supervisor-shell-contract");

function fixtureRoot(name) {
  return join(fixturesRoot, name);
}

test("validateManagedSupervisorShellContract accepts valid fixture", async () => {
  const result = await validateManagedSupervisorShellContract({ manifestsRoot: fixtureRoot("valid"), requireKinds: true });

  assert.equal(result.ok, true);
  assert.equal(result.kindCount, 1);
  assert.equal(result.shellRequired, true);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.telemetry, "[managed-supervisor-shell-contract] result=ok kind_count=1 shell_required=1");
});

test("validateManagedSupervisorShellContract accepts config-only managed factory using shared supervisor entry graph", async () => {
  const result = await validateManagedSupervisorShellContract({ manifestsRoot: fixtureRoot("valid-config-only-shared-entry"), requireKinds: true });

  assert.equal(result.ok, true);
  assert.equal(result.kindCount, 1);
  assert.equal(result.shellRequired, true);
  assert.deepEqual(result.diagnostics, []);
});


test("validateManagedSupervisorShellContract fails when managed supervisor tick graph misses shared shell delegation", async () => {
  const result = await validateManagedSupervisorShellContract({ manifestsRoot: fixtureRoot("invalid-missing-shared-shell-delegation"), requireKinds: true });

  assert.equal(result.ok, false);
  assert.equal(
    result.diagnostics.some((line) => line.includes("missing_shared_shell_delegation") && line.includes("kind=brainstorm") && line.includes("graph=factory_supervisor_tick.dot")),
    true,
  );
  assert.match(result.telemetry, /^\[managed-supervisor-shell-contract\] result=fail diagnostics=\d+ kind_count=1 shell_required=1$/);
});


test("validateManagedSupervisorShellContract fails when managed supervisor tick graph uses shell alias without canonical entry", async () => {
  const result = await validateManagedSupervisorShellContract({ manifestsRoot: fixtureRoot("invalid-shared-shell-alias-without-entry"), requireKinds: true });

  assert.equal(result.ok, false);
  assert.equal(
    result.diagnostics.some((line) => line.includes("missing_shared_shell_delegation") && line.includes("kind=brainstorm") && line.includes("expected_entry=managed_supervisor")),
    true,
  );
  assert.match(result.telemetry, /^\[managed-supervisor-shell-contract\] result=fail diagnostics=\d+ kind_count=1 shell_required=1$/);
});

test("validateManagedSupervisorShellContract fails when lifecycle node is missing", async () => {
  const result = await validateManagedSupervisorShellContract({ manifestsRoot: fixtureRoot("invalid-missing-lifecycle-node"), requireKinds: true });

  assert.equal(result.ok, false);
  assert.equal(result.diagnostics.some((line) => line.includes("missing_lifecycle_node") && line.includes("node=telemetry_emission")), true);
  assert.match(result.telemetry, /^\[managed-supervisor-shell-contract\] result=fail diagnostics=\d+ kind_count=1 shell_required=1$/);
});

test("validateManagedSupervisorShellContract fails when lifecycle enum values drift", async () => {
  const result = await validateManagedSupervisorShellContract({ manifestsRoot: fixtureRoot("invalid-enum-drift"), requireKinds: true });

  assert.equal(result.ok, false);
  assert.equal(result.diagnostics.some((line) => line.includes("enum_mismatch") && line.includes("expected=waiting_for_release,ready_to_resume,rejected_upstream,restart_failed") && line.includes("actual=waiting_for_release,ready_to_resume,rejected_upstream,halted")), true);
});

test("validateManagedSupervisorShellContract fails when kind does not reference shared shell", async () => {
  const result = await validateManagedSupervisorShellContract({ manifestsRoot: fixtureRoot("invalid-kind-shell-reference"), requireKinds: true });

  assert.equal(result.ok, false);
  assert.equal(result.diagnostics.some((line) => line.includes("shared_shell_mismatch") && line.includes("expected=packages/factory-runtime/workflows/managed-supervisor-shell/managed-supervisor-shell.workflow-source.mjs")), true);
});

test("CLI prints deterministic ok telemetry", () => {
  const run = spawnSync("node", [checkerPath, "--manifests", fixtureRoot("valid"), "--require-kinds"], {
    encoding: "utf8",
  });

  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), "[managed-supervisor-shell-contract] result=ok kind_count=1 shell_required=1");
  assert.equal(run.stderr.trim(), "");
});

test("CLI prints deterministic fail telemetry and diagnostics", () => {
  const run = spawnSync("node", [checkerPath, "--manifests", fixtureRoot("invalid-enum-drift"), "--require-kinds"], {
    encoding: "utf8",
  });

  assert.equal(run.status, 1);
  assert.match(run.stderr, /enum_mismatch file=.*supervisor-external-factory-lifecycle\.ts source=.*external-factory-control-state\.ts/);
  assert.match(run.stderr, /^.*\[managed-supervisor-shell-contract\] result=fail diagnostics=\d+ kind_count=1 shell_required=1\n?$/m);
});


test("CLI surfaces missing_shared_shell_delegation diagnostic", () => {
  const run = spawnSync("node", [checkerPath, "--manifests", fixtureRoot("invalid-missing-shared-shell-delegation"), "--require-kinds"], {
    encoding: "utf8",
  });

  assert.equal(run.status, 1);
  assert.match(run.stderr, /missing_shared_shell_delegation kind=brainstorm graph=factory_supervisor_tick\.dot/);
  assert.match(run.stderr, /^.*\[managed-supervisor-shell-contract\] result=fail diagnostics=\d+ kind_count=1 shell_required=1\n?$/m);
});


test("CLI surfaces missing_shared_shell_delegation when only shell alias path is used", () => {
  const run = spawnSync("node", [checkerPath, "--manifests", fixtureRoot("invalid-shared-shell-alias-without-entry"), "--require-kinds"], {
    encoding: "utf8",
  });

  assert.equal(run.status, 1);
  assert.match(run.stderr, /missing_shared_shell_delegation kind=brainstorm graph=factory_supervisor_tick\.dot/);
  assert.match(run.stderr, /expected_entry=managed_supervisor/);
  assert.match(run.stderr, /^.*\[managed-supervisor-shell-contract\] result=fail diagnostics=\d+ kind_count=1 shell_required=1\n?$/m);
});
