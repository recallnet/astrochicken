import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../../..");
const opsCliPath = join(repoRoot, "packages/factory-ops/src/cli.ts");

function runCountFeatureObjects(rawB64 = "") {
  return spawnSync("node", [opsCliPath, "common", "count-feature-objects", "--raw-b64", rawB64], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

function runFallbackJson(rawB64 = "", goalNumber = "1729") {
  return spawnSync("node", [opsCliPath, "common", "fallback-json", "--raw-b64", rawB64, "--goal-number", goalNumber], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

test("normalize_features behavioral gate: count-feature-objects returns 3 for plain JSON array b64", () => {
  const arr = [
    { id: "F-1", name: "A", summary: "s" },
    { id: "F-2", name: "B", summary: "t" },
    { id: "F-3", name: "C", summary: "u" },
  ];
  const b64 = Buffer.from(JSON.stringify(arr), "utf8").toString("base64");

  const run = runCountFeatureObjects(b64);
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(run.stdout, "3");
});

test("normalize_features behavioral gate: count-feature-objects returns 3 for Hatch engine JSON.stringify(array) context transport", () => {
  const arr = [
    { id: "F-1", name: "A", summary: "s" },
    { id: "F-2", name: "B", summary: "t" },
    { id: "F-3", name: "C", summary: "u" },
  ];
  const engineValue = JSON.stringify(arr);
  const b64 = Buffer.from(engineValue, "utf8").toString("base64");

  const run = runCountFeatureObjects(b64);
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(run.stdout, "3");
});

test("normalize_features behavioral gate: count-feature-objects returns 3 for object-wrapped { features: [...] } b64", () => {
  const arr = [
    { id: "F-1", name: "A", summary: "s" },
    { id: "F-2", name: "B", summary: "t" },
    { id: "F-3", name: "C", summary: "u" },
  ];
  const wrapped = { features: arr };
  const b64 = Buffer.from(JSON.stringify(wrapped), "utf8").toString("base64");

  const run = runCountFeatureObjects(b64);
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(run.stdout, "3");
});

// Regression gate for normalize_features count=0 (goal #1729, bug #1726).
// This test FAILS against the pre-F-1 codebase and PASSES after F-1 adds
// double-base64 unwrap support to parseFeatureArray.
test("normalize_features behavioral gate: count-feature-objects returns 3 for double-base64 transport", () => {
  const arr = [
    { id: "F-1", name: "A", summary: "s" },
    { id: "F-2", name: "B", summary: "t" },
    { id: "F-3", name: "C", summary: "u" },
  ];
  const innerB64 = Buffer.from(JSON.stringify(arr), "utf8").toString("base64");
  const doubleB64 = Buffer.from(innerB64, "utf8").toString("base64");

  const run = runCountFeatureObjects(doubleB64);
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(run.stdout, "3");
});

test("normalize_features behavioral gate: fallback-json unwraps Hatch engine JSON.stringify(array) transport", () => {
  const arr = [
    { id: "F-1", name: "A", summary: "s" },
    { id: "F-2", name: "B", summary: "t" },
  ];
  const engineValue = JSON.stringify(arr);
  const b64 = Buffer.from(engineValue, "utf8").toString("base64");

  const run = runFallbackJson(b64, "1729");
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const out = JSON.parse(run.stdout || "[]");
  assert.equal(Array.isArray(out), true);
  assert.equal(out.length >= 1, true);
  assert.equal(out[0].id, "F-1");
});

test("normalize_features behavioral gate: fallback-json unwraps object-wrapped features transport", () => {
  const arr = [
    { id: "F-1", name: "A", summary: "s" },
    { id: "F-2", name: "B", summary: "t" },
  ];
  const wrapped = { features: arr };
  const b64 = Buffer.from(JSON.stringify(wrapped), "utf8").toString("base64");

  const run = runFallbackJson(b64, "1729");
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const out = JSON.parse(run.stdout || "[]");
  assert.equal(Array.isArray(out), true);
  assert.equal(out.length >= 1, true);
  assert.equal(out[0].id, "F-1");
});
