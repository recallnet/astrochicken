import test from "node:test";
import assert from "node:assert/strict";
import { runWaveClaimDiagnostics } from "../src/commands/wave-claim-diagnostics.ts";

test("reclaim gate enforces single stale reclaim race winner with durable metadata", () => {
  const out = runWaveClaimDiagnostics({ nowEpochMs: Date.parse("2026-01-01T01:00:00.000Z") });
  const reclaim = out.checks.find((check) => check.gate === "reclaim");
  assert.ok(reclaim);
  assert.equal(reclaim.ok, true);

  const byName = new Map(reclaim.assertions.map((entry) => [entry.name, entry]));
  assert.equal(byName.get("single_reclaim_path")?.ok, true);
  assert.equal(byName.get("single_reacquired_claim")?.ok, true);
  assert.equal(byName.get("race_loser_observes_active_owner")?.ok, true);
  assert.equal(byName.get("metadata_reclaim_count_recorded")?.ok, true);
  assert.equal(byName.get("metadata_previous_owner_recorded")?.ok, true);
  assert.equal(byName.get("metadata_previous_run_recorded")?.ok, true);
  assert.equal(byName.get("metadata_heartbeat_present")?.ok, true);
});
