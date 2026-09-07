---
doc_type: "reference"
owner: "platform-architecture"
review_policy: "periodic-7"
reviewed: "2026-03-20"
status: "active"
summary: "Governed Zod-authored boundary schema registry and generated JSON Schema outputs for Phase 3.1."
tags: [contracts, json-schema, schemas, zod]
written: "2026-03-20"
---
# Boundary Schema Registry

- Registered boundaries: 6
- Governed outputs: 6
- Diagnostics: 0

## Registered Boundaries

- `docs/contracts/factory-config.json`
  - source: `apps/hatch/src/factory/config-schema.ts`
  - version: `hatch.factory.config.v1`
  - document version field: `schema`
- `docs/contracts/factory-installation-manifest.json`
  - source: `apps/hatch/src/factory/config-schema.ts`
  - version: `factory_installation_manifest/v1`
  - document version field: `schema_version`
- `docs/contracts/factory-instance-manifest.json`
  - source: `apps/hatch/src/factory/config-schema.ts`
  - version: `factory_instance_manifest/v1`
  - document version field: `schema_version`
- `docs/contracts/factory-kind-definition.json`
  - source: `apps/hatch/src/factory/config-schema.ts`
  - version: `factory_kind_definition/v1`
  - document version field: `schema_version`
- `docs/contracts/factory-service-registry.json`
  - source: `apps/hatch/src/factory/config-schema.ts`
  - version: `factory_service_registry/v1`
  - document version field: `schema_version`
- `docs/contracts/hatch-intent.json`
  - source: `apps/hatch/src/intent/schema.ts`
  - version: `hatch.intent.v1`
  - document version field: `schema_version`

## Diagnostics

- none

