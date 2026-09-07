---
doc_type: "reference"
owner: "docs-stewards"
review_policy: "periodic-7"
reviewed: "2026-03-19"
status: "active"
summary: "Canonical public install and entrypoint contract for external factory docs and templates."
tags: [external-factories, install, reference]
written: "2026-03-19"
---

# External install contract snippet

Use this block as the canonical public install/entrypoint contract in external onboarding docs and scaffold templates.

<!-- public-contract -->
<!-- external-install-contract:canonical-source -->

### Public install contract

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
