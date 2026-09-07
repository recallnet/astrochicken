# @hatch/factory-core

Foundation schemas, registries, and contract definitions for the factory system. This package provides the canonical Zod schemas, boundary contracts, and registry types that every other package depends on.

## Key Modules

| Module | Purpose |
|--------|---------|
| `schema-registry` | Zod schema primitives, boundary schema definitions, JSON schema generation |
| `cloudevents-registry` | CloudEvents schema builder and validator |
| `asyncapi-registry` | AsyncAPI event surface definitions |
| `openlineage-registry` | OpenLineage projection and lineage tracking |
| `openapi-registry` | OpenAPI sync contract definitions |
| `capability-contract-registry` | Capability manifest and output contract schemas |
| `factory-composition-registry` | Factory composition model — kind, instance, config schemas |
| `artifact-trust-registry` | OCI artifact trust policy and signing contract |
| `oci-artifact-registry` | OCI artifact taxonomy and lifecycle policies |
| `hatch-config-schema-boundaries` | Hatch config boundary schema definitions |
| `hatch-run-lifecycle-asyncapi` | Run lifecycle AsyncAPI event definitions |
| `daily-lens-collector` | Daily lens data collection contract |
| `issue-url-normalization` | GitHub issue URL normalization utilities |
| `primitives` | Shared primitive types and constants |
| `transport` | Typed action transport mode definitions |

## Usage

Other packages import from `@hatch/factory-core` subpath exports:

```javascript
import { z, defineBoundarySchema } from "@hatch/factory-core/schema-registry";
import { createCloudEventSchema } from "@hatch/factory-core/cloudevents-registry";
import { defineAsyncEventSurface } from "@hatch/factory-core/asyncapi-registry";
```

## Testing

```bash
node --test packages/factory-core/test/*.mjs
```
