---
doc_type: "reference"
owner: "hatch-runtime"
review_policy: "periodic-7"
reviewed: "2026-03-20"
status: "active"
summary: "Checked-in helper-routing audit for Hatch workflow and action instrumentation coverage."
tags: [contracts, generated, hatch, observability, telemetry]
written: "2026-03-20"
---

# Workflow Instrumentation Coverage

Schema: `workflow_instrumentation_helper_report/v1`
- helper paths: `apps/hatch/src/pipeline/instrumentation-helpers.ts`, `apps/hatch/src/pipeline/reactor-instrumentation.ts`
- helper consumer files: `3`
- direct bypass files: `0`
- diagnostics: `0`

## Helper Consumers

- `apps/hatch/src/pipeline/engine.ts`
- `apps/hatch/src/pipeline/handler/fan_out_detached.ts`
- `apps/hatch/src/pipeline/handler/fan_out_dynamic.ts`

## Direct Bypass Files

- none
