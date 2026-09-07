import assert from "node:assert/strict";
import test from "node:test";

import { computeArtifactLabelRepairs } from "../../src/commands/supervisor-sanitize-artifact-labels.ts";

test("computeArtifactLabelRepairs finds artifact issues missing artifacts label", () => {
  const out = computeArtifactLabelRepairs([
    { number: 1, title: "[artifact] x", labels: [] },
    { number: 2, title: "[artifact] y", labels: [{ name: "artifacts" }] },
    { number: 3, title: "Goal: z", labels: [] },
  ]);
  assert.deepEqual(out, [1]);
});
