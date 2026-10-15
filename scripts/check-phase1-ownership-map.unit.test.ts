import { createPhase1OwnershipFixture } from "./test/helpers/phase1-ownership-fixture.ts";
import assert from "node:assert/strict";
import test from "node:test";

import { analyzePhase1OwnershipArtifacts } from "./lib/phase1-ownership-map.ts";

test("analyzePhase1OwnershipArtifacts succeeds when checked-in markdown matches", () => {
  const fixture = createPhase1OwnershipFixture();
  const first = analyzePhase1OwnershipArtifacts({ ...fixture });
  const second = analyzePhase1OwnershipArtifacts({ ...fixture, expectedMarkdown: first.rendered_markdown });
  assert.equal(second.ok, true);
  assert.deepEqual(second.diagnostics, []);
});

test("analyzePhase1OwnershipArtifacts succeeds for zero-backlog completion artifacts", () => {
  const fixture = createPhase1OwnershipFixture({ completed: true });
  const first = analyzePhase1OwnershipArtifacts({ ...fixture });
  const second = analyzePhase1OwnershipArtifacts({ ...fixture, expectedMarkdown: first.rendered_markdown });
  assert.equal(second.ok, true);
  assert.deepEqual(second.diagnostics, []);
});
