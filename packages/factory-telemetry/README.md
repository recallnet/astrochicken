# @recallnet/factory-telemetry

Shared Hatch telemetry package (Langfuse + OTEL) for internal and external factories.

## Install

Inside this monorepo the package is consumed as a workspace dependency:

```json
{ "dependencies": { "@recallnet/factory-telemetry": "workspace:*" } }
```

## Factory config

Set telemetry identity in `factory.config.json`:

```json
{
  "factory_id": "external",
  "telemetry": {
    "factory_id": "external",
    "langfuse_project": "example-factories",
    "langfuse_base_url": "https://cloud.langfuse.com"
  }
}
```

`telemetry.factory_id` is preferred when present and is propagated to Langfuse metadata and OTEL resource/event attributes.

## Secrets

Do **not** commit secrets. Provide Langfuse credentials via environment variables:

- `LANGFUSE_PUBLIC_KEY`
- `LANGFUSE_SECRET_KEY`

## Minimal usage

```ts
import {
  EventBus,
  createLangfuseTelemetry,
  bindLangfuseLifecycleTelemetry,
} from "@recallnet/factory-telemetry";

const eventBus = new EventBus();
const telemetry = createLangfuseTelemetry({
  runId,
  graphName,
  pipelineFile,
  getRunContext: () => ({ factory_id: "external" }),
});
if (telemetry) eventBus.on(telemetry.eventHandler);

const lifecycle = bindLangfuseLifecycleTelemetry({ eventBus, ctx });
```

`createLangfuseTelemetry()` and lifecycle helpers are no-op safe when telemetry is disabled.

## Langfuse dashboard identity

For Langfuse UI dashboards, this package emits:

- trace names:
  - `llm.generation:<skill>`
  - `llm.session:<skill>`
  - fallback pipeline traces: `pipeline.graph:<graph-id>`
- trace/span tags:
  - `factory:<factory>`
  - `factory_id:<factory_id>`
  - `graph:<graph_id>`
  - `node:<node_id>`
  - `handler:<handler_type>`
  - `skill:<skill>`
  - `role:<agent_role>`
  - `model:<model>`
  - `provider:<provider>`
  - `outcome:<outcome>`
  - `retry:<true|false>`
  - `retry_class:<retry_class>`
  - `failure_class:<failure_class>`
  - `llm_path_id:<llm_path_id>`

This is intentionally redundant with metadata so operators can build dashboards in the Langfuse UI without first dropping to the Metrics API.
