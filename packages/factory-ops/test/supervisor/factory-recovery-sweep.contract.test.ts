import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("factory supervisor tick runs deterministic recovery sweep before dispatch", () => {
  const dot = readFileSync("docs/contracts/workflow-ir/mothership/factory_supervisor_tick.dot", "utf8");
  // action_id="factory.recovery_sweep"
  assert.match(dot, /recovery_sweep_runtime\s*\[type="tool"/);
  assert.match(dot, /recovery_sweep_runtime[\s\S]*action_runtime="in_process" action_id="factory\.recovery_sweep"/);
  assert.match(dot, /action_apply="true"/);
});

test("ops CLI wires factory recovery-sweep command", () => {
  const cmd = readFileSync("packages/factory-ops/src/cli/commands/factory-control-cmds.ts", "utf8");
  assert.match(cmd, /static paths = \[\["factory", "recovery-sweep"\]\]/);
  assert.match(cmd, /reconcileRuntimeRecoverySweep/);
});
