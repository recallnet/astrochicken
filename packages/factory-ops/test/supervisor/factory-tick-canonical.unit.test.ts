import assert from "node:assert/strict";
import test from "node:test";

import { factoryTickStatus } from "../../src/lib/factory-tick-canonical.ts";

test("factoryTickStatus can reuse a current persisted projection without invoking inline reprojection", () => {
  const projection = {
    context: {
      factory_id: "example-trading",
      target_repo: "example-org/example-trading",
    },
    ticks: [
      {
        id: "tick-123",
        status: "running",
        stage: "run_domain_graph",
      },
    ],
    goal_executions: [],
    goal_execution_summary: {
      total: 0,
      healthy: 0,
      stale: 0,
      zombie: 0,
    },
  };

  const result = factoryTickStatus({
    context: { factory_id: "example-trading" },
    runsDir: "/tmp/example-trading-runs",
    readCanonicalProjectionSyncFn() {
      return JSON.stringify(projection);
    },
  });

  assert.equal(result.ticks[0].id, "tick-123");
  assert.equal(result.ticks[0].stage, "run_domain_graph");
  assert.equal(result.goal_execution_summary.total, 0);
});

test("factoryTickStatus honors injected read path over inline reprojection", () => {
  const projection = {
    context: {
      factory_id: "example-trading",
    },
    ticks: [],
    goal_executions: [],
    goal_execution_summary: {
      total: 0,
      healthy: 0,
      stale: 0,
      zombie: 0,
    },
  };

  const result = factoryTickStatus({
    context: { factory_id: "example-trading" },
    runsDir: "/tmp/example-trading-runs",
    readCanonicalProjectionSyncFn() {
      return JSON.stringify(projection);
    },
    runInlineProjectionSyncFn() {
      throw new Error("inline reprojection should not run when injected read path is provided");
    },
  });

  assert.deepEqual(result.goal_executions, []);
});

test("factoryTickStatus refreshes invocation-scoped context when reusing a persisted projection", () => {
  const result = factoryTickStatus({
    context: {
      factory_id: "mothership",
      factory_root: "/tmp/external-layout",
      factory_config_path: "/tmp/external-layout/factory.config.json",
      runs_dir: "/tmp/external-layout/.hatch/mothership/runs",
      scenarios_root: "/tmp/external-layout/scenarios",
      target_repo: "recallnet/astrochicken",
      control_plane_repo: "recallnet/astrochicken",
    },
    runsDir: "/tmp/external-layout/.hatch/mothership/runs",
    readCanonicalProjectionSyncFn() {
      return JSON.stringify({
        context: {
          factory_id: "mothership",
          factory_root: "/tmp/control-layout/factories/mothership",
          factory_config_path: "/tmp/control-layout/factories/mothership/factory.config.json",
          runs_dir: "/tmp/control-layout/.hatch/mothership/runs",
          scenarios_root: "/tmp/control-layout/factories/mothership/scenarios",
          target_repo: "recallnet/astrochicken",
          control_plane_repo: "recallnet/astrochicken",
        },
        ticks: [],
        goal_executions: [],
        goal_execution_summary: {
          total: 0,
          healthy: 0,
          stale: 0,
          zombie: 0,
        },
      });
    },
  });

  assert.equal(result.context.factory_root, "/tmp/external-layout");
  assert.equal(result.context.factory_config_path, "/tmp/external-layout/factory.config.json");
  assert.equal(result.context.runs_dir, "/tmp/external-layout/.hatch/mothership/runs");
  assert.equal(result.context.scenarios_root, "/tmp/external-layout/scenarios");
});
