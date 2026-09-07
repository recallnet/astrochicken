---
doc_type: "architecture"
owner: "factory-platform"
review_policy: "periodic-7"
reviewed: "2026-03-19"
status: "active"
summary: "Stable CLI entrypoints and JS API exports for external factory repos consuming the AstroChicken runtime."
tags: [architecture, external-factories, release, runtime]
written: "2026-03-19"
---

# External Runtime Entrypoints

The canonical public install contract is maintained in `docs/reference/snippets/external-install-contract.md`. Keep the section below synchronized verbatim with that snippet.

<!-- public-contract -->
<!-- external-install-contract:copied-from=docs/reference/snippets/external-install-contract.md -->

## Public install contract

Required packages:
- `hatch` — required package; provides the `hatch` binary for runtime/conformance commands.
- `@hatch/factory-ops` — required package; provides the `hatch-ops` binary for operator/runtime status and recovery commands.
- `@hatch/replay` — optional package for replay/lab workflows; not required for baseline external factory installs.
- Internal-only surfaces: `apps/*` and private `packages/*` implementation tooling are not part of the external install contract.

| Stable entrypoint | Owning binary/package | Intended persona | Install smoke check |
| --- | --- | --- | --- |
| `hatch run <file.dot>` | `hatch` (`hatch`) | External adopter | `hatch run --help` |
| `hatch validate <file.dot>` | `hatch` (`hatch`) | External adopter | `hatch validate --help` |
| `hatch factory conformance` | `hatch` (`hatch`) | External adopter | `hatch factory conformance --help` |
| `hatch-ops factory status` | `hatch-ops` (`@hatch/factory-ops`) | Internal operator | `hatch-ops factory status --help` |
| `hatch-ops factory tick-status` | `hatch-ops` (`@hatch/factory-ops`) | Internal operator | `hatch-ops factory tick-status --help` |
| `hatch-ops factory recovery-sweep` | `hatch-ops` (`@hatch/factory-ops`) | Internal operator | `hatch-ops factory recovery-sweep --help` |

This block is the public install contract for docs and generated quickstarts. Include tooling is not available in this docs stack, so update `docs/reference/snippets/external-install-contract.md` first, then copy this block verbatim into each consumer document/template.

All other `hatch` and `hatch-ops` subcommands are **internal** and may change without notice.

## Stable JS API Exports

| Export path | Description |
|---|---|
| `hatch#./factory/context-resolver` | Factory context resolution from config |
| `hatch#./factory/conformance-harness` | Conformance harness runner |
| `hatch#./factory/conformance-cli` | Conformance CLI entrypoint |
| `hatch#./factory/config-schema` | Factory config schema types |

All other named exports from `hatch` are **internal**.

## Version Coordination

See `docs/contracts/runtime-release-manifest.json` for the coordinated version manifest. External factory operators should pin to the manifest version and upgrade together.

The manifest is also the deterministic source of truth for this page's install contract:
- `externalSurface.packages` defines package ownership (`required|optional|internal`), package repo ownership, published versions, and tracked bin entrypoints.
- `externalSurface.stableEntryPoints` defines documented stable CLI quickstarts and smoke checks.

Contract gate: `pnpm --silent test:platform:runtime-external-entrypoints-contract`.
