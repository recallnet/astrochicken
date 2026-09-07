import assert from "node:assert/strict";
import test from "node:test";

import {
  PUBLISH_MODES,
  TAXONOMY_CATEGORIES,
  validateNarrativeDocument,
} from "../../src/lib/narrative-document-contract.ts";

function makeValidMetadata() {
  return {
    title: "Release narrative parity",
    summary: "Narrative producer emitted a governed document alongside issue publication.",
    category: "delivery",
    published_on: "2026-03-21",
    tags: ["release-report", "factory-ops"],
    topics: ["recallnet/astrochicken", "mothership"],
    astro: {
      canonical_issue_url: "https://github.com/recallnet/astrochicken/issues/2522",
      visibility: "public",
      internal_only_sections: [],
    },
  };
}

test("narrative producer contract: valid metadata passes taxonomy/backlink/publishability checks", () => {
  const metadata = makeValidMetadata();
  const result = validateNarrativeDocument(metadata);

  assert.equal(result.ok, true, JSON.stringify(result, null, 2));
  assert.deepEqual(result.errors, []);
  assert.equal(result.warnings.length, 0);
  assert.ok(TAXONOMY_CATEGORIES.includes(metadata.category));
  assert.ok(PUBLISH_MODES.includes(metadata.astro.visibility));
  assert.equal(metadata.astro.canonical_issue_url, "https://github.com/recallnet/astrochicken/issues/2522");
});

test("narrative producer contract: invalid taxonomy category fails deterministically", () => {
  const metadata = makeValidMetadata();
  metadata.category = "discovery";

  const result = validateNarrativeDocument(metadata);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("metadata:category:invalid:discovery"));
});

test("narrative producer contract: invalid visibility fails publishability allowlist", () => {
  const metadata = makeValidMetadata();
  metadata.astro.visibility = "private";

  const result = validateNarrativeDocument(metadata);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("metadata:astro:visibility:invalid:private"));
});
