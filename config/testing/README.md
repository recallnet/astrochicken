# Test Config Contract

`config/testing/` is the authoritative root for repo-wide test topology,
routing, ownership, and spec-proof configuration.

Commit slice rollout:

- Commit 1 establishes the canonical directory and schema-shaped config stubs.
- Commit 2 lands package manifests under `package-test-manifests/`.
- Later commit slices populate ownership, spec, routing, and enforcement data.

Use `node scripts/check-test-config-contract.ts` to validate presence and
top-level shape.
Use `node scripts/check-suite-routing-contract.ts` to validate that
`suite-routing.json` carries the authoritative route order, bucket mappings,
and selection matrix required by the hooks.
Use `node scripts/check-subsystem-ownership.ts` to validate that active
code/test-bearing paths are mapped to an owning subsystem.
Use `node scripts/check-spec-registry-contract.ts` to validate that each
checked-in subsystem spec exists, carries the required contract headings, and
links to real executable proof surfaces.
Use `node scripts/check-test-topology.mjs` to validate that new test files land
only under the approved checked-in topology roots.
Use `node scripts/check-fixture-ownership.mjs` to validate that fixture and
golden artifacts stay inside approved owning domains with deterministic
ownership.
Use `node scripts/check-shared-surface-ownership.ts` to validate that shared
operational surfaces are implemented only in their owning packages. The first
enforced surface is GitHub CLI transport via `packages/github-adapter`.
Use `node scripts/check-factory-ops-test-topology.mjs` to validate that
`packages/factory-ops/test` stays subsystem-first and does not regress to new
flat-root test files or legacy top-level fixture buckets.
Use `node scripts/check-test-manifest-contract.ts` to validate the package
manifests for `hatch`, `@hatch/factory-ops`, and
`@recallnet/factory-telemetry`.
