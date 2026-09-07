import { openLineageProjectionSchema } from "./cloudevents-registry.ts";
import { z } from "./schema-registry.ts";

const runClassSchema = z.strictObject({
  key: z.string().min(1),
  cloudEventSurfaceId: z.string().min(1),
  sourcePath: z.string().min(1),
  producerPaths: z.array(z.string().min(1)),
});

const artifactClassSchema = z.strictObject({
  key: z.string().min(1),
  sourcePath: z.string().min(1),
  publisherPaths: z.array(z.string().min(1)),
});

const openLineageRegistrySchema = z.strictObject({
  schema_version: z.literal("openlineage_registry/v1"),
  governance_mode: z.literal("downstream_only"),
  downstream_consumers_attach_without_execution_plane_changes: z.literal(true),
  summary: z.strictObject({
    supported_run_classes: z.number().int().nonnegative(),
    supported_artifact_classes: z.number().int().nonnegative(),
    diagnostics: z.number().int().nonnegative(),
  }),
  run_classes: z.array(runClassSchema),
  artifact_classes: z.array(artifactClassSchema),
  diagnostics: z.array(z.string()),
});

function stableOrder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => stableOrder(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort((left, right) => left.localeCompare(right))
        .map((key) => [key, stableOrder((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(stableOrder(value), null, 2)}\n`;
}

function trim(value: string = ""): string {
  return String(value ?? "").trim();
}

function sortStrings(values: string[] = []): string[] {
  return [...new Set((values || []).map((value) => trim(value)).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function normalizeDataset(namespace: string = "", name: string = ""): { namespace: string; name: string } | undefined {
  const normalizedNamespace = trim(namespace);
  const normalizedName = trim(name);
  if (!normalizedNamespace || !normalizedName) return undefined;
  return { namespace: normalizedNamespace, name: normalizedName };
}

function normalizeRunId(runId: string = ""): { runId: string } | undefined {
  const normalizedRunId = trim(runId);
  return normalizedRunId ? { runId: normalizedRunId } : undefined;
}

function sortRunClasses(entries: Record<string, unknown>[] = []): Record<string, unknown>[] {
  return [...entries].sort((left, right) => (left.key as string).localeCompare(right.key as string));
}

function sortArtifactClasses(entries: Record<string, unknown>[] = []): Record<string, unknown>[] {
  return [...entries].sort((left, right) => (left.key as string).localeCompare(right.key as string));
}

function supportedArtifactClasses(entries: Record<string, unknown>[] = []): Record<string, unknown>[] {
  return entries.filter((entry) => Array.isArray(entry.publisherPaths) && (entry.publisherPaths as unknown[]).length > 0);
}

export function normalizeOpenLineageProjection(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const parsed = openLineageProjectionSchema.safeParse(value);
  return parsed.success ? parsed.data as Record<string, unknown> : undefined;
}

export function buildHatchRunLifecycleLineageProjection(event: Record<string, unknown> = {}): Record<string, unknown> | undefined {
  const job = normalizeDataset("hatch.graph", event.graph as string);
  const run = normalizeRunId(event.runId as string);
  if (!job || !run) return undefined;

  if (event.event === "run-start") {
    return normalizeOpenLineageProjection({
      eventType: "START",
      job,
      run,
      inputs: [],
    });
  }
  if (event.event === "complete" || event.event === "merge") {
    return normalizeOpenLineageProjection({
      eventType: "COMPLETE",
      job,
      run,
      outputs: [],
    });
  }
  if (event.event === "fail") {
    return normalizeOpenLineageProjection({
      eventType: "FAIL",
      job,
      run,
      outputs: [],
    });
  }
  if (event.event === "artifact") {
    const output = normalizeDataset("artifact", event.artifactUrl as string);
    if (!output) return undefined;
    return normalizeOpenLineageProjection({
      eventType: "OUTPUT",
      job,
      run,
      outputs: [output],
    });
  }
  return undefined;
}

export function buildReleaseRolloutLineageProjection(event: Record<string, unknown> = {}): Record<string, unknown> | undefined {
  const job = normalizeDataset("factory.release.rollout", (event.channel as string) || "release-rollout");
  const run = normalizeRunId((event.run_id as string) || `release-rollout:${trim(event.release_id as string)}:${trim(event.action as string)}:${trim(event.channel as string)}`);
  if (!job || !run) return undefined;

  const output = normalizeDataset("release.asset", event.asset_url as string);
  let eventType = "RUN";
  if (trim(event.status as string).toLowerCase().includes("fail")) {
    eventType = "FAIL";
  } else if (["promoted", "published", "rolled_back", "reconciled"].includes(trim(event.status as string))) {
    eventType = "COMPLETE";
  }

  return normalizeOpenLineageProjection({
    eventType,
    job,
    run,
    ...(output ? { outputs: [output] } : {}),
  });
}

export function buildOciArtifactLineageDataset({ artifactClassKey = "", artifactRef = "" }: { artifactClassKey?: string; artifactRef?: string } = {}): { namespace: string; name: string } | undefined {
  const dataset = normalizeDataset(`oci.artifact.${trim(artifactClassKey)}`, artifactRef);
  return dataset || undefined;
}

export function defineOpenLineageRunClass(definition: Record<string, unknown> = {}): Record<string, unknown> {
  return runClassSchema.parse({
    key: trim(definition.key as string),
    cloudEventSurfaceId: trim(definition.cloudEventSurfaceId as string),
    sourcePath: trim(definition.sourcePath as string),
    producerPaths: sortStrings(definition.producerPaths as string[] || []),
  });
}

export function defineOpenLineageArtifactClass(definition: Record<string, unknown> = {}): Record<string, unknown> {
  return artifactClassSchema.parse({
    key: trim(definition.key as string),
    sourcePath: trim(definition.sourcePath as string),
    publisherPaths: sortStrings(definition.publisherPaths as string[] || []),
  });
}

export function exportOpenLineageRegistryDocument({
  runClasses = [],
  artifactClasses = [],
  diagnostics = [],
}: {
  runClasses?: Record<string, unknown>[];
  artifactClasses?: Record<string, unknown>[];
  diagnostics?: string[];
} = {}): Record<string, unknown> {
  const normalizedRunClasses = sortRunClasses(runClasses.map((entry) => defineOpenLineageRunClass(entry)));
  const normalizedArtifactClasses = sortArtifactClasses(
    supportedArtifactClasses(artifactClasses.map((entry) => defineOpenLineageArtifactClass(entry))),
  );
  const normalizedDiagnostics = sortStrings(diagnostics || []);
  return openLineageRegistrySchema.parse({
    schema_version: "openlineage_registry/v1",
    governance_mode: "downstream_only",
    downstream_consumers_attach_without_execution_plane_changes: true,
    summary: {
      supported_run_classes: normalizedRunClasses.length,
      supported_artifact_classes: normalizedArtifactClasses.length,
      diagnostics: normalizedDiagnostics.length,
    },
    run_classes: normalizedRunClasses,
    artifact_classes: normalizedArtifactClasses,
    diagnostics: normalizedDiagnostics,
  }) as Record<string, unknown>;
}

export function stringifyOpenLineageRegistryDocument(document: unknown): string {
  const registry = (document as Record<string, unknown>)?.schema_version === "openlineage_registry/v1"
    ? openLineageRegistrySchema.parse(document)
    : exportOpenLineageRegistryDocument(document as Record<string, unknown>);
  return stableJson(registry);
}

export function renderOpenLineageRegistryMarkdown(document: unknown): string {
  const registry = (document as Record<string, unknown>)?.schema_version === "openlineage_registry/v1"
    ? openLineageRegistrySchema.parse(document) as Record<string, unknown>
    : exportOpenLineageRegistryDocument(document as Record<string, unknown>);
  const summary = registry.summary as Record<string, number>;
  const runClassList = registry.run_classes as Record<string, unknown>[];
  const artifactClassList = registry.artifact_classes as Record<string, unknown>[];
  const diagnosticList = registry.diagnostics as string[];
  return [
    "---",
    'doc_type: "reference"',
    'owner: "platform-architecture"',
    'review_policy: "periodic-7"',
    'reviewed: "2026-03-21"',
    'status: "active"',
    'summary: "Governed OpenLineage-compatible run and artifact projection registry for downstream lineage and governance consumers."',
    'tags: [contracts, governance, lineage, openlineage, registry]',
    'written: "2026-03-21"',
    "---",
    "",
    "# OpenLineage Registry",
    "",
    `- Governance mode: \`${registry.governance_mode}\``,
    `- Supported run classes: ${summary.supported_run_classes}`,
    `- Supported artifact classes: ${summary.supported_artifact_classes}`,
    `- Diagnostics: ${summary.diagnostics}`,
    "",
    "## Run Classes",
    "",
    ...runClassList.flatMap((entry) => [
      `- \`${entry.key}\``,
      `  - cloud event surface: \`${entry.cloudEventSurfaceId}\``,
      `  - source: \`${entry.sourcePath}\``,
      `  - producers: \`${(entry.producerPaths as string[]).length}\``,
    ]),
    "",
    "## Artifact Classes",
    "",
    ...artifactClassList.flatMap((entry) => [
      `- \`${entry.key}\``,
      `  - source: \`${entry.sourcePath}\``,
      `  - publishers: \`${(entry.publisherPaths as string[]).length}\``,
    ]),
    "",
    "## Diagnostics",
    "",
    ...(diagnosticList.length > 0 ? diagnosticList.map((entry) => `- \`${entry}\``) : ["- none"]),
    "",
  ].join("\n");
}
