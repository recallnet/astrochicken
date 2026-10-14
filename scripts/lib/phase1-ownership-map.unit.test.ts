import { createPhase1OwnershipFixture } from "../test/helpers/phase1-ownership-fixture.ts";
import assert from "node:assert/strict";
import test from "node:test";

import { analyzePhase1OwnershipArtifacts, buildPhase1OwnershipAudit, renderPhase1OwnershipMarkdown } from "./phase1-ownership-map.ts";

test("buildPhase1OwnershipAudit succeeds for exactly owned active and legacy targets", () => {
  const fixture = createPhase1OwnershipFixture();
  const audit = buildPhase1OwnershipAudit({ ...fixture });
  assert.equal(audit.ok, true);
  assert.equal(audit.summary.active_targets, 3);
  assert.equal(audit.summary.legacy_targets, 1);
  assert.deepEqual(audit.diagnostics, []);
  assert.match(renderPhase1OwnershipMarkdown(audit), /Phase 1 Ownership Map/);
});

test("buildPhase1OwnershipAudit fails on unowned active targets", () => {
  const fixture = createPhase1OwnershipFixture();
  const audit = buildPhase1OwnershipAudit({ ...fixture, ownershipMap: { ...fixture.ownershipMap, active_violation_owners: fixture.ownershipMap.active_violation_owners.slice(1) } });
  assert.equal(audit.ok, false);
  assert.match(audit.diagnostics.join("\n"), /unowned_active_surface_violation/);
});

test("analyzePhase1OwnershipArtifacts reports markdown drift", () => {
  const fixture = createPhase1OwnershipFixture();
  const analysis = analyzePhase1OwnershipArtifacts({ ...fixture, expectedMarkdown: "# stale\n" });
  assert.equal(analysis.ok, false);
  assert.match(analysis.diagnostics.join("\n"), /phase1_ownership_markdown_drift/);
});

test("buildPhase1OwnershipAudit accepts zero-backlog completion state", () => {
  const fixture = createPhase1OwnershipFixture({ completed: true });
  const audit = buildPhase1OwnershipAudit({ ...fixture });

  assert.equal(audit.ok, true);
  assert.equal(audit.summary.active_targets, 0);
  assert.equal(audit.summary.legacy_targets, 0);
  assert.deepEqual(audit.diagnostics, []);
});
