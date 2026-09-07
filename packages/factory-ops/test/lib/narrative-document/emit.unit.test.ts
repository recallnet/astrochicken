import assert from "node:assert/strict";
import test from "node:test";

import { emitNarrativeDocument } from "../../../src/lib/narrative-document/index.ts";

function baseDocument() {
  return {
    title: "Daily Lens Narrative",
    sections: [
      {
        heading: "What changed",
        body: "Delivery stabilized after tightening quality gates.",
      },
    ],
    metadata: {
      taxonomy: ["delivery"],
    },
  };
}

test("emitNarrativeDocument returns validated document JSON, markdown, and normalized metadata", () => {
  const out = emitNarrativeDocument({
    document: baseDocument(),
    metadata: {
      summary: "Lens narrative for shipped delivery changes.",
      category: "delivery",
      published_on: "2026-03-20",
      tags: ["daily-lens", "contract"],
      topics: ["delivery"],
    },
    astroContext: {
      canonical_issue: "https://github.com/recallnet/astrochicken/issues/2366",
      publishable: true,
      contains_internal_only: false,
      internal_only_sections: ["Operator Notes"],
    },
    outputPath: "reports/lens/2026-03-20.md",
  });

  assert.equal(out.documentJson.title, "Daily Lens Narrative");
  assert.equal(out.documentJson.sections.length, 1);
  assert.equal(out.documentJson.astrochicken.backlinks.canonical_issue, "https://github.com/recallnet/astrochicken/issues/2366");
  assert.equal(out.documentJson.astrochicken.privacy.publishable, true);

  assert.equal(out.metadata.title, "Daily Lens Narrative");
  assert.equal(out.metadata.category, "delivery");
  assert.equal(out.metadata.astro.canonical_issue_url, "https://github.com/recallnet/astrochicken/issues/2366");
  assert.equal(out.metadata.astro.visibility, "public");
  assert.deepEqual(out.metadata.astro.internal_only_sections, ["Operator Notes"]);

  assert.match(out.markdown, /^---/);
  assert.match(out.markdown, /# Daily Lens Narrative/);
  assert.equal(out.outputPath, "reports/lens/2026-03-20.md");
});

test("emitNarrativeDocument fails closed when narrative document contract is invalid", () => {
  const invalidDocument = baseDocument();
  invalidDocument.sections = [{ heading: "", body: "Body still present" }];

  assert.throws(
    () => emitNarrativeDocument({
      document: invalidDocument,
      metadata: {
        summary: "Contract enforcement check.",
        category: "delivery",
      },
      astroContext: {
        canonical_issue: "https://github.com/recallnet/astrochicken/issues/2366",
        publishable: true,
        contains_internal_only: false,
      },
    }),
    /narrative_document\.sections\.entry\.heading:missing/,
  );
});

test("emitNarrativeDocument rejects taxonomy values outside the allowlist", () => {
  const invalidTaxonomyDocument = baseDocument();
  invalidTaxonomyDocument.metadata.taxonomy = ["delivery", "discovery"];

  assert.throws(
    () => emitNarrativeDocument({
      document: invalidTaxonomyDocument,
      metadata: {
        summary: "Taxonomy enforcement check.",
        category: "delivery",
      },
      astroContext: {
        canonical_issue: "https://github.com/recallnet/astrochicken/issues/2366",
        publishable: true,
        contains_internal_only: false,
      },
    }),
    /narrative_taxonomy_invalid:discovery/,
  );
});

test("emitNarrativeDocument surfaces metadata contract errors for missing canonical backlink/publishability", () => {
  try {
    emitNarrativeDocument({
      document: baseDocument(),
      metadata: {
        summary: "Metadata contract enforcement check.",
        category: "delivery",
      },
    });
    assert.fail("expected metadata contract validation error");
  } catch (error) {
    const message = String(error?.message || error);
    assert.match(message, /narrative_document_metadata_contract_invalid:/);
    assert.match(message, /metadata:astro:canonical_issue_url:invalid_url/);
    assert.match(message, /metadata:astro:visibility:invalid:/);
  }
});
