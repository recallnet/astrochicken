# Narrative document contract

This module defines the shared narrative document shape used by Daily Lens and release narration so AstroChicken can stay on a common markdown/MDX-style format.

## Core shape

`assertNarrativeDocumentContract(document)` validates:

- `title` (required string)
- `sections` (required non-empty array of `{ heading, body }`)
- `metadata` (required object)
  - `metadata.taxonomy` (required; value or array of values from the allowlist)
- optional `astrochicken` extension object

## Fixed taxonomy allowlist

Authoritative source: `config/narrative/taxonomy-allowlist.json`

Allowed values (only):

- `factory-health`
- `delivery`
- `quality`
- `operations`
- `strategy`

Use `matchesTaxonomy(value)` / `assertTaxonomyValue(value)` from `taxonomy.mjs` for runtime checks.

## AstroChicken extension boundary

Only these top-level extension keys are allowed under `astrochicken`:

- `backlinks`
  - `canonical_issue`
  - `related_issues`
  - `related_prs`
- `privacy`
  - `publishable`
  - `contains_internal_only`
- `internal_note`

Unknown extension keys fail closed.

## Markdown helpers

`markdown-shape.mjs` exposes helpers for markdown/MDX-style transport:

- `parseNarrativeMarkdownDocument(markdown)`
- `serializeNarrativeDocumentToMarkdown(document)`

## Shared emission helper

`emit.mjs` exports `emitNarrativeDocument({ document, metadata, astroContext, outputPath })`.

The helper is deterministic and fail-closed:

1. Normalizes a canonical narrative document payload (`title`, `sections`, `metadata`, optional `astrochicken`).
2. Validates full document shape via `assertNarrativeDocumentContract`.
3. Validates taxonomy values against `TAXONOMY_ALLOWLIST_PATH` via `assertTaxonomyValue` / `matchesTaxonomy`.
4. Maps canonical backlink + publishability context into metadata contract fields.
5. Validates metadata contract semantics (`title`, `summary`, taxonomy category, `astro.canonical_issue_url`, `astro.visibility`) via `validateNarrativeDocument`.
6. Serializes markdown via `serializeNarrativeDocumentToMarkdown`.

On success it returns:

- `documentJson` (validated narrative document object)
- `markdown` (deterministic serialized markdown)
- `metadata` (normalized metadata contract object)
- optional `outputPath` echo when provided

On failure it throws deterministic validator errors from the underlying contracts (for example taxonomy, backlink, or publishability violations).
