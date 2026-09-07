---
doc_type: "reference"
owner: "platform-architecture"
review_policy: "periodic-7"
reviewed: "2026-03-20"
status: "active"
summary: "Checked-in audit for Phase 2.3 reactor instrumentation and collector rollout coverage."
tags: [contracts, generated, hatch, observability, opentelemetry, reactor]
written: "2026-03-20"
---

# Reactor Collector Coverage

Schema: `reactor_collector_contract/v1`
- collector profile path: `packages/factory-telemetry/config/otel-collector.yaml`
- reactor helper path: `apps/hatch/src/pipeline/reactor-instrumentation.ts`
- control-plane entrypoints: `2`
- helper consumer files: `2`
- diagnostics: `0`

## Control-Plane Entrypoints

- `apps/hatch/src/cli.ts`
- `apps/hatch/src/server/server.ts`

## Helper Consumers

- `apps/hatch/src/cli.ts`
- `apps/hatch/src/server/server.ts`

## Banned Runtime Imports

- `bindLangfuseLifecycleTelemetry`
- `createLangfuseTelemetry`
- `createRuntimeRedisTelemetrySink`
- `projectRunLifecycleEventsToTelemetrySink`
