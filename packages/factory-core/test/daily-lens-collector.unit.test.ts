import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MissingDataReason,
  addMissingData,
  createCollectorEnvelope,
  finalizeCollectorEnvelope,
  inWindow,
  missingDataErrorText,
  parseJsonSafe,
  toArray,
  toNumber,
  uniqueStrings,
  validateWindow,
} from "../src/daily-lens-collector.ts";

describe("daily lens collector helper contract", () => {
  it("creates envelopes with normalized ISO windows", () => {
    const payload = createCollectorEnvelope({
      source: "langfuse",
      windowStart: "2026-03-16T00:00:00.000Z",
      windowEnd: "2026-03-17T00:00:00.000Z",
    });

    assert.equal(payload.source, "langfuse");
    assert.deepEqual(payload.window, {
      start: "2026-03-16T00:00:00.000Z",
      end: "2026-03-17T00:00:00.000Z",
    });
    assert.ok(payload._windowMs.startMs < payload._windowMs.endMs);
  });

  it("rejects invalid collector windows", () => {
    assert.throws(
      () => validateWindow("2026-03-17T00:00:00.000Z", "2026-03-16T00:00:00.000Z"),
      /windowStart must be before windowEnd/,
    );
  });

  it("records structured missing data and strips internal fields on finalize", () => {
    const payload = createCollectorEnvelope({
      source: "github_state",
      windowStart: "2026-03-16T00:00:00.000Z",
      windowEnd: "2026-03-17T00:00:00.000Z",
    });
    addMissingData(payload, MissingDataReason.COMMAND_FAILED, "gh issue list failed", { status: 1 });
    const finalized = finalizeCollectorEnvelope(payload);

    assert.deepEqual(finalized.missing_data, [{
      reason: "command_failed",
      detail: "gh issue list failed",
      status: 1,
    }]);
    assert.equal("_windowMs" in finalized, false);
  });

  it("provides shared parse and normalization helpers", () => {
    assert.equal(inWindow("2026-03-16T12:00:00.000Z", Date.parse("2026-03-16T00:00:00.000Z"), Date.parse("2026-03-17T00:00:00.000Z")), true);
    assert.deepEqual(parseJsonSafe('{"ok":true}', {}), { ok: true });
    assert.deepEqual(toArray(null), []);
    assert.equal(toNumber("12.5"), 12.5);
    assert.deepEqual(uniqueStrings(["a", " a ", "", "b", "a"]), ["a", "b"]);
    assert.equal(missingDataErrorText([{ detail: "one" }, { detail: "two" }]), "one; two");
  });
});
