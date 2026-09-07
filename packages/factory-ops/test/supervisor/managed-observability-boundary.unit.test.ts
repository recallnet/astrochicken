import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  MANAGED_OBSERVABILITY_BOUNDARY_ERROR_CODE,
  assertPayloadWithinBoundary,
  sanitizeMirroredPayload,
} from "../../src/lib/managed-observability-boundary.ts";

const fixtureSummaryPath = path.resolve(
  process.cwd(),
  "scripts/fixtures/managed-factory-observability-boundary/summary.json",
);

function readFixtureSummary() {
  return JSON.parse(readFileSync(fixtureSummaryPath, "utf8"));
}

test("sanitizeMirroredPayload strips host-local fields and preserves mirrored metadata", () => {
  const raw = {
    ...readFixtureSummary(),
    domain_result: { dispatched: true },
    session_traces: [{ step: "domain" }],
    telemetry: {
      ...readFixtureSummary().telemetry,
      event_name: "factory.managed_supervisor.run_summary",
    },
  };

  const { sanitizedPayload, droppedKeys } = sanitizeMirroredPayload(raw);

  assert.equal("domain_result" in sanitizedPayload, false);
  assert.equal("session_traces" in sanitizedPayload, false);
  assert.equal("event_name" in (sanitizedPayload.telemetry || {}), false);
  assert.equal(sanitizedPayload.telemetry.lifecycle_state, raw.telemetry.lifecycle_state);
  assert.equal(droppedKeys.includes("domain_result"), true);
  assert.equal(droppedKeys.includes("session_traces"), true);
  assert.equal(droppedKeys.includes("telemetry.event_name"), true);
});

test("assertPayloadWithinBoundary accepts canonical compliant fixture", () => {
  const fixture = readFixtureSummary();
  const out = assertPayloadWithinBoundary(fixture);
  assert.equal(out.ok, true);
  assert.deepEqual(out.violations, []);
});

test("assertPayloadWithinBoundary fails when forbidden key is present", () => {
  const invalid = {
    ...readFixtureSummary(),
    domain_result: { leaked: true },
  };

  assert.throws(
    () => assertPayloadWithinBoundary(invalid),
    (error) => {
      assert.equal(error?.code, MANAGED_OBSERVABILITY_BOUNDARY_ERROR_CODE);
      assert.equal(Array.isArray(error?.violations), true);
      assert.equal(error.violations.some((entry) => String(entry).includes("forbidden_key path=domain_result")), true);
      return true;
    },
  );
});
