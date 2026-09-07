import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ARCHIVED_DOC_GLOBS,
  ARCHIVED_DOC_GLOBS_DESCRIPTION,
  LIVE_DOC_ASSET_GLOBS,
  LIVE_DOC_ASSET_GLOBS_DESCRIPTION,
  LIVE_DOC_ASSET_MANIFEST_VERSION,
} from "./lib/live-doc-assets-manifest.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testDir, "..");
const publishedManifestPath = join(repoRoot, "docs", "contracts", "live-doc-assets.json");

function readPublishedManifest() {
  return JSON.parse(readFileSync(publishedManifestPath, "utf8"));
}

test("published live-doc asset manifest stays in sync with helper exports", () => {
  const manifest = readPublishedManifest();

  assert.equal(manifest.version, LIVE_DOC_ASSET_MANIFEST_VERSION);
  assert.equal(manifest.live_doc_asset_globs_description, LIVE_DOC_ASSET_GLOBS_DESCRIPTION);
  assert.equal(manifest.archived_doc_globs_description, ARCHIVED_DOC_GLOBS_DESCRIPTION);
  assert.deepEqual(manifest.live_doc_asset_globs, LIVE_DOC_ASSET_GLOBS);
  assert.deepEqual(manifest.archived_doc_globs, ARCHIVED_DOC_GLOBS);
  assert.equal(typeof manifest.rationale, "string");
  assert.ok(manifest.rationale.length > 0);
  assert.ok(Array.isArray(manifest.notes));
  assert.ok(manifest.notes.length > 0);
});
