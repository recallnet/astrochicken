export type HatchRunLifecycleEvent = {
  schemaVersion: 1;
  ts: string;
  event: "run-start" | "complete" | "fail" | "node-change" | "merge" | "artifact";
  runId: string;
  graph: string;
  node: string;
  prevNode?: string;
  issue?: string;
  milestone?: string;
  artifactUrl?: string;
  mergeStatus?: string;
};

export type HatchRunLifecycleCloudEvent = {
  specversion: "1.0";
  id: string;
  type: "dev.recallnet.hatch.run.lifecycle";
  source: "/hatch/run-lifecycle";
  time: string;
  datacontenttype: "application/json";
  dataschema: "https://recallnet.dev/contracts/hatch-run-lifecycle-event.v1.schema.json";
  subject?: string;
  traceparent?: string;
  tracestate?: string;
  openlineage?: unknown;
  data: HatchRunLifecycleEvent;
};

export declare const HATCH_RUN_LIFECYCLE_EVENT_SCHEMA_VERSION: string;
export declare const HATCH_RUN_LIFECYCLE_EVENT_SCHEMA_ID: string;
export declare const HATCH_RUN_LIFECYCLE_EVENT_TYPE: string;
export declare const HATCH_RUN_LIFECYCLE_EVENT_SOURCE: string;
export declare const HATCH_RUN_LIFECYCLE_EVENT_BOUNDARY_SCHEMA: unknown;
export declare const HATCH_RUN_LIFECYCLE_ASYNCAPI_SURFACE: unknown;
export declare const HATCH_RUN_LIFECYCLE_CLOUDEVENT_SURFACE: unknown;
export declare function normalizeHatchRunLifecycleEvent(event?: Partial<HatchRunLifecycleEvent>): HatchRunLifecycleEvent;
export declare function validateHatchRunLifecycleEvent(event: unknown): { ok: boolean; value: HatchRunLifecycleEvent | null; errors: { path: string; message: string }[] };
export declare function buildHatchRunLifecycleCloudEvent(args: {
  id?: string;
  subject?: string;
  time?: string;
  traceparent?: string;
  tracestate?: string;
  openlineage?: unknown;
  data: Partial<HatchRunLifecycleEvent>;
}): HatchRunLifecycleCloudEvent;
export declare function validateHatchRunLifecycleCloudEvent(event: unknown): { ok: boolean; value: HatchRunLifecycleCloudEvent | null; errors: { path: string; message: string }[] };
