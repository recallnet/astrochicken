import { defineAsyncEventSurface } from "@hatch/factory-core/asyncapi-registry";
import {
  buildCloudEvent,
  createCloudEventSchema,
  defineCloudEventSurface,
  validateCloudEvent,
  z,
} from "@hatch/factory-core/cloudevents-registry";
import {
  buildReleaseRolloutLineageProjection,
  normalizeOpenLineageProjection,
} from "@hatch/factory-core/openlineage-registry";
import { createIssueList, defineBoundarySchema } from "@hatch/factory-core/schema-registry";

export const RELEASE_ROLLOUT_EVENT_SCHEMA_VERSION = "release_rollout_event/v1";
export const RELEASE_ROLLOUT_EVENT_SCHEMA_ID = "https://recallnet.dev/contracts/release-rollout-event.v1.schema.json";
export const RELEASE_ROLLOUT_EVENT_TYPE = "dev.recallnet.factory.release.rollout";
export const RELEASE_ROLLOUT_EVENT_SOURCE = "/factory/release-rollout";

export const releaseRolloutEventSchema = z.strictObject({
  schema_version: z.literal(RELEASE_ROLLOUT_EVENT_SCHEMA_VERSION),
  action: z.string(),
  channel: z.string(),
  status: z.string(),
  reason: z.string(),
  release_id: z.string(),
  release_tag: z.string(),
  release_sha: z.string(),
  previous_release_id: z.string(),
  run_id: z.string(),
  holder_id: z.string(),
  tracking_issue_number: z.string(),
  asset_id: z.string(),
  asset_url: z.string(),
  manifest_path: z.string(),
  at: z.string(),
});

export const RELEASE_ROLLOUT_EVENT_BOUNDARY_SCHEMA = defineBoundarySchema({
  id: RELEASE_ROLLOUT_EVENT_SCHEMA_ID,
  version: RELEASE_ROLLOUT_EVENT_SCHEMA_VERSION,
  title: "Release Rollout Event Payload",
  description: "Canonical release rollout controller event payload persisted in control-plane release manifests.",
  schema: releaseRolloutEventSchema,
  sourcePath: "packages/factory-ops/src/lib/release-rollout-asyncapi-contract.ts",
  outputPath: "docs/contracts/release-rollout-event.v1.schema.json",
});

export const releaseRolloutCloudEventSchema = createCloudEventSchema({
  type: RELEASE_ROLLOUT_EVENT_TYPE,
  source: RELEASE_ROLLOUT_EVENT_SOURCE,
  dataSchemaId: RELEASE_ROLLOUT_EVENT_SCHEMA_ID,
  dataSchema: releaseRolloutEventSchema,
});

export const RELEASE_ROLLOUT_ASYNCAPI_SURFACE = defineAsyncEventSurface({
  id: "https://recallnet.dev/contracts/release-rollout-events.asyncapi.v1.json",
  version: "release_rollout_events_asyncapi/v1",
  title: "Release Rollout Event Feed",
  description: "Governed CloudEvents release rollout feed surfaced through control-plane release manifests and CLI readers.",
  sourcePath: "packages/factory-ops/src/lib/release-rollout-asyncapi-contract.ts",
  outputPath: "docs/contracts/release-rollout-events.asyncapi.v1.json",
  producers: ["packages/factory-ops/src/lib/command-owners/release-rollout-controller.ts"],
  consumers: ["packages/factory-ops/src/commands/release-rollout-controller-state.ts"],
  channels: [
    {
      name: "factory.release.rollout",
      address: "factory.release.rollout",
      description: "Release rollout CloudEvents emitted when manifests are published, promoted, or rolled back.",
      operation: "subscribe",
      messages: [
        {
          id: "ReleaseRolloutCloudEvent",
          title: "Release Rollout CloudEvent",
          summary: "CloudEvent envelope carrying versioned release rollout payloads and lineage-compatible metadata.",
          schema: releaseRolloutCloudEventSchema,
        },
      ],
    },
  ],
});

export const RELEASE_ROLLOUT_CLOUDEVENT_SURFACE = defineCloudEventSurface({
  id: "https://recallnet.dev/contracts/cloudevents/release-rollout.v1.json",
  version: "release_rollout_cloudevents/v1",
  title: "Release Rollout CloudEvents",
  description: "Canonical CloudEvents contract for release rollout controller event feeds.",
  sourcePath: "packages/factory-ops/src/lib/release-rollout-asyncapi-contract.ts",
  outputPath: "docs/contracts/release-rollout-events.asyncapi.v1.json",
  producers: ["packages/factory-ops/src/lib/command-owners/release-rollout-controller.ts"],
  consumers: ["packages/factory-ops/src/commands/release-rollout-controller-state.ts"],
  governedPaths: [
    "packages/factory-ops/src/lib/command-owners/release-rollout-controller.ts",
    "packages/factory-ops/src/commands/release-rollout-controller-state.ts",
  ],
  payloadSchemaVersion: RELEASE_ROLLOUT_EVENT_SCHEMA_VERSION,
  payloadSchemaId: RELEASE_ROLLOUT_EVENT_SCHEMA_ID,
});

export function normalizeReleaseRolloutEvent(event = {}) {
  return {
    schema_version: String(event?.schema_version || RELEASE_ROLLOUT_EVENT_SCHEMA_VERSION),
    action: String(event?.action || ""),
    channel: String(event?.channel || ""),
    status: String(event?.status || ""),
    reason: String(event?.reason || ""),
    release_id: String(event?.release_id || ""),
    release_tag: String(event?.release_tag || ""),
    release_sha: String(event?.release_sha || ""),
    previous_release_id: String(event?.previous_release_id || ""),
    run_id: String(event?.run_id || ""),
    holder_id: String(event?.holder_id || ""),
    tracking_issue_number: String(event?.tracking_issue_number || ""),
    asset_id: String(event?.asset_id || ""),
    asset_url: String(event?.asset_url || ""),
    manifest_path: String(event?.manifest_path || ""),
    at: String(event?.at || ""),
  };
}

export function validateReleaseRolloutEvent(event) {
  const parsed = releaseRolloutEventSchema.safeParse(normalizeReleaseRolloutEvent(event));
  if (parsed.success) {
    return { ok: true, value: parsed.data, errors: [] };
  }
  return {
    ok: false,
    value: null,
    errors: createIssueList(parsed.error),
  };
}

export function buildReleaseRolloutCloudEvent({
  id = "",
  subject = "",
  time = "",
  traceparent = "",
  tracestate = "",
  openlineage = undefined,
  data,
} = {}) {
  const validated = validateReleaseRolloutEvent(data);
  if (!validated.ok || !validated.value) {
    throw new Error(`invalid_release_rollout_event:${validated.errors.map((entry) => `${entry.path}:${entry.message}`).join(",")}`);
  }
  return buildCloudEvent({
    schema: releaseRolloutCloudEventSchema,
    id,
    subject,
    time: time || validated.value.at,
    traceparent,
    tracestate,
    openlineage: normalizeOpenLineageProjection(openlineage) || buildReleaseRolloutLineageProjection(validated.value),
    data: validated.value,
  });
}

export function validateReleaseRolloutCloudEvent(event) {
  return validateCloudEvent(releaseRolloutCloudEventSchema, event);
}
