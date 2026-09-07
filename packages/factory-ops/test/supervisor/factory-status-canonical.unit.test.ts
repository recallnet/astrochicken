import assert from "node:assert/strict";
import test from "node:test";

import { factoryStatus } from "../../src/lib/factory-status-canonical.ts";

test("factoryStatus falls back to legacy local status when canonical projection loses Postgres connectivity", () => {
  const fallback = {
    context: {
      factory_id: "example-trading",
      target_repo: "example-org/example-trading",
    },
    active: [],
    runs: [],
    completed: 2,
    failed: 0,
    blocked_control_plane: [],
    managed_state: {
      state_action: "none",
      reason: "",
      retry_target: "",
      health_classification: "healthy",
      state_path: "",
    },
    control_plane: {},
    open_packets: [],
    hard_goal_review: {},
    hard_plan_traceability: {},
  };

  const result = factoryStatus({
    context: { factory_id: "example-trading" },
    runsDir: "/tmp/example-trading-runs",
    runInlineProjectionSyncFn() {
      const error = new Error("Command failed");
      error.stderr = "Error: Connection terminated unexpectedly\n    at pg-pool/index.js:45:11\n";
      throw error;
    },
    legacyFixtureFactoryStatusFn() {
      return fallback;
    },
  });

  assert.equal(result.completed, 2);
  assert.equal(result.context.canonical_status_source, "legacy_fixture_fallback");
  assert.equal(result.context.canonical_status_warning, "Connection terminated unexpectedly");
});

test("factoryStatus validates projection payloads before returning them", () => {
  assert.throws(() => factoryStatus({
    context: { factory_id: "example-trading" },
    runsDir: "/tmp/example-trading-runs",
    runInlineProjectionSyncFn() {
      return JSON.stringify({
        completed: 0,
        failed: 0,
        managed_state: { state_action: "none", health_classification: "healthy" },
        tabs: [],
      });
    },
    legacyFixtureFactoryStatusFn() {
      throw new Error("legacy fallback should not be used for invalid payload shape");
    },
  }), /invalid_type/u);
});

test("factoryStatus can reuse a current persisted projection without invoking inline reprojection", () => {
  const projection = {
    context: {
      factory_id: "example-trading",
      target_repo: "example-org/example-trading",
    },
    active: [],
    runs: [],
    completed: 3,
    failed: 1,
    blocked_control_plane: [],
    managed_state: {
      state_action: "resume",
      reason: "",
      retry_target: "",
      health_classification: "healthy",
      state_path: "",
    },
    control_plane: {},
    open_packets: [],
    hard_goal_review: {},
    hard_plan_traceability: {},
  };

  const result = factoryStatus({
    context: { factory_id: "example-trading" },
    runsDir: "/tmp/example-trading-runs",
    readCanonicalProjectionSyncFn() {
      return JSON.stringify(projection);
    },
    runInlineProjectionSyncFn() {
      throw new Error("inline reprojection should not run when a current persisted projection is available");
    },
  });

  assert.equal(result.completed, 3);
  assert.equal(result.failed, 1);
  assert.equal(result.managed_state.state_action, "resume");
});

test("factoryStatus refreshes invocation-scoped context when reusing a persisted projection", () => {
  const result = factoryStatus({
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
        active: [],
        runs: [],
        completed: 1,
        failed: 0,
        blocked_control_plane: [],
        managed_state: {
          state_action: "resume",
          reason: "",
          retry_target: "",
          health_classification: "healthy",
          state_path: "",
        },
        control_plane: {},
        open_packets: [],
        hard_goal_review: {},
        hard_plan_traceability: {},
      });
    },
  });

  assert.equal(result.context.factory_root, "/tmp/external-layout");
  assert.equal(result.context.factory_config_path, "/tmp/external-layout/factory.config.json");
  assert.equal(result.context.runs_dir, "/tmp/external-layout/.hatch/mothership/runs");
  assert.equal(result.context.scenarios_root, "/tmp/external-layout/scenarios");
});
