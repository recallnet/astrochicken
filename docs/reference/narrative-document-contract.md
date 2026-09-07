---
doc_type: "reference"
owner: "docs-stewards"
review_policy: "periodic-7"
reviewed: "2026-03-20"
status: "active"
summary: "Shared narrative document metadata contract and AstroChicken extension boundary for Daily Lens and release narration."
tags: [contract, docs, factory-ops, narrative]
written: "2026-03-20"
---

# Narrative Document Contract

AstroChicken narrative documents use markdown/MDX-style content with frontmatter metadata. The shared metadata shape is validated by:

- `packages/factory-ops/src/lib/narrative-document-contract.ts`

Use this module as the canonical contract owner whenever the shape changes.

## Document convention

Narrative content should follow a normal markdown pattern:

1. Frontmatter metadata
2. Prose body sections

The validator in this issue governs metadata only (not markdown section rendering).

## Metadata keys

### Required keys

- `title` (string, non-empty)
- `summary` (string, non-empty)
- `category` (string, must be one of the fixed taxonomy allowlist)

### Optional keys

- `published_on` (string)
- `tags` (array of strings; scalar values are normalized to one-element arrays)
- `topics` (array of strings; scalar values are normalized to one-element arrays)
- `astro` (AstroChicken extension object; see below)

Unknown root-level metadata keys fail validation.

## Fixed taxonomy allowlist

`category` is intentionally fail-closed to this set only:

- `factory-health`
- `delivery`
- `quality`
- `operations`
- `strategy`

Any new category requires a reviewed code/config change to `TAXONOMY_CATEGORIES`.

## AstroChicken extension boundary

The only supported `astro` keys are:

- `canonical_issue_url`
  - Canonical backlink to the issue that owns the narrative thread.
  - Must look like an `http(s)` URL.
- `visibility`
  - Publishability mode.
  - Allowed values: `public`, `internal-only`.
- `internal_only_sections`
  - Array of section names that must remain internal.
  - Must be an array of non-empty strings.

Unknown `astro` keys fail validation.

## Validator output shape

`validateNarrativeDocument(metadata)` returns:

- `ok` (boolean)
- `errors` (string[])
- `warnings` (string[])
- `metrics` (object)

This lets downstream commands report guardrail failures without guessing error structure.
