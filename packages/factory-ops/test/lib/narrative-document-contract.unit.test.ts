import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ASTRO_EXTENSION_KEYS,
  PUBLISH_MODES,
  TAXONOMY_CATEGORIES,
  normalizeNarrativeDocument,
  validateNarrativeDocument,
} from "../../src/lib/narrative-document-contract.ts";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/regressions/narrative-doc");

function readFixture(name) {
  return JSON.parse(readFileSync(join(fixtureDir, name), "utf8"));
}

test("validateNarrativeDocument accepts golden metadata with all allowed fields", () => {
  const metadata = readFixture("golden-metadata.json");
  const result = validateNarrativeDocument(metadata);

  assert.equal(result.ok, true, JSON.stringify(result, null, 2));
  assert.deepEqual(result.errors, []);
  assert.equal(result.metrics.has_astro_extension, true);
  assert.equal(result.metrics.normalized_internal_only_sections_count, 2);
});

test("normalizeNarrativeDocument trims strings and coerces arrays", () => {
  const metadata = {
    title: "  Release understanding  ",
    summary: "  Deterministic summary.  ",
    category: " delivery ",
    tags: " lens ",
    topics: ["  taxonomy  ", "", "contract"],
    astro: {
      canonical_issue_url: "  https://github.com/recallnet/astrochicken/issues/2511  ",
      visibility: " internal-only ",
      internal_only_sections: " Internal Notes ",
    },
  };

  const normalized = normalizeNarrativeDocument(metadata);
  assert.equal(normalized.title, "Release understanding");
  assert.equal(normalized.summary, "Deterministic summary.");
  assert.equal(normalized.category, "delivery");
  assert.deepEqual(normalized.tags, ["lens"]);
  assert.deepEqual(normalized.topics, ["taxonomy", "contract"]);
  assert.deepEqual(normalized.astro.internal_only_sections, ["Internal Notes"]);
});

test("validateNarrativeDocument rejects unknown category", () => {
  const metadata = readFixture("golden-metadata.json");
  metadata.category = "novel-topic";

  const result = validateNarrativeDocument(metadata);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("metadata:category:invalid:novel-topic"));
});

test("validateNarrativeDocument rejects unknown root key", () => {
  const metadata = {
    ...readFixture("golden-metadata.json"),
    extra: "nope",
  };

  const result = validateNarrativeDocument(metadata);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("metadata:unknown_keys:extra"));
});

test("validateNarrativeDocument rejects missing summary", () => {
  const metadata = readFixture("golden-metadata.json");
  delete metadata.summary;

  const result = validateNarrativeDocument(metadata);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("metadata:summary:required"));
});

test("validateNarrativeDocument rejects unknown Astro extension key", () => {
  const metadata = readFixture("golden-metadata.json");
  metadata.astro.unapproved = true;

  const result = validateNarrativeDocument(metadata);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("metadata:astro:unknown_keys:unapproved"));
});

test("validateNarrativeDocument rejects invalid publish visibility", () => {
  const metadata = readFixture("golden-metadata.json");
  metadata.astro.visibility = "private";

  const result = validateNarrativeDocument(metadata);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("metadata:astro:visibility:invalid:private"));
});

test("validateNarrativeDocument rejects non-string internal section names", () => {
  const metadata = readFixture("golden-metadata.json");
  metadata.astro.internal_only_sections = ["Internal Notes", 7];

  const result = validateNarrativeDocument(metadata);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("metadata:astro:internal_only_sections:invalid_entry:1"));
});

test("taxonomy and extension constants stay pinned, deduped, and string-only", () => {
  assert.deepEqual(TAXONOMY_CATEGORIES, ["factory-health", "delivery", "quality", "operations", "strategy"]);
  assert.equal(new Set(TAXONOMY_CATEGORIES).size, TAXONOMY_CATEGORIES.length);
  for (const value of TAXONOMY_CATEGORIES) {
    assert.equal(typeof value, "string");
    assert.ok(value.trim().length > 0);
  }

  assert.deepEqual(PUBLISH_MODES, ["public", "internal-only"]);
  assert.equal(new Set(PUBLISH_MODES).size, PUBLISH_MODES.length);
  for (const value of PUBLISH_MODES) {
    assert.equal(typeof value, "string");
    assert.ok(value.trim().length > 0);
  }

  assert.deepEqual(ASTRO_EXTENSION_KEYS, ["canonical_issue_url", "visibility", "internal_only_sections"]);
  assert.equal(new Set(ASTRO_EXTENSION_KEYS).size, ASTRO_EXTENSION_KEYS.length);
  for (const value of ASTRO_EXTENSION_KEYS) {
    assert.equal(typeof value, "string");
    assert.ok(value.trim().length > 0);
  }
});
