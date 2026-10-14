import { spawnOpsCli } from "../helpers/ops-command-cli-fixture.ts";
import assert from "node:assert/strict";

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), "host-intent-cli-"));
}

function runCli(args, { expectOk = true, env = {} } = {}) {
  const run = spawnOpsCli([
      ...args
    ], {
      env: { ...process.env, ...env }
    });
  if (expectOk) {
    assert.equal(run.status, 0, `stderr=${run.stderr}\nstdout=${run.stdout}`);
  }
  const stdout = String(run.stdout || "").trim();
  const payload = stdout ? JSON.parse(stdout) : {};
  return { ...run, payload };
}

test("factory disable writes intent file and returns ok JSON", () => {
  const hostBaseDir = makeTmpDir();
  try {
    const { payload } = runCli([
      "factory", "disable",
      "--factory-id", "test-fac",
      "--reason", "maintenance window",
      "--host-base-dir", hostBaseDir,
    ]);

    assert.equal(payload.ok, true);
    assert.equal(payload.action, "disable");
    assert.equal(payload.factory_id, "test-fac");

    const intentPath = join(hostBaseDir, "test-fac", "intent.json");
    assert.ok(existsSync(intentPath), "intent.json should exist");

    const raw = JSON.parse(readFileSync(intentPath, "utf8"));
    assert.equal(raw.enabled, false);
    assert.equal(raw.disabled_reason, "maintenance window");
    assert.equal(raw.factory_id, "test-fac");
    assert.equal(raw.schema, "hatch.host.factory-intent.v1");
  } finally {
    rmSync(hostBaseDir, { recursive: true, force: true });
  }
});

test("factory enable writes intent file and returns ok JSON", () => {
  const hostBaseDir = makeTmpDir();
  try {
    const { payload } = runCli([
      "factory", "enable",
      "--factory-id", "test-fac",
      "--host-base-dir", hostBaseDir,
    ]);

    assert.equal(payload.ok, true);
    assert.equal(payload.action, "enable");
    assert.equal(payload.factory_id, "test-fac");

    const intentPath = join(hostBaseDir, "test-fac", "intent.json");
    assert.ok(existsSync(intentPath), "intent.json should exist");

    const raw = JSON.parse(readFileSync(intentPath, "utf8"));
    assert.equal(raw.enabled, true);
    assert.equal(raw.disabled_at, null);
    assert.equal(raw.disabled_reason, null);
  } finally {
    rmSync(hostBaseDir, { recursive: true, force: true });
  }
});

test("factory disable then enable round-trip", () => {
  const hostBaseDir = makeTmpDir();
  try {
    runCli([
      "factory", "disable",
      "--factory-id", "round-trip",
      "--reason", "going down",
      "--host-base-dir", hostBaseDir,
    ]);

    const intentPath = join(hostBaseDir, "round-trip", "intent.json");
    let raw = JSON.parse(readFileSync(intentPath, "utf8"));
    assert.equal(raw.enabled, false);
    assert.equal(raw.disabled_reason, "going down");

    runCli([
      "factory", "enable",
      "--factory-id", "round-trip",
      "--host-base-dir", hostBaseDir,
    ]);

    raw = JSON.parse(readFileSync(intentPath, "utf8"));
    assert.equal(raw.enabled, true);
    assert.equal(raw.disabled_at, null);
    assert.equal(raw.disabled_reason, null);
  } finally {
    rmSync(hostBaseDir, { recursive: true, force: true });
  }
});

test("factory disable fails without --factory-id", () => {
  const { status } = runCli([
    "factory", "disable",
    "--reason", "no factory id",
  ], { expectOk: false });

  assert.notEqual(status, 0, "should fail without --factory-id");
});

test("factory enable fails without --factory-id", () => {
  const { status } = runCli([
    "factory", "enable",
  ], { expectOk: false });

  assert.notEqual(status, 0, "should fail without --factory-id");
});

test("factory disable respects HATCH_HOST_BASE_DIR env var", () => {
  const hostBaseDir = makeTmpDir();
  try {
    const { payload } = runCli([
      "factory", "disable",
      "--factory-id", "env-test",
      "--reason", "env test",
    ], { env: { HATCH_HOST_BASE_DIR: hostBaseDir } });

    assert.equal(payload.ok, true);
    assert.equal(payload.factory_id, "env-test");

    const intentPath = join(hostBaseDir, "env-test", "intent.json");
    assert.ok(existsSync(intentPath), "intent.json should be written to HATCH_HOST_BASE_DIR path");

    const raw = JSON.parse(readFileSync(intentPath, "utf8"));
    assert.equal(raw.enabled, false);
    assert.equal(raw.disabled_reason, "env test");
  } finally {
    rmSync(hostBaseDir, { recursive: true, force: true });
  }
});

test("factory enable respects HATCH_HOST_BASE_DIR env var", () => {
  const hostBaseDir = makeTmpDir();
  try {
    // First disable via env var
    runCli([
      "factory", "disable",
      "--factory-id", "env-test-en",
    ], { env: { HATCH_HOST_BASE_DIR: hostBaseDir } });

    // Then enable via env var
    const { payload } = runCli([
      "factory", "enable",
      "--factory-id", "env-test-en",
    ], { env: { HATCH_HOST_BASE_DIR: hostBaseDir } });

    assert.equal(payload.ok, true);

    const intentPath = join(hostBaseDir, "env-test-en", "intent.json");
    const raw = JSON.parse(readFileSync(intentPath, "utf8"));
    assert.equal(raw.enabled, true);
  } finally {
    rmSync(hostBaseDir, { recursive: true, force: true });
  }
});
