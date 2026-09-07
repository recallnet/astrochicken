import test from "node:test";
import assert from "node:assert/strict";
import { runWaveClaimDiagnostics } from "../src/commands/wave-claim-diagnostics.ts";

test("circuit gate captures failing legacy baseline and deterministic bounded backoff", () => {
  const out = runWaveClaimDiagnostics({ nowEpochMs: Date.parse("2026-01-01T01:00:00.000Z") });
  const circuit = out.checks.find((check) => check.gate === "circuit");
  assert.ok(circuit);
  assert.equal(circuit.ok, true);

  const byName = new Map(circuit.assertions.map((entry) => [entry.name, entry]));
  assert.equal(byName.get("legacy_baseline_detects_unbounded_retry")?.ok, true);
  assert.equal(byName.get("hard_retry_cap_enforced")?.ok, true);
  assert.equal(byName.get("deterministic_exponential_backoff")?.ok, true);
  assert.equal(byName.get("circuit_open_throttle_observable")?.ok, true);
  assert.equal(byName.get("circuit_terminal_stop_after_overflow")?.ok, true);
});
