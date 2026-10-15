import { buildScenarioArgs } from "./external-lifecycle.fixture.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  runExternalFactoryLifecycleGate,
} from "../../src/commands/supervisor-external-factory-lifecycle.ts";

const machine = JSON.parse(readFileSync("packages/factory-ops/test/supervisor/fixtures/state-machines/external-factory-lifecycle.machine.json", "utf8"));


function tupleKey({ lifecycle_state, resume_allowed, reason }) {
  return `${lifecycle_state}|${resume_allowed ? "true" : "false"}|${reason}`;
}

const allowedTupleKeys = new Set(
  (machine.states || []).flatMap((state) =>
    (state.reason_codes || []).map((reason) =>
      tupleKey({
        lifecycle_state: state.lifecycle_state,
        resume_allowed: state.resume_allowed,
        reason,
      }))),
);



test("external-factory lifecycle convergence contract enforces allowed tuples and terminal-state guards", async (t) => {
  let rejectedUpstreamChecks = 0;
  let restartFailedChecks = 0;
  let readyToResumeChecks = 0;

  for (const scenario of machine.scenarios || []) {
    await t.test(scenario.id, async () => {
      const out = await runExternalFactoryLifecycleGate(buildScenarioArgs(scenario));
      const tuple = {
        lifecycle_state: out.lifecycle_state,
        resume_allowed: out.resume_allowed,
        reason: out.reason,
      };
      const key = tupleKey(tuple);

      assert.ok(
        allowedTupleKeys.has(key),
        `Scenario '${scenario.id}' emitted tuple not declared by machine contract: ${JSON.stringify(tuple)}`,
      );

      if (tuple.resume_allowed === true) {
        readyToResumeChecks += 1;
        assert.equal(
          tuple.lifecycle_state,
          "ready_to_resume",
          `Scenario '${scenario.id}' emitted resume_allowed=true outside ready_to_resume: ${JSON.stringify(tuple)}`,
        );
      }

      if (tuple.lifecycle_state === "rejected_upstream") {
        rejectedUpstreamChecks += 1;
        assert.equal(
          tuple.resume_allowed,
          false,
          `Scenario '${scenario.id}' violated rejected_upstream terminal guard: ${JSON.stringify(tuple)}`,
        );
      }

      if (tuple.lifecycle_state === "restart_failed") {
        restartFailedChecks += 1;
        assert.equal(
          tuple.resume_allowed,
          false,
          `Scenario '${scenario.id}' violated restart_failed terminal guard: ${JSON.stringify(tuple)}`,
        );
      }
    });
  }

  assert.ok(readyToResumeChecks > 0, "Convergence fixture must exercise ready_to_resume scenarios");
  assert.ok(rejectedUpstreamChecks > 0, "Convergence fixture must exercise rejected_upstream scenarios");
  assert.ok(restartFailedChecks > 0, "Convergence fixture must exercise restart_failed scenarios");
});
