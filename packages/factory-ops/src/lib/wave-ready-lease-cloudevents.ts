import { defineAsyncEventSurface } from "@hatch/factory-core/asyncapi-registry";
import {
  buildCloudEvent,
  createCloudEventSchema,
  defineCloudEventSurface,
  validateCloudEvent,
  z,
} from "@hatch/factory-core/cloudevents-registry";
import { createIssueList, defineBoundarySchema } from "@hatch/factory-core/schema-registry";

export const WAVE_READY_LEASE_EVENT_SCHEMA_VERSION = "wave_ready_lease_event/v1";
export const WAVE_READY_LEASE_EVENT_SCHEMA_ID = "https://recallnet.dev/contracts/wave-ready-lease-event.v1.schema.json";
export const WAVE_READY_LEASE_EVENT_TYPE = "dev.recallnet.factory.wave.ready-lease";
export const WAVE_READY_LEASE_EVENT_SOURCE = "/factory/wave-ready-lease";
export const WAVE_READY_LEASE_CLOUDEVENT_PREFIX = "CLOUDEVENT ";

export const waveReadyLeaseEventSchema = z.strictObject({
  schema_version: z.literal(WAVE_READY_LEASE_EVENT_SCHEMA_VERSION),
  action: z.enum(["claim", "release"]),
  milestone_title: z.string(),
  ready_issue_number: z.string(),
  run_id: z.string(),
  pipeline: z.string(),
  reason: z.string(),
  at: z.string(),
});

export const WAVE_READY_LEASE_EVENT_BOUNDARY_SCHEMA = defineBoundarySchema({
  id: WAVE_READY_LEASE_EVENT_SCHEMA_ID,
  version: WAVE_READY_LEASE_EVENT_SCHEMA_VERSION,
  title: "Wave Ready Lease Event Payload",
  description: "Canonical wave ready lease payload persisted in GitHub issue comments.",
  schema: waveReadyLeaseEventSchema,
  sourcePath: "packages/factory-ops/src/lib/wave-ready-lease-cloudevents.ts",
  outputPath: "docs/contracts/wave-ready-lease-event.v1.schema.json",
});

export const waveReadyLeaseCloudEventSchema = createCloudEventSchema({
  type: WAVE_READY_LEASE_EVENT_TYPE,
  source: WAVE_READY_LEASE_EVENT_SOURCE,
  dataSchemaId: WAVE_READY_LEASE_EVENT_SCHEMA_ID,
  dataSchema: waveReadyLeaseEventSchema,
});

export const WAVE_READY_LEASE_ASYNCAPI_SURFACE = defineAsyncEventSurface({
  id: "https://recallnet.dev/contracts/wave-ready-lease.asyncapi.v1.json",
  version: "wave_ready_lease_asyncapi/v1",
  title: "Wave Ready Lease Feed",
  description: "Governed CloudEvents feed for wave ready lease claim and release comments.",
  sourcePath: "packages/factory-ops/src/lib/wave-ready-lease-cloudevents.ts",
  outputPath: "docs/contracts/wave-ready-lease.asyncapi.v1.json",
  producers: [
    "packages/factory-ops/src/lib/wave-ready-lease.ts",
    "packages/factory-ops/src/lib/wave-ready-claim-ops.ts",
  ],
  consumers: [
    "packages/factory-ops/src/lib/wave-ready-lease.ts",
    "packages/factory-ops/src/commands/wave-claim.ts",
  ],
  channels: [
    {
      name: "factory.wave.ready-lease",
      address: "factory.wave.ready-lease",
      description: "CloudEvents carried in GitHub comments to claim and release ready-wave leases.",
      operation: "subscribe",
      messages: [
        {
          id: "WaveReadyLeaseCloudEvent",
          title: "Wave Ready Lease CloudEvent",
          summary: "CloudEvent envelope carrying versioned wave ready lease payloads.",
          schema: waveReadyLeaseCloudEventSchema,
        },
      ],
    },
  ],
});

