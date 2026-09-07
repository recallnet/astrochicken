import { createIssueList, sortJson, stringifySchemaDocument, z } from "./schema-registry.ts";

const openLineageDatasetSchema = z.strictObject({
  namespace: z.string(),
  name: z.string(),
});

const openLineageRunSchema = z.strictObject({
  runId: z.string(),
});

export const openLineageProjectionSchema = z.strictObject({
  eventType: z.enum(["START", "COMPLETE", "FAIL", "RUN", "INPUT", "OUTPUT"]),
  job: openLineageDatasetSchema.optional(),
  run: openLineageRunSchema.optional(),
  inputs: z.array(openLineageDatasetSchema).optional(),
  outputs: z.array(openLineageDatasetSchema).optional(),
});

function normalizeString(value: string = ""): string {
  return String(value || "").trim();
}

function normalizeJsonObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function createCloudEventSchema({
  type,
  source,
  subject = undefined,
  dataSchemaId,
  dataSchema,
}: {
  type: string;
  source: string;
  subject?: string;
  dataSchemaId: string;
  dataSchema: unknown;
} = {} as { type: string; source: string; dataSchemaId: string; dataSchema: unknown }): ReturnType<typeof z.strictObject> {
  let schema = z.strictObject({
    specversion: z.literal("1.0"),
    id: z.string(),
    type: z.literal(normalizeString(type)),
    source: z.literal(normalizeString(source)),
    time: z.string(),
    datacontenttype: z.literal("application/json"),
    dataschema: z.literal(normalizeString(dataSchemaId)),
    data: dataSchema as import("zod").ZodType,
    traceparent: z.string().optional(),
    tracestate: z.string().optional(),
    openlineage: openLineageProjectionSchema.optional(),
  });
  if (typeof subject === "string" && subject.trim()) {
    schema = schema.extend({
      subject: z.literal(subject.trim()),
    });
  } else {
    schema = schema.extend({
      subject: z.string().optional(),
    });
  }
  return schema;
}

export function defineCloudEventSurface(definition: Record<string, unknown> = {}): Readonly<Record<string, unknown>> {
  return Object.freeze({
    id: normalizeString(definition.id as string),
    version: normalizeString(definition.version as string),
    title: normalizeString(definition.title as string),
    description: normalizeString(definition.description as string),
    sourcePath: normalizeString(definition.sourcePath as string),
    outputPath: normalizeString(definition.outputPath as string),
    producers: Object.freeze(((definition.producers as string[]) || []).map((entry: string) => normalizeString(entry)).filter(Boolean)),
    consumers: Object.freeze(((definition.consumers as string[]) || []).map((entry: string) => normalizeString(entry)).filter(Boolean)),
    governedPaths: Object.freeze(((definition.governedPaths as string[]) || []).map((entry: string) => normalizeString(entry)).filter(Boolean)),
    payloadSchemaVersion: normalizeString(definition.payloadSchemaVersion as string),
    payloadSchemaId: normalizeString(definition.payloadSchemaId as string),
    asyncapiSurfaceSourcePath: normalizeString((definition.asyncapiSurfaceSourcePath || definition.sourcePath) as string),
  });
}

export function buildCloudEvent({
  schema,
  id = "",
  time = "",
  subject = "",
  traceparent = "",
  tracestate = "",
  openlineage = undefined,
  data,
}: {
  schema: Record<string, unknown>;
  id?: string;
  time?: string;
  subject?: string;
  traceparent?: string;
  tracestate?: string;
  openlineage?: unknown;
  data: unknown;
} = {} as { schema: Record<string, unknown>; data: unknown }): Record<string, unknown> {
  const payload = {
    specversion: "1.0",
    id: normalizeString(id),
    type: ((schema as unknown as { shape: Record<string, { value: string }> }).shape.type).value,
    source: ((schema as unknown as { shape: Record<string, { value: string }> }).shape.source).value,
    time: normalizeString(time || new Date().toISOString()),
    datacontenttype: "application/json",
    dataschema: ((schema as unknown as { shape: Record<string, { value: string }> }).shape.dataschema).value,
    subject: normalizeString(subject) || undefined,
    traceparent: normalizeString(traceparent) || undefined,
    tracestate: normalizeString(tracestate) || undefined,
    openlineage: normalizeJsonObject(openlineage),
    data,
  };
  const parsed = (schema as unknown as { parse: (v: unknown) => unknown }).parse(payload);
  return sortJson(parsed) as Record<string, unknown>;
}

export function validateCloudEvent(schema: unknown, value: unknown): { ok: boolean; value: Record<string, unknown> | null; errors: Array<{ path: string; message: string }> } {
  const parsed = (schema as { safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: import("zod").ZodError } }).safeParse(value);
  if (parsed.success) {
    return { ok: true, value: sortJson(parsed.data) as Record<string, unknown>, errors: [] };
  }
  return {
    ok: false,
    value: null,
    errors: createIssueList(parsed.error as unknown as import("zod/v4/core").$ZodError),
  };
}

export function stringifyCloudEventRegistry(document: unknown): string {
  return stringifySchemaDocument(document);
}

export { z };
