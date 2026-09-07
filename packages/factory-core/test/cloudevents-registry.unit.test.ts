import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCloudEvent,
  createCloudEventSchema,
  defineCloudEventSurface,
  openLineageProjectionSchema,
  validateCloudEvent,
  z,
} from "../src/cloudevents-registry.ts";

test("buildCloudEvent emits sorted CloudEvents with trace context and openlineage", () => {
  const schema = createCloudEventSchema({
    type: "dev.recallnet.sample.event",
    source: "/sample/source",
    dataSchemaId: "https://recallnet.dev/contracts/sample-event.v1.schema.json",
    dataSchema: z.strictObject({
      schema_version: z.literal("sample_event/v1"),
      status: z.string(),
    }),
  });

  const event = buildCloudEvent({
    schema,
    id: "sample-1",
    subject: "sample",
    time: "2026-03-21T12:00:00.000Z",
    traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    tracestate: "rojo=00f067aa0ba902b7",
    openlineage: {
      eventType: "OUTPUT",
      job: { namespace: "sample", name: "job" },
      run: { runId: "run-1" },
      outputs: [{ namespace: "artifact", name: "artifact://sample" }],
    },
    data: {
      schema_version: "sample_event/v1",
      status: "ready",
    },
  });

  assert.equal(event.specversion, "1.0");
  assert.equal(event.type, "dev.recallnet.sample.event");
  assert.equal(event.source, "/sample/source");
  assert.equal(event.dataschema, "https://recallnet.dev/contracts/sample-event.v1.schema.json");
  assert.equal(event.traceparent, "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01");
  assert.equal(event.openlineage.eventType, "OUTPUT");
  assert.equal(event.data.status, "ready");

  const validated = validateCloudEvent(schema, event);
  assert.equal(validated.ok, true);
  assert.deepEqual(validated.value, event);
});

test("defineCloudEventSurface normalizes registry metadata", () => {
  const surface = defineCloudEventSurface({
    id: " https://recallnet.dev/contracts/cloudevents/sample.v1.json ",
    version: " sample_cloudevents/v1 ",
    title: " Sample Events ",
    sourcePath: "packages/sample/src/sample-cloudevents.mjs",
    outputPath: "docs/contracts/sample.asyncapi.v1.json",
    producers: ["packages/sample/src/producer.mjs", ""],
    consumers: ["packages/sample/src/consumer.mjs"],
    governedPaths: ["packages/sample/src/producer.mjs"],
    payloadSchemaVersion: "sample_event/v1",
    payloadSchemaId: "https://recallnet.dev/contracts/sample-event.v1.schema.json",
  });

  assert.equal(surface.id, "https://recallnet.dev/contracts/cloudevents/sample.v1.json");
  assert.equal(surface.version, "sample_cloudevents/v1");
  assert.deepEqual(surface.producers, ["packages/sample/src/producer.mjs"]);
  assert.deepEqual(surface.consumers, ["packages/sample/src/consumer.mjs"]);
  assert.equal(surface.payloadSchemaVersion, "sample_event/v1");
});

test("openLineageProjectionSchema rejects invalid event types", () => {
  const parsed = openLineageProjectionSchema.safeParse({
    eventType: "BROKEN",
    job: { namespace: "sample", name: "job" },
  });

  assert.equal(parsed.success, false);
});
