---
doc_type: "reference"
owner: "hatch-runtime"
review_policy: "periodic-7"
reviewed: "2026-03-23"
status: "active"
summary: "Context inheritance and deterministic export aggregation contract for concurrent composite handlers."
tags: [concurrency, context-isolation, fan-out, pipeline]
written: "2026-03-08"
---
# Pipeline Context Isolation Contract

## Scope

This document defines the runtime contract for composite handlers that execute
multiple children concurrently. `fan_out.dynamic` is the reference
implementation.

## Contract

### 1) Immutable parent snapshot inheritance

Before launching any child, the composite handler captures parent context once
(`ctx.all()`). Every child receives a fresh `Context` seeded from that same
snapshot.

Implication: sibling timing cannot change child inputs.

### 2) Child-local mutation only during execution

While children are running, all writes stay in child-local context. Children do
not mutate the parent context directly.

Implication: one child cannot influence sibling execution in-flight.

### 3) Deferred parent visibility via `Outcome.contextUpdates`

Parent visibility happens only after all children settle and only through the
composite handler's returned `Outcome.contextUpdates`. The engine remains the
single merge point into parent context.

Implication: context writeback is atomic at composite-handler boundaries.

### 4) Deterministic aggregation order

Aggregated export keys are namespaced as `${export_key}__${index}` where
`index` is the source item index from the input array.

Aggregation order is deterministic:
1. child index ascending (input order), then
2. export key lexical order within each child.

Completion timing order is ignored.

### 5) Fail-safe invalid export handling

If aggregated export state is invalid (for example malformed export keys),
`fan_out.dynamic` fails with `StageStatus.Failed`, marks writeback as skipped,
and returns no indexed export updates.

Implication: invalid export states cannot partially mutate parent context.

## Failure behavior

- Child failure/timeout/abort is normalized through the composite failure
  contract (`child_failed`, `child_timeout`, `child_aborted`).
- On composite child failure, export writeback is skipped.
- On invalid export aggregation, export writeback is skipped with
  `reason=invalid_export_state`.

## Telemetry signals

`fan_out.dynamic` emits explicit context-isolation telemetry:

- `parallel.fan_out` includes:
  - `context_inheritance=immutable_parent_snapshot`
  - `parent_snapshot_key_count=<count>`
- Child contexts include:
  - `__fan_out_parent_snapshot_mode=immutable`
  - `__fan_out_parent_snapshot_key_count=<count>`
- Parent aggregate writeback is observable via composite writeback status keys:
  - `__composite_export_writeback_status`
  - `__composite_export_writeback_reason`

## Guidance for future composite handlers

Any future concurrent composite handler (including pool-style handlers) must:

1. capture a single immutable parent snapshot,
2. isolate child-local writes during execution,
3. aggregate exports only after settlement,
4. enforce deterministic indexed export ordering,
5. fail-safe on invalid export state before parent merge.
