import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ASTRO_EXTENSION_KEYS,
  TAXONOMY_CATEGORIES,
  validateNarrativeDocument,
} from "../../src/lib/narrative-document-contract.ts";
import { assertNarrativeDocumentContract } from "../../src/lib/narrative-document/contract.ts";
import { getNarrativeTaxonomyAllowlist } from "../../src/lib/narrative-document/taxonomy.ts";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures/narrative");

function readFixture(name) {
  return JSON.parse(readFileSync(join(fixtureDir, name), "utf8"));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildNarrativeDocumentFromLensInsight(insight = {}) {
  const categories = Array.isArray(insight?.categories) && insight.categories.length > 0
    ? insight.categories
    : [String(insight?.category || "delivery").trim()].filter(Boolean);

  return {
    title: "Daily Lens Narrative Contract Check",
    sections: [{ heading: "Insight", body: String(insight?.recommendation || "No recommendation.") }],
    metadata: {
      taxonomy: categories,
    },
    astrochicken: {
      backlinks: {
        canonical_issue: "https://github.com/recallnet/astrochicken/issues/2366",
      },
      privacy: {
        publishable: true,
        contains_internal_only: false,
      },
    },
  };
}

test("validateNarrativeDocument locks fixed five-category allowlist and deterministic invalid-category errors", () => {
  assert.deepEqual(TAXONOMY_CATEGORIES, ["factory-health", "delivery", "quality", "operations", "strategy"]);

  const metadata = readFixture("metadata.valid.json");
  const ok = validateNarrativeDocument(metadata);
  assert.equal(ok.ok, true, JSON.stringify(ok, null, 2));
  assert.equal(ok.metrics.taxonomy_allowlist_size, TAXONOMY_CATEGORIES.length);

  const mutated = clone(metadata);
  mutated.category = "noise";
  const invalid = validateNarrativeDocument(mutated);
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.includes("metadata:category:invalid:noise"));
});

test("validateNarrativeDocument accepts documented astro extension keys and rejects extension_extra_key drift", () => {
  const metadata = readFixture("metadata.valid.json");
  assert.deepEqual(Object.keys(metadata.astro).sort(), [...ASTRO_EXTENSION_KEYS].sort());

  const ok = validateNarrativeDocument(metadata);
  assert.equal(ok.ok, true, JSON.stringify(ok, null, 2));

  const mutated = clone(metadata);
  mutated.astro.impossible_flag = true;
  const invalid = validateNarrativeDocument(mutated);
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.includes("metadata:astro:unknown_keys:impossible_flag"));
});

test("lens-derived narratives share taxonomy guardrails with narrative document contract", () => {
  const lensRaw = readFixture("lens-report.valid.json");
  const firstInsight = (lensRaw?.shaping_insights || [])[0] || {};

  const validLensNarrativeDocument = buildNarrativeDocumentFromLensInsight(firstInsight);
  assert.doesNotThrow(() => assertNarrativeDocumentContract(validLensNarrativeDocument));

  const mutatedInsight = clone(firstInsight);
  mutatedInsight.categories = ["discovery"];
  const invalidLensNarrativeDocument = buildNarrativeDocumentFromLensInsight(mutatedInsight);

  const writeLensArtifactsCalls = [];
  const guardedWriteLensArtifacts = () => {
    assertNarrativeDocumentContract(invalidLensNarrativeDocument);
    writeLensArtifactsCalls.push("called");
  };

  assert.throws(
    () => guardedWriteLensArtifacts(),
    /narrative_taxonomy_invalid:discovery/,
  );
  assert.equal(writeLensArtifactsCalls.length, 0);
});
