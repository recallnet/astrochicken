import { z } from "./schema-registry.ts";

const compositionModelSchema = z.enum(["control_plane", "thin_composition"]);
const graphOwnerSchema = z.enum(["factory", "shared"]);
const graphRoleSchema = z.enum(["dispatch", "supervisor", "schedule", "capability_binding", "domain_policy"]);

const graphBindingSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  owner: graphOwnerSchema,
  role: graphRoleSchema,
  capabilityPackage: z.string().min(1).nullable().optional(),
});

const bootstrapSurfaceSchema = z.object({
  readmePath: z.string().min(1).nullable(),
  intentPath: z.string().min(1).nullable(),
  createEvolveDocPath: z.string().min(1).nullable(),
  conformanceReadmePath: z.string().min(1).nullable(),
  initCommand: z.string().min(1),
});

const policySurfaceSchema = z.object({
  configPath: z.string().min(1),
  policyPackDir: z.string().min(1).nullable(),
  policyPackVersion: z.string().min(1).nullable(),
  overrideKeys: z.array(z.string().min(1)),
  policyFiles: z.array(z.string().min(1)),
});

const artifactDefaultsSchema = z.object({
  runsDir: z.string().min(1),
  trustDomain: z.string().min(1),
  trustRoles: z.array(z.string().min(1)),
  canonicalCheckoutPath: z.string().min(1).nullable(),
  scheduledGraphs: z.array(z.string().min(1)),
});

const telemetryDefaultsSchema = z.object({
  dispatchLatencySloSeconds: z.number().int().positive().nullable(),
  maintenanceIntervalSeconds: z.number().int().positive().nullable(),
  conformanceEntrypoint: z.string().min(1).nullable(),
  conformanceRunsDir: z.string().min(1).nullable(),
  benchmarkTelemetryWarnOnly: z.boolean(),
  benchmarkTelemetryExemptions: z.array(z.string().min(1)),
});

const factoryCompositionManifestSchema = z.object({
  schemaVersion: z.literal("factory_composition_manifest/v1"),
  factoryId: z.string().min(1),
  compositionModel: compositionModelSchema,
  manifestPath: z.string().min(1),
  configPath: z.string().min(1),
  registryPath: z.string().min(1),
  dispatchGraphPath: z.string().min(1),
  supervisorGraphPath: z.string().min(1),
  graphBindings: z.array(graphBindingSchema),
  bootstrap: bootstrapSurfaceSchema,
  policy: policySurfaceSchema,
  artifactDefaults: artifactDefaultsSchema,
  telemetryDefaults: telemetryDefaultsSchema,
  privateExecutionGluePaths: z.array(z.string().min(1)),
});

function stableOrder(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => stableOrder(entry));
  }
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

function sortStrings(values: string[] = []): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function sortGraphBindings(bindings: Record<string, unknown>[] = []): Record<string, unknown>[] {
  return [...bindings].sort((left, right) => {
    const leftKey = `${left.role}:${left.id}:${left.path}`;
    const rightKey = `${right.role}:${right.id}:${right.path}`;
    return leftKey.localeCompare(rightKey);
  });
}

export function defineFactoryCompositionManifest(definition: Record<string, unknown>): Record<string, unknown> {
  const normalized = {
    ...definition,
    graphBindings: sortGraphBindings(definition.graphBindings as Record<string, unknown>[] || []),
    policy: {
      ...(definition.policy as Record<string, unknown>),
      overrideKeys: sortStrings((definition.policy as Record<string, unknown>)?.overrideKeys as string[] || []),
      policyFiles: sortStrings((definition.policy as Record<string, unknown>)?.policyFiles as string[] || []),
    },
    artifactDefaults: {
      ...(definition.artifactDefaults as Record<string, unknown>),
      trustRoles: sortStrings((definition.artifactDefaults as Record<string, unknown>)?.trustRoles as string[] || []),
      scheduledGraphs: sortStrings((definition.artifactDefaults as Record<string, unknown>)?.scheduledGraphs as string[] || []),
    },
    telemetryDefaults: {
      ...(definition.telemetryDefaults as Record<string, unknown>),
      benchmarkTelemetryExemptions: sortStrings((definition.telemetryDefaults as Record<string, unknown>)?.benchmarkTelemetryExemptions as string[] || []),
    },
    privateExecutionGluePaths: sortStrings(definition.privateExecutionGluePaths as string[] || []),
  };
  return factoryCompositionManifestSchema.parse(normalized) as Record<string, unknown>;
}

export function exportFactoryCompositionManifestDocument(manifest: Record<string, unknown>): Record<string, unknown> {
  return defineFactoryCompositionManifest(manifest);
}

export function stringifyFactoryCompositionManifestDocument(manifest: Record<string, unknown>): string {
  return stableJson(exportFactoryCompositionManifestDocument(manifest));
}

export function renderFactoryCompositionRegistryMarkdown(entries: Record<string, unknown>[], diagnostics: string[]): string {
  return [
    "---",
    'doc_type: "reference"',
    'owner: "platform-architecture"',
    'review_policy: "periodic-7"',
    'reviewed: "2026-03-21"',
    'status: "active"',
    'summary: "Generated registry for governed factory composition manifests."',
    'tags: [composition, contracts, factory, generated, registry]',
    'written: "2026-03-21"',
    "---",
    "",
    "# Factory Composition Registry",
    "",
    `- Registered factories: ${entries.length}`,
    `- Diagnostics: ${diagnostics.length}`,
    "",
    "## Factory Manifests",
    "",
    ...entries.flatMap((entry) => [
      `- \`${entry.factory_id}\``,
      `  - composition model: \`${entry.composition_model}\``,
      `  - manifest: \`${entry.manifest_path}\``,
      `  - shared graph bindings: \`${entry.shared_graph_bindings}\``,
      `  - local graph bindings: \`${entry.local_graph_bindings}\``,
      `  - private execution glue paths: \`${entry.private_execution_glue_paths}\``,
    ]),
    "",
    "## Diagnostics",
    "",
    ...(diagnostics.length > 0 ? diagnostics.map((entry) => `- \`${entry}\``) : ["- none"]),
    "",
  ].join("\n");
}

export const FACTORY_COMPOSITION_MANIFEST_SCHEMA = factoryCompositionManifestSchema;
