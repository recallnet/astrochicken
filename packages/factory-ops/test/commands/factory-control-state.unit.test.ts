import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  runFactoryControlAction,
  runFactoryControlStateRead,
} from "../../src/commands/factory-control-state.ts";

describe("runFactoryControlAction", () => {
  it("returns missing_action when action is empty", () => {
    const result = runFactoryControlAction({
      factoryId: "test-factory",
      reason: "some reason",
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "missing_action");
  });

  it("returns missing_action when action is whitespace-only", () => {
    const result = runFactoryControlAction({
      action: "   ",
      factoryId: "test-factory",
      reason: "some reason",
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "missing_action");
  });

  it("returns missing_factory_id when factoryId is empty", () => {
    const result = runFactoryControlAction({
      action: "pause",
      reason: "some reason",
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "missing_factory_id");
  });

  it("returns missing_reason when reason is empty", () => {
    const result = runFactoryControlAction({
      action: "pause",
      factoryId: "test-factory",
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "missing_reason");
  });

  it("lowercases and trims the action", () => {
    const result = runFactoryControlAction({
      action: "  PAUSE  ",
      factoryId: "test-factory",
      reason: "testing lowercase",
      applyControlActionFn: (args) => ({
        ok: true,
        action: args.action,
        state_version: 1,
        state_path: "/tmp/control-state.json",
        state_action: args.action,
        state: {},
      }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.action, "pause");
  });

  it("returns ok:true with state fields on success", () => {
    const result = runFactoryControlAction({
      action: "pause",
      factoryId: "test-factory",
      reason: "maintenance",
      applyControlActionFn: () => ({
        ok: true,
        action: "pause",
        state_version: 4,
        state_path: "/tmp/control-state.json",
        state_action: "pause",
        state: {},
      }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.action, "pause");
    assert.equal(typeof result.state_version, "number");
    assert.equal(typeof result.state_path, "string");
    assert.ok(result.state_path.includes("control-state.json"));
    assert.equal(typeof result.state_action, "string");
  });

  it("emits canonical control_action_applied event", () => {
    const emitted = [];
    const result = runFactoryControlAction({
      action: "pause",
      factoryId: "test-factory",
      reason: "maintenance",
      actor: "operator",
      retryTarget: "goal-1462",
      runId: "run-control-1",
      emitDomainEventFn: (event) => emitted.push(event),
      applyControlActionFn: () => ({
        ok: true,
        action: "pause",
        state_version: 2,
        state_path: "/tmp/control-state.json",
        state_action: "pause",
        state: {},
      }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.canonical_events.length, 1);
    assert.equal(emitted[0].event_family, "factory.control.action_applied");
    assert.equal(emitted[0].payload.action, "pause");
    assert.equal(emitted[0].payload.retry_target, "goal-1462");
    assert.equal(emitted[0].payload.state_action, result.state_action);
  });

  it("routes control mutations through the canonical control projection owner", () => {
    const calls = [];
    const result = runFactoryControlAction({
      action: "pause",
      factoryId: "test-factory",
      reason: "maintenance",
      rootDir: "/tmp/factory",
      applyControlActionFn: (args) => {
        calls.push(args);
        return {
          ok: true,
          action: "pause",
          state_version: 7,
          state_path: "/tmp/factory/.hatch/factories/test-factory/control-state.json",
          state_action: "pause",
          state: {
            factory_id: "test-factory",
            version: 7,
          },
        };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].action, "pause");
    assert.equal(calls[0].factoryId, "test-factory");
    assert.equal(calls[0].reason, "maintenance");
    assert.equal(calls[0].rootDir, "/tmp/factory");
  });

  it("captures exception with code and message", () => {
    const result = runFactoryControlAction({
      action: "not-a-valid-action",
      factoryId: "test-factory",
      reason: "testing error",
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "invalid_action");
    assert.equal(typeof result.message, "string");
  });
});

describe("runFactoryControlStateRead", () => {
  it("returns missing_factory_id when factoryId is empty", () => {
    const result = runFactoryControlStateRead({});
    assert.equal(result.ok, false);
    assert.equal(result.error, "missing_factory_id");
  });

  it("returns missing_factory_id when factoryId is whitespace-only", () => {
    const result = runFactoryControlStateRead({ factoryId: "   " });
    assert.equal(result.ok, false);
    assert.equal(result.error, "missing_factory_id");
  });

  it("returns default state when no state file exists", () => {
    const result = runFactoryControlStateRead({
      factoryId: "test-factory",
      rootDir: "/tmp/factory",
      readControlStateFn: () => ({
        factory_id: "test-factory",
        state_path: "/tmp/control-state.json",
        version: 0,
      }),
    });
    assert.equal(result.factory_id, "test-factory");
    assert.equal(typeof result.state_path, "string");
    assert.ok(result.state_path.includes("control-state.json"));
    assert.equal(result.version, 0);
  });

  it("reads back state after a control action writes it", () => {
    const projection = {
      factory_id: "my-factory",
      version: 1,
      state_path: "/tmp/control-state.json",
    };
    const writeResult = runFactoryControlAction({
      action: "pause",
      factoryId: "my-factory",
      reason: "testing roundtrip",
      applyControlActionFn: () => ({
        ok: true,
        action: "pause",
        state_version: 1,
        state_path: projection.state_path,
        state_action: "pause",
        state: projection,
      }),
    });
    assert.equal(writeResult.ok, true);

    const readResult = runFactoryControlStateRead({
      factoryId: "my-factory",
      readControlStateFn: () => projection,
    });
    assert.equal(readResult.factory_id, "my-factory");
    assert.equal(readResult.version, 1);
    assert.equal(typeof readResult.state_path, "string");
  });

  it("reads control state from the canonical projection owner", () => {
    const calls = [];
    const result = runFactoryControlStateRead({
      factoryId: "test-factory",
      rootDir: "/tmp/factory",
      readControlStateFn: (args) => {
        calls.push(args);
        return {
          factory_id: "test-factory",
          version: 9,
          reason: "canonical pause",
          retry_target: "",
          action_state: {
            pause: { active: true },
            quarantine: { active: false },
            draining: { active: false },
            retry: { active: false },
            unblock: { active: false },
            resume: { active: false },
          },
          state_path: "/tmp/factory/.hatch/factories/test-factory/control-state.json",
        };
      },
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].factoryId, "test-factory");
    assert.equal(calls[0].rootDir, "/tmp/factory");
    assert.equal(result.version, 9);
    assert.equal(result.reason, "canonical pause");
    assert.equal(result.action_state.pause.active, true);
  });
});
