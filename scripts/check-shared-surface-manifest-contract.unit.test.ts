import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildSharedSurfaceManifestSnapshot,
  validateSharedSurfaceManifestContract,
} from "./check-shared-surface-manifest-contract.ts";

test("buildSharedSurfaceManifestSnapshot is deterministic and sorted", () => {
  const snapshot = buildSharedSurfaceManifestSnapshot();
  const ids = snapshot.surfaces.map((surface) => surface.id);
  const sortedIds = [...ids].sort((left, right) => left.localeCompare(right, "en"));

  assert.equal(snapshot.schemaVersion, "hatch.shared-surface-manifest.v1");
  assert.equal(snapshot.generatedAt, "static");
  assert.deepEqual(ids, sortedIds);
});

test("docs/contracts/shared-surface-manifest.json is in sync with live manifest", () => {
  const drift = validateSharedSurfaceManifestContract({
    snapshotPath: "docs/contracts/shared-surface-manifest.json",
  });

  assert.deepEqual(drift, [], `Snapshot drift detected: ${JSON.stringify(drift)}`);
});

test("validateSharedSurfaceManifestContract reports unexpected surface drift", () => {
  const dir = mkdtempSync(join(tmpdir(), "shared-surface-manifest-"));
  const snapshotPath = join(dir, "shared-surface-manifest.json");
  const snapshot = buildSharedSurfaceManifestSnapshot();
  snapshot.surfaces = [
    {
      id: "unexpected_surface",
      description: "drift fixture",
      templatePath: "factories/_shared/surfaces/graphs/unexpected.dot.template",
      platformVersion: 1,
      contract: {
        requiredContextKeys: ["factory_id"],
        exportKeys: [],
        requiredSkillPaths: ["roles.stylesheet"],
      },
    },
  ];

  writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));

  const drift = validateSharedSurfaceManifestContract({ snapshotPath });
  assert.equal(drift.some((entry) => entry === "surface_unexpected id=unexpected_surface"), true);
});
