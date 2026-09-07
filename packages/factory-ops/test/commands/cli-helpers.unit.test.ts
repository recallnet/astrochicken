import assert from "node:assert/strict";
import test from "node:test";

import { parseJsonObjectFlag } from "../../src/cli/helpers.ts";

test("parseJsonObjectFlag returns empty object for empty input", () => {
  const out = parseJsonObjectFlag({ raw: "", flagName: "sample" });
  assert.equal(out.ok, true);
  assert.deepEqual(out.value, {});
});

test("parseJsonObjectFlag parses valid JSON object", () => {
  const out = parseJsonObjectFlag({
    raw: JSON.stringify({ alpha: "echo 1", beta: "echo 2" }),
    flagName: "sample",
  });
  assert.equal(out.ok, true);
  assert.deepEqual(out.value, { alpha: "echo 1", beta: "echo 2" });
});

test("parseJsonObjectFlag rejects non-object JSON payloads", () => {
  const out = parseJsonObjectFlag({ raw: "[]", flagName: "sample" });
  assert.equal(out.ok, false);
  assert.match(String(out.error || ""), /--sample must be a JSON object map/);
});

test("parseJsonObjectFlag rejects malformed JSON payloads", () => {
  const out = parseJsonObjectFlag({ raw: "{bad", flagName: "sample" });
  assert.equal(out.ok, false);
  assert.match(String(out.error || ""), /--sample invalid JSON:/);
});
