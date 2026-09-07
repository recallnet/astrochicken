import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("goal-fallback-defect command exports required helpers", () => {
  const src = readFileSync("packages/factory-ops/src/commands/goal-fallback-defect.ts", "utf8");

  assert.match(src, /export function buildFallbackDefectSignal/);
  assert.match(src, /export function persistFallbackDefectSignal/);
  assert.match(src, /export function emitFallbackDefectTelemetry/);
  assert.match(src, /export function emitAndPersistFallbackDefectSignal/);

  assert.match(src, /fallback_defect\/v1/);
  assert.match(src, /event_name:\s*"hatch\.fallback_defect"/);
  assert.match(src, /pipeline_transport_defect/);
  assert.match(src, /llm_output_malformed/);
  assert.match(src, /llm_output_empty/);
  assert.match(src, /contract_violation/);
  assert.match(src, /external_service_failure/);
});
