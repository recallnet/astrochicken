#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

import { main } from "./lib/check-harness.ts";
import {
  FACTORY_SHARED_SURFACE_MANIFEST,
  SHARED_SURFACE_MANIFEST_SCHEMA_VERSION,
} from "./lib/factory-shared-surface-manifest.ts";

export const SHARED_SURFACE_MANIFEST_SNAPSHOT_PATH = "docs/contracts/shared-surface-manifest.json";

function stringify(value) {
  return JSON.stringify(value);
}

function surfaceIds(surfaces) {
  return surfaces.map((surface) => surface.id);
}

function compareSurfaceField({ drift, expected, actual, field }) {
  if (stringify(expected[field]) === stringify(actual[field])) {
    return;
  }
  drift.push(`surface_field_drift id=${expected.id} field=${field}`);
}

function compareSurfaces(expectedSurfaces, actualSurfaces) {
  const drift = [];
  if (!Array.isArray(actualSurfaces)) {
    return ["manifest_field_drift field=surfaces expected=array actual=non_array"];
  }

  const expectedById = new Map(expectedSurfaces.map((surface) => [surface.id, surface]));
  const actualById = new Map(actualSurfaces.map((surface) => [surface.id, surface]));

  for (const expected of expectedSurfaces) {
    const actual = actualById.get(expected.id);
    if (!actual) {
      drift.push(`surface_missing id=${expected.id}`);
      continue;
    }

    compareSurfaceField({ drift, expected, actual, field: "description" });
    compareSurfaceField({ drift, expected, actual, field: "templatePath" });
    compareSurfaceField({ drift, expected, actual, field: "platformVersion" });
    compareSurfaceField({ drift, expected, actual, field: "contract" });
  }

  for (const actual of actualSurfaces) {
    if (!expectedById.has(actual.id)) {
      drift.push(`surface_unexpected id=${actual.id}`);
    }
  }

  const expectedOrder = surfaceIds(expectedSurfaces);
  const actualOrder = surfaceIds(actualSurfaces);
  if (stringify(expectedOrder) !== stringify(actualOrder)) {
    drift.push("surface_order_drift");
  }

  return drift;
}

export function buildSharedSurfaceManifestSnapshot() {
  const surfaces = [...FACTORY_SHARED_SURFACE_MANIFEST]
    .map(({ id, description, templatePath, platformVersion, contract }) => ({
      id,
      description,
      templatePath,
      platformVersion,
      contract,
    }))
    .sort((left, right) => left.id.localeCompare(right.id, "en"));

  return {
    schemaVersion: SHARED_SURFACE_MANIFEST_SCHEMA_VERSION,
    generatedAt: "static",
    surfaces,
  };
}

function writeSnapshot(snapshotPath) {
  const snapshot = buildSharedSurfaceManifestSnapshot();
  writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
}

export function validateSharedSurfaceManifestContract({ snapshotPath = SHARED_SURFACE_MANIFEST_SNAPSHOT_PATH } = {}) {
  const expected = buildSharedSurfaceManifestSnapshot();
  const actual = JSON.parse(readFileSync(snapshotPath, "utf8"));
  const drift = [];

  if (stringify(actual?.schemaVersion) !== stringify(expected.schemaVersion)) {
    drift.push("manifest_field_drift field=schemaVersion");
  }

  if (stringify(actual?.generatedAt) !== stringify(expected.generatedAt)) {
    drift.push("manifest_field_drift field=generatedAt");
  }

  return drift.concat(compareSurfaces(expected.surfaces, actual?.surfaces));
}

function usage() {
  return "Usage: node scripts/check-shared-surface-manifest-contract.ts [--snapshot-path <path>] [--update-snapshot]";
}

function checkSharedSurfaceManifestContract(args = {}) {
  const snapshotPath = args.snapshotPath || SHARED_SURFACE_MANIFEST_SNAPSHOT_PATH;

  if (args.updateSnapshot) {
    writeSnapshot(snapshotPath);
    return {
      ok: true,
      diagnostics: [],
      mode: "update_snapshot",
      snapshotPath,
    };
  }

  const drift = validateSharedSurfaceManifestContract({ snapshotPath });
  return {
    ok: drift.length === 0,
    diagnostics: drift,
  };
}

const isEntryPoint = process.argv[1]
  ? new URL(`file://${process.argv[1]}`).href === import.meta.url
  : false;

if (isEntryPoint) {
  main(checkSharedSurfaceManifestContract, {
    gate: "shared-surface-manifest-contract",
    usage,
    argSchema: [
      { flag: "--snapshot-path", type: "string" },
      { flag: "--update-snapshot", type: "boolean" },
    ],
  });
}
