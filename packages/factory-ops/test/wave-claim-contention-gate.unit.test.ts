import test from "node:test";
import assert from "node:assert/strict";
import { runWaveClaimDiagnostics } from "../src/commands/wave-claim-diagnostics.ts";

test("contention gate proves single-worker lock/close path with loser park + idempotent retry", () => {
  const out = runWaveClaimDiagnostics({ nowEpochMs: Date.parse("2026-01-01T01:00:00.000Z") });
  const contention = out.checks.find((check) => check.gate === "contention");
  assert.ok(contention);
  assert.equal(contention.ok, true);

  const byName = new Map(contention.assertions.map((entry) => [entry.name, entry]));
  assert.equal(byName.get("single_worker_lock_granted")?.ok, true);
  assert.equal(byName.get("loser_park_reason")?.ok, true);
  assert.equal(byName.get("single_lock_label_mutation")?.ok, true);
  assert.equal(byName.get("single_terminal_close_side_effect")?.ok, true);
  assert.equal(byName.get("loser_retry_idempotent_no_extra_mutation")?.ok, true);
  assert.equal(byName.get("single_claim_release")?.ok, true);
});
