import test from "node:test";
import assert from "node:assert/strict";

import { analyzeCapabilityManifestContract } from "./lib/capability-manifest-contract.ts";

test("capability manifest registry passes for governed capability packages", async () => {
  const result = await analyzeCapabilityManifestContract();
  assert.equal(result.ok, true);
  assert.deepEqual(result.report.diagnostics, []);
  assert.ok(result.report.summary.registered_capabilities > 0);
});