export const WAVE_READY_LEASE_CLOUDEVENT_SURFACE = defineCloudEventSurface({
  id: "https://recallnet.dev/contracts/cloudevents/wave-ready-lease.v1.json",
  version: "wave_ready_lease_cloudevents/v1",
  title: "Wave Ready Lease CloudEvents",
  description: "Canonical CloudEvents contract for wave ready lease comments.",
  sourcePath: "packages/factory-ops/src/lib/wave-ready-lease-cloudevents.ts",
  outputPath: "docs/contracts/wave-ready-lease.asyncapi.v1.json",
  producers: [
    "packages/factory-ops/src/lib/wave-ready-lease.ts",
    "packages/factory-ops/src/lib/wave-ready-claim-ops.ts",
  ],
  consumers: [
    "packages/factory-ops/src/lib/wave-ready-lease.ts",
    "packages/factory-ops/src/commands/wave-claim.ts",
  ],
  governedPaths: [
    "packages/factory-ops/src/lib/wave-ready-lease.ts",
    "packages/factory-ops/src/lib/wave-ready-claim-ops.ts",
    "packages/factory-ops/src/commands/wave-claim.ts",
  ],
  payloadSchemaVersion: WAVE_READY_LEASE_EVENT_SCHEMA_VERSION,
  payloadSchemaId: WAVE_READY_LEASE_EVENT_SCHEMA_ID,
});

export function normalizeWaveReadyLeaseEvent(event = {}) {
  return {
    schema_version: String(event?.schema_version || WAVE_READY_LEASE_EVENT_SCHEMA_VERSION),
    action: String(event?.action || ""),
    milestone_title: String(event?.milestone_title || ""),
    ready_issue_number: String(event?.ready_issue_number || ""),
    run_id: String(event?.run_id || ""),
    pipeline: String(event?.pipeline || ""),
    reason: String(event?.reason || ""),
    at: String(event?.at || ""),
  };
}

export function buildWaveReadyLeaseEvent({
  action = "claim",
  milestoneTitle = "",
  readyIssueNumber = "",
  runId = "",
  pipeline = "",
  reason = "",
  at = "",
} = {}) {
  const normalizedAction = String(action || "").trim().toLowerCase() === "release" ? "release" : "claim";
  const issueRaw = Number(readyIssueNumber || 0);
  const issueNumber = Number.isFinite(issueRaw) && issueRaw > 0 ? String(Math.trunc(issueRaw)) : "";

  return normalizeWaveReadyLeaseEvent({
    action: normalizedAction,
    milestone_title: String(milestoneTitle || "").trim(),
    ready_issue_number: issueNumber,
    run_id: String(runId || "").trim(),
    pipeline: String(pipeline || "").trim(),
    reason: String(reason || "").trim(),
    at: String(at || new Date().toISOString()),
  });
}

export function validateWaveReadyLeaseEvent(event) {
  const parsed = waveReadyLeaseEventSchema.safeParse(normalizeWaveReadyLeaseEvent(event));
  if (parsed.success) {
    return { ok: true, value: parsed.data, errors: [] };
  }
  return {
    ok: false,
    value: null,
    errors: createIssueList(parsed.error),
  };
}

export function buildWaveReadyLeaseCloudEvent({
  id = "",
  subject = "",
  time = "",
  traceparent = "",
  tracestate = "",
  data,
} = {}) {
  const validated = validateWaveReadyLeaseEvent(data);
  if (!validated.ok || !validated.value) {
    throw new Error(`invalid_wave_ready_lease_event:${validated.errors.map((entry) => `${entry.path}:${entry.message}`).join(",")}`);
  }
  return buildCloudEvent({
    schema: waveReadyLeaseCloudEventSchema,
    id,
    subject,
    time: time || validated.value.at,
    traceparent,
    tracestate,
    data: validated.value,
  });
}

export function validateWaveReadyLeaseCloudEvent(event) {
  return validateCloudEvent(waveReadyLeaseCloudEventSchema, event);
}
