import assert from "node:assert/strict";
import test from "node:test";

import {
  classifySupervisorFailure,
  deriveIncidentSeverity,
} from "../../src/commands/supervisor-failure-classifier.ts";

test("classifySupervisorFailure marks shared graph failures as platform", () => {
  const out = classifySupervisorFailure({
    bugType: "factory-cli-runtime-crash",
    sourceRepo: "example-org/example-notes",
    controlPlaneRepo: "recallnet/astrochicken",
    evidence: {
      crash_type: "module_not_found",
      pipeline: "factories/mothership/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs",
      node: "supervisor_state_snapshot",
      file_path: "packages/factory-ops/src/commands/supervisor-state-snapshot-actions.ts",
    },
  });

  assert.equal(out.classification, "platform");
  assert.equal(out.crash_type, "module_not_found");
  assert.equal(out.rationale, "path_signal");
});

test("classifySupervisorFailure marks managed-home failures as local", () => {
  const out = classifySupervisorFailure({
    bugType: "factory-cli-runtime-crash",
    sourceRepo: "acme/brainstorm",
    controlPlaneRepo: "recallnet/astrochicken",
    evidence: {
      crash_type: "runtime_module_error",
      file_path: "factories/brainstorm/workflows/dispatch-control/factory_supervisor_tick.workflow-source.mjs",
    },
  });

  assert.equal(out.classification, "local");
  assert.equal(out.crash_type, "runtime_module_error");
});

test("classifySupervisorFailure falls back to needs-triage when deterministic signals are missing", () => {
  const out = classifySupervisorFailure({
    bugType: "unknown-failure",
    sourceRepo: "",
    controlPlaneRepo: "",
    evidence: {
      crash_type: "",
    },
  });

  assert.equal(out.classification, "needs-triage");
  assert.equal(out.crash_type, "unknown");
  assert.equal(out.rationale, "insufficient_deterministic_signals");
});

test("deriveIncidentSeverity deterministically promotes blocking crash classes", () => {
  assert.equal(
    deriveIncidentSeverity({ classification: "platform", crashType: "module_not_found", bugType: "factory-cli-runtime-crash" }),
    "blocking",
  );
  assert.equal(
    deriveIncidentSeverity({ classification: "platform", crashType: "judge_failure", bugType: "wave-judge-failure" }),
    "degrading",
  );
  assert.equal(
    deriveIncidentSeverity({ classification: "local", crashType: "unknown", bugType: "misc" }),
    "informational",
  );
});

test("classifySupervisorFailure infers crash_type for managed-daemon-circuit-breaker without explicit crashType", () => {
  const out = classifySupervisorFailure({
    bugType: "managed-daemon-circuit-breaker",
    evidence: {
      factory_id: "brainstorm",
      consecutive_failures: 3,
      last_exit_code: 1,
    },
  });
  assert.notEqual(out.crash_type, "unknown", "managed-daemon-circuit-breaker must resolve to a known crash_type so incident emission succeeds");
  assert.equal(out.crash_type, "daemon_circuit_breaker");
});
