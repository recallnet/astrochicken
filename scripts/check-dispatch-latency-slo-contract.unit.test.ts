import assert from "node:assert/strict";
import test from "node:test";

import { analyzeDispatchLatencySloContract } from "./lib/dispatch-latency-slo-contract.ts";

test("dispatch latency SLO contract passes for governed mothership surfaces", () => {
  const result = analyzeDispatchLatencySloContract();

  assert.equal(result.ok, true);
  assert.equal(result.report.dispatch_latency_slo_seconds, 15);
  assert.equal(result.report.maintenance_interval_seconds, 300);
  assert.deepEqual(result.report.diagnostics, []);
});

test("dispatch latency SLO contract skips unrelated staged paths", () => {
  const result = analyzeDispatchLatencySloContract({ files: ["README.md"] });

  assert.equal(result.skipped, true);
  assert.equal(result.ok, true);
});
