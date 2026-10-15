import { spawnOpsCli } from "../helpers/ops-command-cli-fixture.ts";
import assert from "node:assert/strict";


import test from "node:test";

test("common count-json via CLI returns exact string '0' for malformed JSON", () => {
  const run = spawnOpsCli([
      "common",
      "count-json",
      "--raw",
      "{broken"
    ]);
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(run.stdout, "0");
});

test("common count-json via CLI returns stable string length for arrays", () => {
  const run = spawnOpsCli([
      "common",
      "count-json",
      "--raw",
      "[1,2,3]"
    ]);
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(run.stdout, "3");
});

test("common count-json via CLI preserves quote-safe payload semantics via --raw-b64", () => {
  const recommendedPayload = JSON.stringify([
    { title: "Scenario O'Hare", priority: "high" },
    { title: "Another scenario", priority: "medium" },
  ]);
  const encoded = Buffer.from(recommendedPayload, "utf8").toString("base64");

  const run = spawnOpsCli([
      "common",
      "count-json",
      "--raw-b64",
      encoded
    ]);

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(run.stdout, "2");
});

test("common count-json via CLI accepts stdin payload transport", () => {
  const run = spawnOpsCli([
      "common",
      "count-json"
    ], {
      input: JSON.stringify([{ title: "O'Hare\nLine two" }, { title: "Two" }])
    });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(run.stdout, "2");
});

test("common count-json via CLI empty-stdin fallback is deterministic", () => {
  const run = spawnOpsCli([
      "common",
      "count-json"
    ], {
      input: ""
    });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(run.stdout, "0");
});

test("common count-feature-objects via CLI counts only object entries", () => {
  const payload = JSON.stringify([{ id: "F-1" }, "oops", null, { id: "F-2" }]);
  const encoded = Buffer.from(payload, "utf8").toString("base64");

  const run = spawnOpsCli([
      "common",
      "count-feature-objects",
      "--raw-b64",
      encoded
    ]);

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(run.stdout, "2");
});

test("common encode-base64 via CLI encodes --raw payload deterministically", () => {
  const raw = "npm test -- --runInBand";
  const run = spawnOpsCli([
      "common",
      "encode-base64",
      "--raw",
      raw
    ]);

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(run.stdout, Buffer.from(raw, "utf8").toString("base64"));
});

test("common encode-base64 via CLI accepts stdin payload transport", () => {
  const raw = "echo 'hello from stdin'";
  const run = spawnOpsCli([
      "common",
      "encode-base64"
    ], {
      input: raw
    });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(run.stdout, Buffer.from(raw, "utf8").toString("base64"));
});

// Regression: normalize_features drops approved features to zero (issue #1654, #1657)
// The Hatch engine JSON.stringify()s non-string context values, so approved_features
// from the review node arrives as a JSON-encoded string wrapping the actual array.
// count-feature-objects must unwrap that double-encoding layer.
test("common count-feature-objects via CLI unwraps Hatch double-encoded JSON string (regression #1654)", () => {
  const innerArray = [{ id: "F-1", name: "Feature A", summary: "test" }, { id: "F-2", name: "Feature B", summary: "test2" }, { id: "F-3", name: "Feature C", summary: "test3" }];
  // Hatch engine stores non-string context values as JSON.stringify(val)
  const doubleEncoded = JSON.stringify(JSON.stringify(innerArray));
  // Strip the outer wrapping quotes — the context value the node sees is JSON.stringify(innerArray)
  const contextValue = JSON.stringify(innerArray);
  const encoded = Buffer.from(contextValue, "utf8").toString("base64");

  const run = spawnOpsCli([
      "common",
      "count-feature-objects",
      "--raw-b64",
      encoded
    ]);

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(run.stdout, "3", `expected 3 features, got: ${run.stdout} stderr: ${run.stderr}`);
});

test("common count-feature-objects via CLI handles double-encoded b64 transport (full Hatch pipeline regression)", () => {
  const innerArray = [{ id: "F-1", name: "Feature A", summary: "s1" }, { id: "F-2", name: "Feature B", summary: "s2" }];
  // Hatch engine: context.set(key, JSON.stringify(val)) for non-string output
  const engineStoredValue = JSON.stringify(innerArray); // e.g. '[{"id":"F-1",...}]'
  // DOT node: approved_b64=$(printf '%s' "${approved_features}" | base64 | tr -d '\n')
  const b64 = Buffer.from(engineStoredValue, "utf8").toString("base64");

  const run = spawnOpsCli([
      "common",
      "count-feature-objects",
      "--raw-b64",
      b64
    ]);

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(run.stdout, "2", `expected 2 features, got: ${run.stdout} stderr: ${run.stderr}`);
});

test("common fallback-json via CLI unwraps Hatch double-encoded JSON string (regression #1654)", () => {
  const innerArray = [{ id: "F-1", name: "Feature A", summary: "test" }, { id: "F-2", name: "Feature B", summary: "test2" }];
  // Simulate Hatch engine double-encoding: approved_features stored as JSON.stringify(array)
  const engineStoredValue = JSON.stringify(innerArray);
  const b64 = Buffer.from(engineStoredValue, "utf8").toString("base64");

  const run = spawnOpsCli([
      "common",
      "fallback-json",
      "--raw-b64",
      b64,
      "--goal-number",
      "1613"
    ]);

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const out = JSON.parse(run.stdout || "[]");
  assert.equal(Array.isArray(out), true, "output must be an array");
  assert.equal(out.length, 2, `expected 2 features, got: ${out.length}`);
  assert.equal(out[0].id, "F-1");
  assert.equal(out[1].id, "F-2");
});

// Regression: normalize_features drops features to 0 when LLM returns object-wrapped
// array { "features": [...] } instead of a bare array (bug #1737, 54x recurrence).
// count-feature-objects must unwrap the features key from plain objects.
test("common count-feature-objects via CLI unwraps object-wrapped features array (regression #1737)", () => {
  const wrapped = { features: [{ id: "F-1", name: "Feature A", summary: "s1" }, { id: "F-2", name: "Feature B", summary: "s2" }, { id: "F-3", name: "Feature C", summary: "s3" }] };
  const b64 = Buffer.from(JSON.stringify(wrapped), "utf8").toString("base64");

  const run = spawnOpsCli([
      "common",
      "count-feature-objects",
      "--raw-b64",
      b64
    ]);

  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(run.stdout, "3", `expected 3 features from wrapped object, got: ${run.stdout} stderr: ${run.stderr}`);
});

test("common fallback-json via CLI unwraps object-wrapped features array (regression #1737)", () => {
  const wrapped = { features: [{ id: "F-1", name: "Feature A", summary: "s1" }, { id: "F-2", name: "Feature B", summary: "s2" }] };
  const b64 = Buffer.from(JSON.stringify(wrapped), "utf8").toString("base64");

  const run = spawnOpsCli([
      "common",
      "fallback-json",
      "--raw-b64",
      b64,
      "--goal-number",
      "42"
    ]);

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const out = JSON.parse(run.stdout || "[]");
  assert.equal(Array.isArray(out), true, "output must be an array");
  assert.equal(out.length, 2, `expected 2 features from wrapped object, got: ${out.length}`);
  assert.equal(out[0].id, "F-1");
  assert.equal(out[1].id, "F-2");
});
