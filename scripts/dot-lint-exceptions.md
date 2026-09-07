# DOT lint compatibility exceptions

`scripts/dot-lint-exceptions.json` is the deterministic allowlist consumed by `scripts/dot-lint.mjs`.

Schema (`dot_lint_exceptions/v1`):

- `trust_domain_role_compat`: array of `{ "file": "<path.dot>", "node": "<node_id>" }`
  - Allows node-specific temporary compatibility for `trust_domain` / `trust_role` pair checks.
- `trust_alias_compat`: array of `{ "file": "<path.dot>", "node": "<node_id>", "alias": "trust_participant|trust_identity|*" }`
  - Allows node-specific legacy alias compatibility.

Paths are repo-relative and normalized with `/` separators.

## Inline-script ignore debt baseline

`scripts/dot-inline-script-ignore-baseline.json` is the repository baseline for `# hatch:no-inline-script-ok` marker debt.

Schema (`dot_inline_script_ignore_baseline/v1`):

- `markers`: array of marker objects with:
  - `file` (repo-relative dot path)
  - `node_id`
  - `node_label`
  - `handler_type`
  - `identity` (stable hash)

Identity format is deterministic and diff-safe:

- `identity = sha256("v1|<file>|<node_id>|<handler_type>|# hatch:no-inline-script-ok")`

Governance behavior:

- Baseline scope is repository-level: all tracked `.dot` files from `git ls-files -- '*.dot'`.
- Normal lint runs enforce monotonic debt for governed tracked `.dot` files.
- If new ignore markers are added relative to baseline, lint fails with `rule_id="prompt.inline_script_ignore_debt"` and emits deterministic telemetry:
  - `[dot-lint] inline_script_debt_violation_summary ...`
  - `[dot-lint] inline_script_debt_added ...`

Operator workflows:

- Review-only dry run (no mutation):
  - `node scripts/dot-lint.mjs --inline-script-baseline-diff`
- Explicit baseline refresh (idempotent):
  - `node scripts/dot-lint.mjs --inline-script-baseline-refresh`

## Hook-safe lint entrypoint and marker contract

Use `scripts/lint-dot.mjs` as the pre-commit/CI entrypoint wrapper around `scripts/dot-lint.mjs`.

Contract markers (stderr):

- `[lint-dot] result=ok ...` for zero-diagnostic success
- `[lint-dot] result=warning_only ...` for warning-only success (exit 0)
- `[lint-dot] result=fail ...` for hard lint failure (exit non-zero)

`lint-dot` preserves `dot-lint` stdout/stderr payloads and propagates `dot-lint` exit status unchanged.
