import type { ZodTypeAny } from "zod";

export type OpenLineageDataset = {
  namespace: string;
  name: string;
};

export type OpenLineageProjection = {
  eventType: "START" | "COMPLETE" | "FAIL" | "RUN" | "INPUT" | "OUTPUT";
  job?: OpenLineageDataset;
  run?: { runId: string };
  inputs?: OpenLineageDataset[];
  outputs?: OpenLineageDataset[];
};

export type CloudEventSurface = {
  id: string;
  version: string;
  title: string;
  description: string;
  sourcePath: string;
  outputPath: string;
  producers: readonly string[];
  consumers: readonly string[];
  governedPaths: readonly string[];
  payloadSchemaVersion: string;
  payloadSchemaId: string;
  asyncapiSurfaceSourcePath: string;
};

export declare const openLineageProjectionSchema: ZodTypeAny;
export declare function createCloudEventSchema(args: {
  type: string;
  source: string;
  subject?: string | undefined;
  dataSchemaId: string;
  dataSchema: ZodTypeAny;
}): ZodTypeAny;
export declare function defineCloudEventSurface(definition?: Partial<CloudEventSurface>): CloudEventSurface;
export declare function buildCloudEvent(args: {
  schema: ZodTypeAny;
  id?: string;
  time?: string;
  subject?: string;
  traceparent?: string;
  tracestate?: string;
  openlineage?: OpenLineageProjection | undefined;
  data: unknown;
}): unknown;
export declare function validateCloudEvent(schema: ZodTypeAny, value: unknown): {
  ok: boolean;
  value: unknown;
  errors: { path: string; message: string }[];
};
