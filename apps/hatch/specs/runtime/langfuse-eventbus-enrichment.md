---
id: "hatch.runtime.langfuse-eventbus-enrichment"
title: "Runtime Langfuse Eventbus Enrichment Contract"
owner_package: "hatch"
subsystem: "runtime"
status: "active"
---

# Runtime Langfuse Eventbus Enrichment Contract

## Scope

Defines the runtime telemetry metadata that Hatch must attach to eventbus and
handler-level Langfuse emissions.

## Inputs

- runtime eventbus stage, retry, edge, and quality events
- Langfuse handler instrumentation data
- benchmark identity metadata from runtime context and node attributes

## Outputs

- deterministic trace and session identifiers on runtime events
- benchmark identity metadata on emitted events
- handler-level Langfuse generation proof for session and attempt chaining

## Required Invariants

- runtime eventbus emissions carry Langfuse session and trace identifiers
- benchmark identity metadata is attached or surfaced as an explicit violation
- handler instrumentation preserves session lineage across retries

## Failure Modes

- runtime events emit without Langfuse trace/session context
- benchmark identity metadata silently drifts or disappears
- retry attempts break handler session lineage

## Authoritative Configs

- `config/testing/spec-registry.json`
- `config/testing/subsystem-ownership.json`
- `apps/hatch/src/pipeline/engine-telemetry.ts`

## Test Surfaces

- `apps/hatch/src/pipeline/telemetry/langfuse-eventbus-enrichment.contract.test.ts`
- `apps/hatch/src/pipeline/handler/langfuse-instrumentation.test.ts`

## Merge Blockers

- Runtime eventbus emissions must carry deterministic Langfuse session and
  trace metadata.
- Benchmark identity enrichment changes must land with telemetry proof updates.
