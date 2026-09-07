import test from "node:test";
import assert from "node:assert/strict";
import { runWaveClaimDiagnostics } from "../src/commands/wave-claim-diagnostics.ts";

test("orphan sweep gate covers stale claim artifacts + worktree lock residue idempotently", () => {
  const out = runWaveClaimDiagnostics({ nowEpochMs: Date.parse("2026-01-01T01:00:00.000Z") });
  const orphan = out.checks.find((check) => check.gate === "orphan_sweep");
  assert.ok(orphan);
  assert.equal(orphan.ok, true);

  const byName = new Map(orphan.assertions.map((entry) => [entry.name, entry]));
  assert.equal(byName.get("orphan_plan_contains_claim_and_lock_cleanup")?.ok, true);
  assert.equal(byName.get("orphan_apply_succeeds")?.ok, true);
  assert.equal(byName.get("orphan_cleanup_idempotent_on_rerun")?.ok, true);
  assert.equal(byName.get("orphan_cleanup_contract_explicit")?.ok, true);
});
