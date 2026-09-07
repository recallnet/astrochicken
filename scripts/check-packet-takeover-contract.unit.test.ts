import assert from "node:assert/strict";
import test from "node:test";

import {
  validatePacketTakeoverSamples,
  validateTakeoverHelperRoundTrip,
} from "./check-packet-takeover-contract.ts";

test("packet takeover contract helper builds a valid common takeover shape", () => {
  const out = validateTakeoverHelperRoundTrip();
  assert.equal(out.ok, true, out.diagnostics.join("\n"));
});

test("packet takeover contract samples stay packet-only takeover ready", () => {
  const out = validatePacketTakeoverSamples();
  assert.equal(out.ok, true, out.diagnostics.join("\n"));
});
