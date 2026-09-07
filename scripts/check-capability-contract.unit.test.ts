import test from "node:test";
import assert from "node:assert/strict";

import { analyzeCapabilityContract } from "./lib/capability-contract.ts";

test("capability contract registry passes for governed capability packages", async () => {
  const result = await analyzeCapabilityContract();
  assert.equal(result.ok, true);
  assert.deepEqual(result.report.diagnostics, []);
  assert.ok(result.report.summary.registered_capabilities > 0);
});
