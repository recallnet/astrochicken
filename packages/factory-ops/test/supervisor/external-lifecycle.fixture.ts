import assert from "node:assert/strict";

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function unexpectedStub(scenarioId, stubName) {
  return () => {
    throw new Error(`Scenario '${scenarioId}' unexpectedly invoked ${stubName}`);
  };
}

export function buildScenarioArgs(scenario) {
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

export function readInactiveControlState() {
  return {
    action_state: {
      pause: { active: false },
      quarantine: { active: false },
      retry: { active: false },
      unblock: { active: false },
      resume: { active: false },
    },
  };
}

export function assertStableLifecycle(out, { lifecycle_state, resume_allowed, reason }) {
  assert.deepEqual(
    {
      lifecycle_state: out.lifecycle_state,
      resume_allowed: out.resume_allowed,
      reason: out.reason,
    },
    {
      lifecycle_state,
      resume_allowed,
      reason,
    },
  );
}

export const BASE_INPUT = Object.freeze({
  controlPlaneRepo: "recallnet/astrochicken",
  sourceRepo: "example/external-factory",
  sourceIssueNumber: 1504,
});

export const HOST_PATHS = Object.freeze({
  baseDir: "/tmp/host",
  logsDir: "/tmp/host/logs",
  runsDir: "/tmp/host/runs",
  tmpDir: "/tmp/host/tmp",
  socketDir: "/tmp/host/sockets",
  pidDir: "/tmp/host/pid",
  pidFile: "/tmp/host/pid/factory-daemon.pid",
  lockDir: "/tmp/host/pid/factory-daemon.lock",
});
