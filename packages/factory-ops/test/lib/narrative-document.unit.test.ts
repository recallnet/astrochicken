import assert from "node:assert/strict";
import test from "node:test";

import {
  assertNarrativeDocumentContract,
  assertTaxonomyValue,
  getNarrativeTaxonomyAllowlist,
  matchesTaxonomy,
  parseNarrativeMarkdownDocument,
  serializeNarrativeDocumentToMarkdown,
} from "../../src/lib/narrative-document/index.ts";

function validNarrativeDocument() {
  return {
    title: "Release understanding report",
    abstract: "Summary before section detail.",
    sections: [
      {
        heading: "What Changed",
        body: "Release reporting moved from patch-level updates to a comprehension narrative.",
      },
    ],
    metadata: {
      taxonomy: ["delivery", "operations"],
      source: "release-narrator",
    },
    astrochicken: {
      backlinks: {
        canonical_issue: "https://github.com/recallnet/astrochicken/issues/2510",
        related_issues: ["https://github.com/recallnet/astrochicken/issues/2366"],
      },
      privacy: {
        publishable: true,
        contains_internal_only: false,
      },
      internal_note: "Internal-only implementation details withheld from public version.",
    },
  };
}

test("taxonomy helpers enforce the fixed five-entry allowlist", () => {
  const allowlist = getNarrativeTaxonomyAllowlist();
  assert.deepEqual(allowlist, ["factory-health", "delivery", "quality", "operations", "strategy"]);

  for (const value of allowlist) {
    assert.equal(matchesTaxonomy(value), true);
    assert.equal(assertTaxonomyValue(value), value);
  }

  assert.equal(matchesTaxonomy("novel-topic"), false);
  assert.throws(() => assertTaxonomyValue("novel-topic"), /narrative_taxonomy_invalid:novel-topic/);
});

test("assertNarrativeDocumentContract accepts a valid narrative document", () => {
  const value = validNarrativeDocument();
  const out = assertNarrativeDocumentContract(value);
  assert.equal(out.title, value.title);
});

test("assertNarrativeDocumentContract rejects non-allowlisted taxonomy values", () => {
  const value = validNarrativeDocument();
  value.metadata.taxonomy = ["delivery", "new-category"];

  assert.throws(
    () => assertNarrativeDocumentContract(value),
    /narrative_taxonomy_invalid:new-category/,
  );
});

test("assertNarrativeDocumentContract fails closed on unknown AstroChicken extension keys", () => {
  const value = validNarrativeDocument();
  value.astrochicken.unapproved = "nope";

  assert.throws(
    () => assertNarrativeDocumentContract(value),
    /narrative_document\.astrochicken:unknown_key:unapproved/,
  );
});

test("markdown helpers round-trip markdown-style payloads and contract enforces required fields", () => {
  const value = validNarrativeDocument();
  const markdown = serializeNarrativeDocumentToMarkdown(value);
  const parsed = parseNarrativeMarkdownDocument(markdown);

  const merged = {
    ...parsed,
    metadata: {
      ...parsed.metadata,
      taxonomy: ["delivery"],
    },
    astrochicken: value.astrochicken,
  };

  const out = assertNarrativeDocumentContract(merged);
  assert.equal(out.sections.length, 1);
  assert.equal(out.sections[0].heading, "What Changed");

  const missingFields = {
    title: "Missing sections",
    metadata: { taxonomy: ["delivery"] },
  };

  assert.throws(
    () => assertNarrativeDocumentContract(missingFields),
    /narrative_document:missing_required:sections/,
  );
});
