import { defineAsyncEventSurface } from "./asyncapi-registry.ts";
import {
  buildCloudEvent,
  createCloudEventSchema,
  defineCloudEventSurface,
  validateCloudEvent,
  z,
} from "./cloudevents-registry.ts";
import { normalizeOpenLineageProjection } from "./openlineage-registry.ts";
import { createIssueList, defineBoundarySchema } from "./schema-registry.ts";

const lifecycleEventNames = ["run-start", "complete", "fail", "node-change", "merge", "artifact"] as const;

export const HATCH_RUN_LIFECYCLE_EVENT_SCHEMA_VERSION = "hatch_run_lifecycle_event/v1";
export const HATCH_RUN_LIFECYCLE_EVENT_SCHEMA_ID = "https://recallnet.dev/contracts/hatch-run-lifecycle-event.v1.schema.json";
export const HATCH_RUN_LIFECYCLE_EVENT_TYPE = "dev.recallnet.hatch.run.lifecycle";
export const HATCH_RUN_LIFECYCLE_EVENT_SOURCE = "/hatch/run-lifecycle";

export const hatchRunLifecycleEventSchema = z.strictObject({
  schemaVersion: z.literal(1),
  ts: z.string(),
  event: z.enum(lifecycleEventNames),
  runId: z.string(),
  graph: z.string(),
  node: z.string(),
  prevNode: z.string().optional(),
  issue: z.string().optional(),
  milestone: z.string().optional(),
  artifactUrl: z.string().optional(),
  mergeStatus: z.string().optional(),
});

export const HATCH_RUN_LIFECYCLE_EVENT_BOUNDARY_SCHEMA = defineBoundarySchema({
  id: HATCH_RUN_LIFECYCLE_EVENT_SCHEMA_ID,
  version: HATCH_RUN_LIFECYCLE_EVENT_SCHEMA_VERSION,
  title: "Hatch Run Lifecycle Event Payload",
  description: "Canonical lifecycle event payload emitted into Hatch run lifecycle event streams.",
  schema: hatchRunLifecycleEventSchema,
  sourcePath: "packages/factory-core/src/hatch-run-lifecycle-asyncapi.ts",
  outputPath: "docs/contracts/hatch-run-lifecycle-event.v1.schema.json",
  documentVersionField: "schemaVersion",
});

export const hatchRunLifecycleCloudEventSchema = createCloudEventSchema({
  type: HATCH_RUN_LIFECYCLE_EVENT_TYPE,
  source: HATCH_RUN_LIFECYCLE_EVENT_SOURCE,
  dataSchemaId: HATCH_RUN_LIFECYCLE_EVENT_SCHEMA_ID,
  dataSchema: hatchRunLifecycleEventSchema,
});

export const HATCH_RUN_LIFECYCLE_ASYNCAPI_SURFACE = defineAsyncEventSurface({
  id: "https://recallnet.dev/contracts/hatch-run-lifecycle.asyncapi.v1.json",
  version: "hatch_run_lifecycle_asyncapi/v1",
  title: "Hatch Run Lifecycle Event Stream",
  description: "Governed CloudEvents lifecycle channel consumed by hatch-ops factory subscribe.",
  sourcePath: "packages/factory-core/src/hatch-run-lifecycle-asyncapi.ts",
  outputPath: "docs/contracts/hatch-run-lifecycle.asyncapi.v1.json",
  producers: ["apps/hatch/src/pipeline/run-lifecycle.ts"],
  consumers: ["packages/factory-ops/src/commands/factory-subscribe.ts"],
  channels: [
    {
      name: "hatch.run.lifecycle",
      address: "hatch.run.lifecycle",
      description: "Lifecycle CloudEvents emitted for Hatch pipeline runs.",
      operation: "subscribe",
      messages: [
        {
          id: "HatchRunLifecycleCloudEvent",
          title: "Hatch Run Lifecycle CloudEvent",
          summary: "CloudEvent envelope carrying versioned Hatch run lifecycle payloads and lineage-compatible metadata.",
          schema: hatchRunLifecycleCloudEventSchema,
        },
      ],
    },
  ],
});

