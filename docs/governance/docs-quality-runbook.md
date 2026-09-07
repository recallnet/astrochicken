---
doc_type: "reference"
owner: "docs-stewards"
review_policy: "periodic-7"
reviewed: "2026-03-21"
status: "active"
summary: "Maintainer and contributor runbook for deterministic docs checks, CI enforcement, migration debt handling, and rollout policy."
tags: [ci, docs, governance, runbook]
written: "2026-03-03"
---
# Docs Quality Runbook

This runbook defines the deterministic maintenance workflow for docs governance.

## CI contract (strict by default)

`.github/workflows/docs-quality.yml` is the canonical CI gate for docs governance.

It runs, in order:

1. `pnpm install`
2. `pnpm docs:check`
3. `pnpm docs:state:check`

`docs:check` is a strict gate (non-zero exit fails CI) and includes:

1. `pnpm docs:policy:check`
2. `pnpm docs:frontmatter:check`
3. `pnpm docs:graph:check`
4. `pnpm docs:state:check`

No baseline refresh command is part of the default CI path.

## Freshness contract

Governed docs now carry explicit freshness metadata in frontmatter:

- `written`
- `reviewed`
- `review_policy`
- `status`

Active human-written docs default to `review_policy: "periodic-7"`. In this repo,
that means they must be reviewed for accuracy at least weekly. The intended
pressure is deliberate: stale docs should be pruned, updated, or explicitly
re-reviewed instead of quietly accumulating.

The current policy classes are:

- `periodic-7` for active docs that must be kept fresh continuously
- `codebound` for docs whose accuracy is primarily enforced by deterministic code
  or contract checks
- `generated` for docs emitted by checked-in generators
- `historical` for frozen docs that are kept for record rather than active
  operational guidance

Stagger review dates when refreshing a broad set of docs. Do not stamp every doc
with the same review date unless they were genuinely reviewed in one pass and you
want them to expire together later.

Install policy note:

- This repo commits a root `pnpm-lock.yaml`, so workflow uses `pnpm install --frozen-lockfile`.
- `actions/setup-node` uses `cache: pnpm` in CI to align with the committed lockfile.
- If maintainers change the install mode, keep the workflow cache mode and the committed lockfile policy aligned in the same change.

## Contributor workflow

### 1) Scaffold or refresh from canonical template

List templates:

```bash
pnpm docs:template:scaffold -- --list
```

Render a template:

```bash
pnpm docs:template:scaffold -- \
  --template architecture \
  --title "Architecture" \
  --owner docs-stewards \
  --review-policy periodic-7 \
  --written 2026-03-03 \
  --reviewed 2026-03-19 \
  --status active \
  --summary "One-line summary" \
  --tags docs,governance
```

Write directly to a file:

```bash
pnpm docs:template:scaffold -- \
  --template roadmap \
  --title "Roadmap" \
  --owner docs-stewards \
  --review-policy periodic-7 \
  --written 2026-03-03 \
  --reviewed 2026-03-18 \
  --status draft \
  --summary "Roadmap summary" \
  --tags docs,roadmap \
  --output docs/roadmap.md
```

### 2) Run required checks before commit

```bash
pnpm docs:check
pnpm docs:state:check
```

When committing normally, `.githooks/pre-commit` also runs the strict-profile
`docs_freshness` gate. That gate fails if any governed doc is stale under its
declared review policy.

Expected success marker for the second command:

- `state-machines check passed`

### 3) If checks fail, fix root cause (do not bypass CI)

Typical failure classes:

- docs policy/schema violations (`scripts/docs-policy-check.mjs`)
- frontmatter contract violations (`scripts/docs-check-docs-frontmatter.mjs`)
- stale governed docs (`scripts/docs-check-freshness.mjs`)
- docs graph/link/anchor/orphan violations (`scripts/docs-check-docs-graph.mjs`)
- state-machine consistency violations (`scripts/docs-check-state-machines.mjs`)

When freshness fails, the allowed remediations are:

1. remove the doc if it is obsolete, duplicate, or too narrow to justify ongoing upkeep
2. update the doc and its `reviewed` date if it still matters but no longer teaches current reality clearly
3. confirm the doc is still accurate and update only the `reviewed` date, but use this sparingly
4. change its status/policy intentionally, for example to `historical`, only when it is a true frozen record rather than active guidance

Do not suppress the failure by weakening the gate. The intended behavior is
continuous pruning and re-review.

## Allowlist / migration debt updates (explicit intent only)

When legacy docs cannot be migrated in the same change, use an explicit policy update in `docs/docs-policy.json`:

- `docs_policy/v1.migration_debt.legacy_in_scope_allowlist`
- `docs_policy/v1.migration_debt.max_legacy_in_scope_allowlist_entries`
- `docs_policy/v1.root_level_exceptions` (must also be in `root_docs_allowlist`)

Rules:

1. Every allowlist/debt expansion must include a justification in PR description.
2. Expansions are temporary and must include a follow-up removal plan.
3. CI remains strict; allowlist edits are explicit policy changes, not hidden bypasses.

## Migration strategy for legacy files

Use this deterministic sequence:

1. Add temporary allowlist entry only if required to unblock urgent change.
2. Migrate legacy file to canonical contract:
   - add valid frontmatter
   - align to template sections where applicable
   - ensure links/anchors integrate with docs graph
3. Remove temporary allowlist entry.
4. Re-run `pnpm docs:check` and confirm pass.

## Warn-vs-fail rollout and rollback guidance

Current behavior is **fail-closed** in CI.

- `docs-quality.yml` does not set `continue-on-error`.
- `docs:check` failures fail PR/push status.

If a new docs rule needs phased rollout:

1. Land rule implementation and tests first.
2. Validate impact locally (`pnpm docs:check`) and in trial branches.
3. Use explicit policy debt knobs (`legacy_in_scope_allowlist`, `root_level_exceptions`) only for temporary migration windows.
4. Keep default CI strict; do not add baseline refresh commands to CI.

Rollback (emergency only):

- Revert the specific rule change or policy edit causing broad breakage.
- Do not weaken workflow failure semantics (`continue-on-error`) as a normal rollback path.
