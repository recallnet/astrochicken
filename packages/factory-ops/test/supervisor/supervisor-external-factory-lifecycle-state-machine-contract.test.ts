import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  EXTERNAL_LIFECYCLE_REASON,
  LIFECYCLE_STATE,
  LIFECYCLE_STATES,
  runExternalFactoryLifecycleGate,
} from "../../src/commands/supervisor-external-factory-lifecycle.ts";

const machine = JSON.parse(readFileSync("packages/factory-ops/test/supervisor/fixtures/state-machines/external-factory-lifecycle.machine.json", "utf8"));
const stateById = new Map((machine.states || []).map((state) => [state.id, state]));

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function stableTuple(out) {
  return {
    lifecycle_state: out.lifecycle_state,
    resume_allowed: out.resume_allowed,
    reason: out.reason,
  };
}

function tupleKey(tuple) {
  return `${tuple.lifecycle_state}|${tuple.resume_allowed ? "true" : "false"}|${tuple.reason}`;
}

const allowedTupleKeys = new Set(
  (machine.states || []).flatMap((state) =>
    (state.reason_codes || []).map((reason) => tupleKey({
      lifecycle_state: state.lifecycle_state,
      resume_allowed: state.resume_allowed,
      reason,
    }))),
);

function assertTupleAllowed(tuple, scenarioId) {
  assert.ok(
    allowedTupleKeys.has(tupleKey(tuple)),
    `Scenario '${scenarioId}' produced tuple not declared in machine contract: ${JSON.stringify(tuple)}`,
  );
}

function unexpectedStub(scenarioId, stubName) {
  return () => {
    throw new Error(`Scenario '${scenarioId}' unexpectedly invoked ${stubName}`);
  };
}

function buildScenarioArgs(scenario) {
  const stubs = scenario.stubs || {};

  return {
    ...clone(scenario.input || {}),
    ensureResumeReadyFn: stubs.ensure_resume_ready
      ? () => clone(stubs.ensure_resume_ready)
      : unexpectedStub(scenario.id, "ensureResumeReadyFn"),
    resolveHostPathsFn: stubs.resolve_host_paths
      ? () => clone(stubs.resolve_host_paths)
      : unexpectedStub(scenario.id, "resolveHostPathsFn"),
    hostRestartFn: stubs.host_restart
      ? async () => clone(stubs.host_restart)
      : async () => unexpectedStub(scenario.id, "hostRestartFn")(),
    hostHealthFn: stubs.host_health
      ? () => clone(stubs.host_health)
      : unexpectedStub(scenario.id, "hostHealthFn"),
    readExternalFactoryControlStateFn: stubs.read_control_state
      ? () => clone(stubs.read_control_state)
      : () => ({ action_state: {} }),
  };
}

test("external-factory lifecycle machine fixture schema + reason coverage are stable", () => {
  assert.equal(machine.schema_version, "external_factory_lifecycle_machine/v1");
  assert.equal(Array.isArray(machine.states), true);
  assert.equal(Array.isArray(machine.transitions), true);
  assert.equal(Array.isArray(machine.scenarios), true);

  for (const transition of machine.transitions) {
    assert.ok(stateById.has(transition.from), `Unknown transition.from state '${transition.from}'`);
    assert.ok(stateById.has(transition.to), `Unknown transition.to state '${transition.to}'`);
  }

  const machineReasons = [...new Set((machine.states || []).flatMap((state) => state.reason_codes || []))].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
  const exportedReasons = Object.values(EXTERNAL_LIFECYCLE_REASON).sort((left, right) => left.localeCompare(right, "en"));
  assert.deepEqual(machineReasons, exportedReasons);

  const machineLifecycleStates = [...new Set((machine.states || []).map((state) => state.lifecycle_state || "").filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, "en"));
  const exportedLifecycleStates = [...LIFECYCLE_STATES].sort((left, right) => left.localeCompare(right, "en"));
  assert.deepEqual(machineLifecycleStates, exportedLifecycleStates);
  assert.equal(Object.values(LIFECYCLE_STATE).length, LIFECYCLE_STATES.length);
  assert.deepEqual(
    Object.values(LIFECYCLE_STATE).sort((left, right) => left.localeCompare(right, "en")),
    exportedLifecycleStates,
  );
});

test("external-factory lifecycle scenarios produce only declared stable tuples", async (t) => {
  for (const scenario of machine.scenarios || []) {
    await t.test(scenario.id, async () => {
      const state = stateById.get(scenario.state);
      assert.ok(state, `Scenario '${scenario.id}' references unknown state '${scenario.state}'`);

      const out = await runExternalFactoryLifecycleGate(buildScenarioArgs(scenario));
      const tuple = stableTuple(out);

      assert.deepEqual(tuple, scenario.expected);
      assert.equal(tuple.lifecycle_state, state.lifecycle_state);
      assert.equal(tuple.resume_allowed, state.resume_allowed);
      assert.equal((state.reason_codes || []).includes(tuple.reason), true);
      assertTupleAllowed(tuple, scenario.id);
    });
  }
});

test("external-factory lifecycle tuple guard rejects unknown reason/state pairs", () => {
  assert.throws(
    () => assertTupleAllowed({
      lifecycle_state: "ready_to_resume",
      resume_allowed: false,
      reason: EXTERNAL_LIFECYCLE_REASON.READY_TO_RESUME,
    }, "synthetic_unknown_tuple"),
    /produced tuple not declared in machine contract/,
  );
});
