# Acme Support external factory example

This is a maintained example of a managed **external factory**.

- `target_repo`: `acme/support-factory`
- `control_plane_repo`: `recallnet/astrochicken`

That split is the key non-mothership relationship: the factory ships work to a non-mothership repo while lifecycle/control-plane logic remains in Astrochicken.

## Contract reference

Canonical boundary:
- [Factory Public Contract (v1)](../../../docs/reference/factory-public-contract.md)
- Machine-readable form: [`docs/contracts/factory-public-contract.v1.json`](../../../docs/contracts/factory-public-contract.v1.json)

How this example maps to the boundary:
- **Required public:** `factory.config.json` schema fields, supervisor graph entrypoint, scenario root, and conformance-compatible runtime surfaces.
- **Optional public:** policy-pack overrides and local prompt/operator notes.
- **Managed-only:** lifecycle/control-plane host operations remain managed overlays, not standalone requirements.

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

## Run and validate locally

From repo root:

```bash
hatch validate examples/external-factories/acme-support/graphs/factory_supervisor_tick.dot
node scripts/lint-dot.mjs examples/external-factories/acme-support/graphs/factory_supervisor_tick.dot
HATCH_FACTORY_ROOT=examples/external-factories/acme-support \
  hatch run examples/external-factories/acme-support/graphs/factory_supervisor_tick.dot
```

## Shared platform contract vs. factory customization

### Shared platform contract (do not fork casually)

- `control_plane` / `control_plane_repo` in `factory.config.json`
- `pipeline.supervisor_tick` and `dispatch.graph` entrypoint wiring
- shared lifecycle graph delegation to `factories/mothership/graphs/factory_supervisor_tick.dot`

### Acme-specific customization

- `factory_id`: `acme-support`
- `target_repo` + `repo`: `acme/support-factory`
- scenario content under `scenarios/acme-support/`
- local operator notes in this README and skill prompt text

## File map

- `factory.config.json` — external-factory config contract
- `graphs/factory_supervisor_tick.dot` — example entrypoint graph
- `skills/supervisor/current.md` — supervisor prompt stub
- `scenarios/acme-support/post-merge/core/SCENARIO.md` — scenario stub
