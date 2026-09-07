import assert from "node:assert/strict";
import test from "node:test";

import { evaluateRuntimeCompatibility } from "../../src/lib/runtime-compatibility.ts";

test("evaluateRuntimeCompatibility accepts matching ranges", () => {
  const out = evaluateRuntimeCompatibility({
    runtimeVersion: "1.2.3",
    allowedRange: ">=1.0.0 <2.0.0",
  });
  assert.equal(out.ok, true);
  assert.equal(out.allowedRange, ">=1.0.0 <2.0.0");
});

test("evaluateRuntimeCompatibility supports wildcard semantics for empty and star ranges", () => {
  const emptyRange = evaluateRuntimeCompatibility({
    runtimeVersion: "1.2.3",
    allowedRange: "",
  });
  assert.equal(emptyRange.ok, true);
  assert.equal(emptyRange.allowedRange, "*");

  const starRange = evaluateRuntimeCompatibility({
    runtimeVersion: "1.2.3",
    allowedRange: "*",
  });
  assert.equal(starRange.ok, true);
  assert.equal(starRange.allowedRange, "*");
});

test("evaluateRuntimeCompatibility rejects non-matching ranges", () => {
  const out = evaluateRuntimeCompatibility({
    runtimeVersion: "1.2.3",
    allowedRange: ">=2.0.0 <3.0.0",
  });
  assert.equal(out.ok, false);
  assert.match(out.reason, /runtime_version_out_of_range:1.2.3:>=2.0.0 <3.0.0/);
});

test("evaluateRuntimeCompatibility fails closed on malformed ranges", () => {
  assert.throws(
    () => evaluateRuntimeCompatibility({
      runtimeVersion: "1.2.3",
      allowedRange: "v(one)",
    }),
    /runtime_version_range_invalid:v\(one\)/,
  );
});
