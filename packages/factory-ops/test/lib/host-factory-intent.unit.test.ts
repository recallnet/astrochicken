import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  HOST_FACTORY_INTENT_SCHEMA,
  readHostFactoryIntent,
  writeHostFactoryIntent,
  resolveIntentFilePath,
} from "../../src/lib/host-factory-intent.ts";

function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), "host-intent-test-"));
}

test("readHostFactoryIntent returns enabled when file is missing", () => {
  const dir = makeTmpDir();
  try {
    const result = readHostFactoryIntent({ intentFilePath: join(dir, "intent.json") });
    assert.equal(result.enabled, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readHostFactoryIntent returns enabled when file contains malformed JSON", () => {
  const dir = makeTmpDir();
  try {
    writeFileSync(join(dir, "intent.json"), "not json at all {{{");
    const result = readHostFactoryIntent({ intentFilePath: join(dir, "intent.json") });
    assert.equal(result.enabled, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readHostFactoryIntent returns disabled with reason from valid intent file", () => {
  const dir = makeTmpDir();
  try {
    const intent = {
      schema: HOST_FACTORY_INTENT_SCHEMA,
      factory_id: "test-fac",
      enabled: false,
      disabled_at: "2026-03-23T10:00:00.000Z",
      disabled_reason: "maintenance",
      updated_at: "2026-03-23T10:00:00.000Z",
      updated_by: "operator",
    };
    writeFileSync(join(dir, "intent.json"), JSON.stringify(intent, null, 2));
    const result = readHostFactoryIntent({ intentFilePath: join(dir, "intent.json") });
    assert.equal(result.enabled, false);
    assert.equal(result.disabled_reason, "maintenance");
    assert.equal(result.disabled_at, "2026-03-23T10:00:00.000Z");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readHostFactoryIntent returns enabled from valid enabled intent file", () => {
  const dir = makeTmpDir();
  try {
    const intent = {
      schema: HOST_FACTORY_INTENT_SCHEMA,
      factory_id: "test-fac",
      enabled: true,
      disabled_at: null,
      disabled_reason: null,
      updated_at: "2026-03-23T10:00:00.000Z",
      updated_by: "operator",
    };
    writeFileSync(join(dir, "intent.json"), JSON.stringify(intent, null, 2));
    const result = readHostFactoryIntent({ intentFilePath: join(dir, "intent.json") });
    assert.equal(result.enabled, true);
    assert.equal(result.disabled_reason, null);
    assert.equal(result.disabled_at, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeHostFactoryIntent creates valid disabled intent file", () => {
  const dir = makeTmpDir();
  try {
    const intentPath = join(dir, "intent.json");
    writeHostFactoryIntent({
      intentFilePath: intentPath,
      factoryId: "test-fac",
      enabled: false,
      reason: "maintenance window",
      actor: "operator",
    });
    const raw = JSON.parse(readFileSync(intentPath, "utf8"));
    assert.equal(raw.schema, HOST_FACTORY_INTENT_SCHEMA);
    assert.equal(raw.factory_id, "test-fac");
    assert.equal(raw.enabled, false);
    assert.equal(raw.disabled_reason, "maintenance window");
    assert.ok(raw.disabled_at, "disabled_at should be set");
    assert.equal(raw.updated_by, "operator");
    assert.ok(raw.updated_at, "updated_at should be set");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeHostFactoryIntent creates valid enabled intent file and clears disabled fields", () => {
  const dir = makeTmpDir();
  try {
    const intentPath = join(dir, "intent.json");
    writeHostFactoryIntent({
      intentFilePath: intentPath,
      factoryId: "test-fac",
      enabled: true,
      reason: "",
      actor: "operator",
    });
    const raw = JSON.parse(readFileSync(intentPath, "utf8"));
    assert.equal(raw.schema, HOST_FACTORY_INTENT_SCHEMA);
    assert.equal(raw.enabled, true);
    assert.equal(raw.disabled_at, null);
    assert.equal(raw.disabled_reason, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeHostFactoryIntent + readHostFactoryIntent round-trip disabled", () => {
  const dir = makeTmpDir();
  try {
    const intentPath = join(dir, "intent.json");
    writeHostFactoryIntent({
      intentFilePath: intentPath,
      factoryId: "round-trip",
      enabled: false,
      reason: "testing round trip",
      actor: "test-suite",
    });
    const result = readHostFactoryIntent({ intentFilePath: intentPath });
    assert.equal(result.enabled, false);
    assert.equal(result.disabled_reason, "testing round trip");
    assert.equal(result.updated_by, "test-suite");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeHostFactoryIntent + readHostFactoryIntent round-trip re-enable", () => {
  const dir = makeTmpDir();
  try {
    const intentPath = join(dir, "intent.json");
    writeHostFactoryIntent({
      intentFilePath: intentPath,
      factoryId: "re-enable",
      enabled: false,
      reason: "going down",
      actor: "operator",
    });
    assert.equal(readHostFactoryIntent({ intentFilePath: intentPath }).enabled, false);

    writeHostFactoryIntent({
      intentFilePath: intentPath,
      factoryId: "re-enable",
      enabled: true,
      reason: "",
      actor: "operator",
    });
    const result = readHostFactoryIntent({ intentFilePath: intentPath });
    assert.equal(result.enabled, true);
    assert.equal(result.disabled_reason, null);
    assert.equal(result.disabled_at, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeHostFactoryIntent creates parent directories if needed", () => {
  const dir = makeTmpDir();
  try {
    const intentPath = join(dir, "nested", "deep", "intent.json");
    writeHostFactoryIntent({
      intentFilePath: intentPath,
      factoryId: "nested-test",
      enabled: false,
      reason: "nested",
      actor: "test",
    });
    const result = readHostFactoryIntent({ intentFilePath: intentPath });
    assert.equal(result.enabled, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveIntentFilePath returns correct path under baseDir/factoryId", () => {
  const result = resolveIntentFilePath({ factoryId: "example-scanner", baseDir: "/srv/hatch-hosts" });
  assert.equal(result, "/srv/hatch-hosts/example-scanner/intent.json");
});

test("resolveIntentFilePath uses default baseDir when not specified", () => {
  const result = resolveIntentFilePath({ factoryId: "mothership" });
  assert.ok(result.endsWith("/mothership/intent.json"), `expected path to end with /mothership/intent.json, got ${result}`);
  assert.ok(result.includes(".hatch-hosts"), `expected path to include .hatch-hosts, got ${result}`);
});
