import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const GRAPH_EXPECTATIONS = [
  // triage.dot removed (triage pipeline eliminated)
  // mothership wave_dispatch.dot and wave_execute.dot deleted (Phase 3+4: goal-scoped execution)
  ["docs/contracts/workflow-ir/capability-wave-dispatch/wave_dispatch.dot", /action_id="labels\.ensure_factory"/],
];

for (const [graphPath, pattern] of GRAPH_EXPECTATIONS) {
  test(`${graphPath} provisions labels through the shared label contract`, () => {
    const dot = readFileSync(graphPath, "utf8");
    assert.match(dot, pattern);
    assert.doesNotMatch(dot, /gh label create /);
  });
}