export const HATCH_RUN_LIFECYCLE_CLOUDEVENT_SURFACE = defineCloudEventSurface({
  id: "https://recallnet.dev/contracts/cloudevents/hatch-run-lifecycle.v1.json",
  version: "hatch_run_lifecycle_cloudevents/v1",
  title: "Hatch Run Lifecycle CloudEvents",
  description: "Canonical CloudEvents contract for Hatch run lifecycle event streams.",
  sourcePath: "packages/factory-core/src/hatch-run-lifecycle-asyncapi.ts",
  outputPath: "docs/contracts/hatch-run-lifecycle.asyncapi.v1.json",
  producers: ["apps/hatch/src/pipeline/run-lifecycle.ts"],
  consumers: ["packages/factory-ops/src/commands/factory-subscribe.ts"],
  governedPaths: [
    "apps/hatch/src/pipeline/run-lifecycle.ts",
    "packages/factory-ops/src/commands/factory-subscribe.ts",
  ],
  payloadSchemaVersion: HATCH_RUN_LIFECYCLE_EVENT_SCHEMA_VERSION,
  payloadSchemaId: HATCH_RUN_LIFECYCLE_EVENT_SCHEMA_ID,
});

export function normalizeHatchRunLifecycleEvent(event: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: Number(event?.schemaVersion ?? 1),
    ts: String(event?.ts || ""),
    event: String(event?.event || ""),
    runId: String(event?.runId || ""),
    graph: String(event?.graph || ""),
    node: String(event?.node || ""),
    prevNode: event?.prevNode == null ? undefined : String(event.prevNode),
    issue: event?.issue == null ? undefined : String(event.issue),
    milestone: event?.milestone == null ? undefined : String(event.milestone),
    artifactUrl: event?.artifactUrl == null ? undefined : String(event.artifactUrl),
    mergeStatus: event?.mergeStatus == null ? undefined : String(event.mergeStatus),
  };
}

export function validateHatchRunLifecycleEvent(event: unknown): { ok: boolean; value: Record<string, unknown> | null; errors: Array<{ path: string; message: string }> } {
  const parsed = hatchRunLifecycleEventSchema.safeParse(normalizeHatchRunLifecycleEvent(event as Record<string, unknown>));
  if (parsed.success) {
    return { ok: true, value: parsed.data as Record<string, unknown>, errors: [] };
  }
  return {
    ok: false,
    value: null,
    errors: createIssueList(parsed.error as unknown as import("zod/v4/core").$ZodError),
  };
}

export function buildHatchRunLifecycleCloudEvent({
  id = "",
  subject = "",
  time = "",
  traceparent = "",
  tracestate = "",
  openlineage = undefined,
  data,
}: {
  id?: string;
  subject?: string;
  time?: string;
  traceparent?: string;
  tracestate?: string;
  openlineage?: unknown;
  data: unknown;
} = {} as { data: unknown }): Record<string, unknown> {
  const validated = validateHatchRunLifecycleEvent(data);
  if (!validated.ok || !validated.value) {
    throw new Error(`invalid_hatch_run_lifecycle_event:${validated.errors.map((entry) => `${entry.path}:${entry.message}`).join(",")}`);
  }
  return buildCloudEvent({
    schema: hatchRunLifecycleCloudEventSchema as unknown as Record<string, unknown>,
    id,
    subject,
    time: time || (validated.value.ts as string),
    traceparent,
    tracestate,
    openlineage: normalizeOpenLineageProjection(openlineage),
    data: validated.value,
  });
}

export function validateHatchRunLifecycleCloudEvent(event: unknown): { ok: boolean; value: Record<string, unknown> | null; errors: Array<{ path: string; message: string }> } {
  return validateCloudEvent(hatchRunLifecycleCloudEventSchema, event);
}
