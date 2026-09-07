---
doc_type: "reference"
owner: "docs-stewards"
review_policy: "periodic-7"
reviewed: "2026-03-18"
status: "active"
summary: "Index of maintained external-factory examples shipped in this repository."
tags: [docs, examples, external-factories]
written: "2026-03-09"
---
# External factory examples

Maintained external-factory examples live under:

- `examples/external-factories/<factory-id>/`

Current shipped example set:

- [`acme-support`](../../examples/external-factories/acme-support/README.md)

## Contract reference

Canonical boundary for all examples:
- [Factory Public Contract (v1)](../reference/factory-public-contract.md)
- Machine-readable form: [`docs/contracts/factory-public-contract.v1.json`](../contracts/factory-public-contract.v1.json)

Classification reminder for maintained examples:
- **Required public:** include baseline config/graph/scenario/conformance surfaces.
- **Optional public:** include additional supported public knobs only when they clarify usage.
- **Managed-only:** call out managed host/daemon/release overlays explicitly and keep them separate from standalone guarantees.

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

## Adding a new maintained example

Place new examples beside `acme-support` and include all required assets:

1. `factory.config.json` with explicit `target_repo` and `control_plane_repo`
2. runnable `graphs/` entrypoint(s)
3. `skills/` + `scenarios/` content
4. README with exact `hatch validate` / `hatch run` commands

Changes under `examples/external-factories/**` are wired to platform invariant coverage so examples stay validated over time.
