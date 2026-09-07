import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";

import {
  runFactoryControlAction,
  runFactoryControlStateRead,
} from "../../src/commands/factory-control-state.ts";
import { generateFactoryInstanceIdPayload } from "../../src/commands/factory-generate-instance-id.ts";
import { createCanonicalEventStoreFixture } from "./factory-status-postgres-fixture.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../..");
const opsCliPath = join(repoRoot, "packages/factory-ops/src/cli.ts");
const canonicalEventStore = createCanonicalEventStoreFixture();

before(async () => {
  await canonicalEventStore.setup();
});

after(() => {
  canonicalEventStore.teardown();
});

function runCli(args, { cwd, expectedStatus = 0 } = {}) {
  const proc = spawnSync("node", [opsCliPath, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      HATCH_CANONICAL_EVENT_STORE_URL: canonicalEventStore.connectionString,
    },
  });
  assert.equal(proc.status, expectedStatus, `stderr=${proc.stderr}\nstdout=${proc.stdout}`);
  const parsed = String(proc.stdout || "").trim();
  return {
    ...proc,
    payload: parsed ? JSON.parse(parsed) : {},
  };
}

test("factory control CLI mutation commands persist and expose state transitions", () => {
  const cwd = mkdtempSync(join(tmpdir(), "factory-control-cli-"));

  const paused = runCli([
    "factory", "pause",
    "--factory-id", "external-worker",
    "--reason", "scheduled maintenance",
  ], { cwd });
  assert.equal(paused.payload.ok, true);
  assert.equal(paused.payload.action, "pause");
  assert.equal(typeof paused.payload.state_version, "number");
  assert.equal(typeof paused.payload.state_path, "string");

  const controlState = runCli([
    "factory", "control-state",
    "--factory-id", "external-worker",
  ], { cwd });
  assert.equal(controlState.payload.factory_id, "external-worker");
  assert.equal(controlState.payload.action_state.pause.active, true);

  runCli([
    "factory", "quarantine",
    "--factory-id", "external-worker",
    "--reason", "cooldown after failures",
  ], { cwd });

  const invalidResume = runCli([
    "factory", "resume",
    "--factory-id", "external-worker",
    "--reason", "resume attempt",
  ], { cwd, expectedStatus: 1 });
  assert.equal(invalidResume.payload.ok, false);
  assert.equal(invalidResume.payload.error, "invalid_transition");
  assert.match(String(invalidResume.stderr || ""), /invalid_transition/);

  runCli([
    "factory", "unblock",
    "--factory-id", "external-worker",
    "--reason", "upstream condition changed",
  ], { cwd });

  const resumed = runCli([
    "factory", "resume",
    "--factory-id", "external-worker",
    "--reason", "restart dispatcher",
  ], { cwd });
  assert.equal(resumed.payload.ok, true);

  const retried = runCli([
    "factory", "retry",
    "--factory-id", "external-worker",
    "--reason", "retry failed run",
    "--retry-target", "run-42",
  ], { cwd });
  assert.equal(retried.payload.ok, true);

  const finalState = runCli([
    "factory", "control-state",
    "--factory-id", "external-worker",
  ], { cwd });
  assert.equal(finalState.payload.reason, "retry failed run");
  assert.equal(finalState.payload.retry_target, "run-42");
  assert.equal(finalState.payload.action_state.retry.active, true);
});

test("factory control CLI commands fail with exit 1 for missing required args", () => {
  const cwd = mkdtempSync(join(tmpdir(), "factory-control-cli-missing-"));

  const missingReason = runCli([
    "factory", "pause",
    "--factory-id", "ext-missing",
  ], { cwd, expectedStatus: 1 });
  assert.equal(missingReason.payload.ok, false);
  assert.equal(missingReason.payload.error, "missing_reason");

  const missingFactory = runCli([
    "factory", "control-state",
  ], { cwd, expectedStatus: 1 });
  assert.equal(missingFactory.payload.ok, false);
  assert.equal(missingFactory.payload.error, "missing_factory_id");
});

test("factory generate-instance-id command returns a valid fac_* id", () => {
  const cwd = mkdtempSync(join(tmpdir(), "factory-generate-instance-id-"));

  const out = runCli([
    "factory", "generate-instance-id",
  ], { cwd });
  assert.equal(out.payload.ok, true);
  assert.match(String(out.payload.instance_id || ""), /^fac_[0-9A-HJKMNP-TV-Z]{16}$/);
});

test("factory control-state command exports remain importable for coverage gate", () => {
  const actionOut = runFactoryControlAction({ action: "pause", factoryId: "", reason: "x" });
  assert.equal(actionOut.ok, false);
  assert.equal(actionOut.error, "missing_factory_id");

  const readOut = runFactoryControlStateRead({ factoryId: "" });
  assert.equal(readOut.ok, false);
  assert.equal(readOut.error, "missing_factory_id");

  const generated = generateFactoryInstanceIdPayload();
  assert.equal(generated.ok, true);
  assert.match(String(generated.instance_id || ""), /^fac_[0-9A-HJKMNP-TV-Z]{16}$/);
});
