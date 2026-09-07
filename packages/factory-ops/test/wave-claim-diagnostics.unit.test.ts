import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { runWaveClaimDiagnostics } from "../src/commands/wave-claim-diagnostics.ts";

test("runWaveClaimDiagnostics executes contention/reclaim/circuit/orphan gates with structured assertions", () => {
  const out = runWaveClaimDiagnostics({ nowEpochMs: Date.parse("2026-01-01T01:00:00.000Z") });

  assert.equal(out.ok, true);
  assert.equal(out.schema_version, "wave_claim_diagnostics/v1");
  assert.deepEqual(out.checks.map((check) => check.gate), ["contention", "reclaim", "circuit", "orphan_sweep"]);
  assert.equal(out.checks.every((check) => Array.isArray(check.assertions) && check.assertions.length > 0), true);
  assert.equal(out.ownership_contract.transitions.length > 0, true);
});

test("cli wave claim-diagnostics returns machine-readable summary", () => {
  const cliPath = new URL("../src/cli.ts", import.meta.url).pathname;
  const result = spawnSync("node", [
    cliPath,
    "wave",
    "claim-diagnostics",
    "--now-epoch-ms",
    String(Date.parse("2026-01-01T01:00:00.000Z")),
  ], { encoding: "utf8" });

  assert.equal(result.status, 0);
  const parsed = JSON.parse(String(result.stdout || "{}"));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.summary.failed, 0);
  assert.equal(parsed.checks.some((check) => check.gate === "contention"), true);
});
