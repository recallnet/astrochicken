---
doc_type: "reference"
owner: "factory-platform"
review_policy: "periodic-7"
reviewed: "2026-03-19"
status: "active"
summary: "How scaffolded factories consume and customize the v1 policy template pack."
tags: [docs, factory-authoring, policy-pack, templates]
written: "2026-03-09"
---
# Factory Policy Pack (`policy-pack/v1`)

New factories scaffolded with `hatch factory init` now include a versioned policy
pack at:

- `factories/<factory_id>/policy-pack/v1/metadata.json`
- `factories/<factory_id>/policy-pack/v1/supervisor-policy.json`
- `factories/<factory_id>/policy-pack/v1/reviewer-policy.json`
- `factories/<factory_id>/policy-pack/v1/model-policy.json`
- `factories/<factory_id>/policy-pack/v1/release-policy.json`
- `factories/<factory_id>/policy-pack/v1/escalation-policy.json`
- `factories/<factory_id>/policy-pack/v1/block-wait-retry-policy.json`

## Shared vs factory-local policy boundaries

`metadata.json` is the contract source:

- `required_keys`: platform-owned keys that must exist in each policy file.
- `customizable_keys`: the only keys factories may override in
  `factory.config.json` under `policyPack.overrides`.

The policy files themselves contain:

- `shared.*` sections for platform defaults/invariants.
- `factory.*` sections for allowed customization hooks.

Do not edit `shared.*` expectations through overrides.

## Version pinning

Each factory config pins the policy pack version:

```json
"policyPack": {
  "version": "v1",
  "overrides": {}
}
```

`policyPack.version` must match `policy-pack/v1/metadata.json` `version`.

## Enforcement points

- `scaffoldFactory` copies template assets from
  `factories/_templates/policy-pack/v1` into each new factory.
- `initFactory` loads scaffolded policy files, validates metadata, checks all
  `required_keys`, and validates `policyPack.overrides` against
  `customizable_keys`.
- Validation errors are deterministic and actionable, for example:
  - `policyPack.version mismatch`
  - `policyPack.supervisor required key missing`
  - `policyPack.review overrides forbidden key`

## Customization workflow

1. Keep `policy-pack/v1/*` files intact as the scaffolded baseline.
2. Apply local policy differences only in `factory.config.json`
   `policyPack.overrides`.
3. Use only paths listed in `metadata.json` `customizable_keys`.
4. If a new customization hook is required, update the template pack metadata
   and tests in the same change.
