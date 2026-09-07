import assert from "node:assert/strict";
import test from "node:test";

import { resolveNodeRoutingPolicy } from "../../src/commands/factory-model-policy.ts";

test("resolveNodeRoutingPolicy export exists and fails closed for missing required args", async () => {
  await assert.rejects(
    () => resolveNodeRoutingPolicy({
      factoryRoot: "factories/mothership",
      nodeId: "supervisor_review",
    }),
    /--graph-file is required when --show-node-policy is set/,
  );

  await assert.rejects(
    () => resolveNodeRoutingPolicy({
      factoryRoot: "factories/mothership",
      graphFile: "factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs",
    }),
    /--node-id is required when --show-node-policy is set/,
  );
});
