import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  evaluateManagedControlGate,
  evaluateManagedControlStateGate,
} from "../../src/commands/supervisor-managed-control-gate.ts";

describe("evaluateManagedControlGate", () => {
  it("pause action returns paused gate with should_run false", () => {
    const result = evaluateManagedControlGate({ stateAction: "pause", reason: "maintenance" });
    assert.equal(result.control_gate, "paused");
    assert.equal(result.should_run, "false");
    assert.equal(result.control_state_action, "pause");
    assert.equal(result.control_state_reason, "maintenance");
  });

  it("quarantine action returns paused gate with should_run false", () => {
    const result = evaluateManagedControlGate({ stateAction: "quarantine", reason: "bad deploy" });
    assert.equal(result.control_gate, "paused");
    assert.equal(result.should_run, "false");
    assert.equal(result.control_state_action, "quarantine");
    assert.equal(result.control_state_reason, "bad deploy");
  });

  it("draining action returns draining gate with should_run false", () => {
    const result = evaluateManagedControlGate({ stateAction: "draining", reason: "shutting down" });
    assert.equal(result.control_gate, "draining");
    assert.equal(result.should_run, "false");
    assert.equal(result.control_state_action, "draining");
    assert.equal(result.control_state_reason, "shutting down");
  });

  it("empty/no action returns run gate with should_run true and action none", () => {
    const result = evaluateManagedControlGate({});
    assert.equal(result.control_gate, "run");
    assert.equal(result.should_run, "true");
    assert.equal(result.control_state_action, "none");
    assert.equal(result.control_state_reason, "");
  });

  it("no arguments defaults to run gate", () => {
    const result = evaluateManagedControlGate();
    assert.equal(result.control_gate, "run");
    assert.equal(result.should_run, "true");
    assert.equal(result.control_state_action, "none");
  });

  it("run action returns run gate with action preserved", () => {
    const result = evaluateManagedControlGate({ stateAction: "run" });
    assert.equal(result.control_gate, "run");
    assert.equal(result.should_run, "true");
    assert.equal(result.control_state_action, "run");
  });

  it("unknown action falls through to run gate", () => {
    const result = evaluateManagedControlGate({ stateAction: "something_unknown" });
    assert.equal(result.control_gate, "run");
    assert.equal(result.should_run, "true");
    assert.equal(result.control_state_action, "something_unknown");
  });

  it("reason is preserved in output", () => {
    const result = evaluateManagedControlGate({ stateAction: "pause", reason: "scheduled maintenance window" });
    assert.equal(result.control_state_reason, "scheduled maintenance window");
  });

  it("action is case insensitive", () => {
    const result = evaluateManagedControlGate({ stateAction: "PAUSE" });
    assert.equal(result.control_gate, "paused");
    assert.equal(result.control_state_action, "pause");
    assert.equal(result.should_run, "false");
  });

  it("action is whitespace trimmed", () => {
    const result = evaluateManagedControlGate({ stateAction: "  pause  " });
    assert.equal(result.control_gate, "paused");
    assert.equal(result.control_state_action, "pause");
    assert.equal(result.should_run, "false");
  });
});

describe("evaluateManagedControlStateGate", () => {
  function makeReadControlStateFn(state) {
    return ({ factoryId, rootDir }) => state;
  }

  it("missing factoryId returns run gate with parse_error", () => {
    const result = evaluateManagedControlStateGate({ factoryId: "" });
    assert.equal(result.control_gate, "run");
    assert.equal(result.should_run, "true");
    assert.equal(result.parse_error, "missing_factory_id");
    assert.equal(result.state_path, "");
  });

  it("paused action_state produces paused gate", () => {
    const result = evaluateManagedControlStateGate({
      factoryId: "test-factory",
      readControlStateFn: makeReadControlStateFn({
        action_state: { pause: { active: true } },
        reason: "operator paused",
        state_path: "/tmp/control-state.json",
      }),
    });
    assert.equal(result.control_gate, "paused");
    assert.equal(result.should_run, "false");
    assert.equal(result.control_state_action, "pause");
    assert.equal(result.control_state_reason, "operator paused");
    assert.equal(result.parse_error, "");
    assert.equal(result.state_path, "/tmp/control-state.json");
  });

  it("no active action_state produces run gate", () => {
    const result = evaluateManagedControlStateGate({
      factoryId: "test-factory",
      readControlStateFn: makeReadControlStateFn({
        action_state: {},
        reason: "",
        state_path: "/tmp/control-state.json",
      }),
    });
    assert.equal(result.control_gate, "run");
    assert.equal(result.should_run, "true");
    assert.equal(result.control_state_action, "none");
    assert.equal(result.parse_error, "");
  });

  it("readControlStateFn throwing returns run gate with parse_error", () => {
    const result = evaluateManagedControlStateGate({
      factoryId: "test-factory",
      readControlStateFn: () => { throw new Error("file not found"); },
    });
    assert.equal(result.control_gate, "run");
    assert.equal(result.should_run, "true");
    assert.equal(result.parse_error, "file not found");
    assert.equal(result.state_path, "");
  });

  it("state_path is passed through from state", () => {
    const result = evaluateManagedControlStateGate({
      factoryId: "test-factory",
      readControlStateFn: makeReadControlStateFn({
        action_state: {},
        reason: "",
        state_path: "/custom/path/control-state.json",
      }),
    });
    assert.equal(result.state_path, "/custom/path/control-state.json");
  });

  it("quarantine action_state produces paused gate", () => {
    const result = evaluateManagedControlStateGate({
      factoryId: "test-factory",
      readControlStateFn: makeReadControlStateFn({
        action_state: { quarantine: { active: true } },
        reason: "quarantined for investigation",
        state_path: "/tmp/state.json",
      }),
    });
    assert.equal(result.control_gate, "paused");
    assert.equal(result.should_run, "false");
    assert.equal(result.control_state_action, "quarantine");
  });

  it("draining action_state produces draining gate", () => {
    const result = evaluateManagedControlStateGate({
      factoryId: "test-factory",
      readControlStateFn: makeReadControlStateFn({
        action_state: { draining: { active: true } },
        reason: "draining work",
        state_path: "/tmp/state.json",
      }),
    });
    assert.equal(result.control_gate, "draining");
    assert.equal(result.should_run, "false");
    assert.equal(result.control_state_action, "draining");
  });
});
