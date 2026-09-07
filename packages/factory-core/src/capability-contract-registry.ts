import { sortJson, stringifySchemaDocument } from "./schema-registry.ts";

function sortStrings(values: string[] = []): string[] {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function normalizeEntrypoints(entrypoints: Record<string, unknown>[] = []): Readonly<Readonly<Record<string, unknown>>[]> {
  return Object.freeze((entrypoints || []).map((entrypoint) => Object.freeze({
    id: String(entrypoint?.id || "").trim(),
    title: String(entrypoint?.title || "").trim(),
    description: String(entrypoint?.description || "").trim(),
    transport: String(entrypoint?.transport || "sync").trim().toLowerCase(),
    kind: String(entrypoint?.kind || "graph").trim().toLowerCase(),
    path: String(entrypoint?.path || "").trim(),
  })));
}

function normalizeCapabilityOutputList(entries: Record<string, unknown>[] = []): Readonly<Readonly<Record<string, unknown>>[]> {
  return Object.freeze((entries || []).map((entry) => Object.freeze({
    id: String(entry?.id || "").trim(),
    title: String(entry?.title || "").trim(),
    description: String(entry?.description || "").trim(),
    standard: String(entry?.standard || "").trim(),
    ref: String(entry?.ref || "").trim(),
    producerPaths: Object.freeze(sortStrings(entry?.producerPaths as string[] || [])),
  })));
}

function normalizeCapabilityOutputSurfaces(outputSurfaces: Record<string, unknown> = {}): Readonly<Record<string, unknown>> {
  return Object.freeze({
    events: normalizeCapabilityOutputList(outputSurfaces?.events as Record<string, unknown>[] || []),
    artifacts: normalizeCapabilityOutputList(outputSurfaces?.artifacts as Record<string, unknown>[] || []),
    telemetry: normalizeCapabilityOutputList(outputSurfaces?.telemetry as Record<string, unknown>[] || []),
  });
}

function normalizeCapabilitySourceFileOutputCoverage(entries: Record<string, unknown>[] = []): Readonly<Readonly<Record<string, unknown>>[]> {
  return Object.freeze((entries || []).map((entry) => Object.freeze({
    path: String(entry?.path || "").trim(),
    refs: Object.freeze(sortStrings(entry?.refs as string[] || [])),
  })));
}

function normalizeObjectOfStringArrays(value: Record<string, string[]> = {}): Record<string, string[]> {
  return sortJson(
    Object.fromEntries(
      Object.entries(value || {})
        .map(([key, entries]) => [String(key || "").trim(), sortStrings(entries)])
        .filter(([key]) => key),
    ),
  ) as Record<string, string[]>;
}

function normalizeOwnedStages(ownedStages: Record<string, unknown>[] = []): Readonly<Readonly<Record<string, unknown>>[]> {
  return Object.freeze((ownedStages || []).map((stage) => Object.freeze({
    stage: String(stage?.stage || "").trim(),
    entrypoint: String(stage?.entrypoint || "").trim(),
    scope: String(stage?.scope || "").trim(),
  })));
}

export function defineCapabilitySurface(definition: Record<string, unknown>): Readonly<Record<string, unknown>> {
  return Object.freeze({
    packageName: String(definition?.packageName || "").trim(),
    capabilityId: String(definition?.capabilityId || "").trim(),
    version: String(definition?.version || "").trim(),
    title: String(definition?.title || "").trim(),
    description: String(definition?.description || "").trim(),
    sourcePath: String(definition?.sourcePath || "").trim(),
    outputPath: String(definition?.outputPath || "").trim(),
    reusableAcrossFactories: definition?.reusableAcrossFactories !== false,
    privateGlueRequired: Boolean(definition?.privateGlueRequired),
    entrypoints: normalizeEntrypoints(definition?.entrypoints as Record<string, unknown>[] || []),
    outputSurfaces: normalizeCapabilityOutputSurfaces(definition?.outputSurfaces as Record<string, unknown> || {}),
    sourceFileOutputCoverage: normalizeCapabilitySourceFileOutputCoverage(definition?.sourceFileOutputCoverage as Record<string, unknown>[] || []),
    skillPaths: Object.freeze(sortStrings(definition?.skillPaths as string[] || [])),
    requiredContextKeys: Object.freeze(sortStrings(definition?.requiredContextKeys as string[] || [])),
    requiredRoles: Object.freeze(sortStrings(definition?.requiredRoles as string[] || [])),
    requiredHandlers: Object.freeze(sortStrings(definition?.requiredHandlers as string[] || [])),
    ownedStages: normalizeOwnedStages(definition?.ownedStages as Record<string, unknown>[] || []),
    exportedContextKeys: normalizeObjectOfStringArrays(definition?.exportedContextKeys as Record<string, string[]> || {}),
    roleSessionAssumptions: sortJson(definition?.roleSessionAssumptions || {}),
    nonGoals: Object.freeze(sortStrings(definition?.nonGoals as string[] || [])),
  });
}

export function exportCapabilityContractDocument(surface: Record<string, unknown>): Record<string, unknown> {
  return sortJson({
    schemaVersion: "capability_contract/v1",
    packageName: surface.packageName,
    capabilityId: surface.capabilityId,
    version: surface.version,
    title: surface.title,
    description: surface.description,
    sourcePath: surface.sourcePath,
    outputPath: surface.outputPath,
    reusableAcrossFactories: surface.reusableAcrossFactories !== false,
    privateGlueRequired: Boolean(surface.privateGlueRequired),
    entrypoints: ((surface.entrypoints as Record<string, unknown>[]) || []).map((entrypoint) => sortJson({
      id: entrypoint.id,
      title: entrypoint.title,
      description: entrypoint.description,
      transport: entrypoint.transport,
      kind: entrypoint.kind,
      path: entrypoint.path,
    })),
    outputSurfaces: sortJson({
      events: (((surface.outputSurfaces as Record<string, unknown>)?.events as Record<string, unknown>[]) || []).map((entry) => sortJson({
        id: entry.id,
        title: entry.title,
        description: entry.description,
        standard: entry.standard,
        ref: entry.ref,
        producerPaths: sortStrings(entry.producerPaths as string[] || []),
      })),
      artifacts: (((surface.outputSurfaces as Record<string, unknown>)?.artifacts as Record<string, unknown>[]) || []).map((entry) => sortJson({
        id: entry.id,
        title: entry.title,
        description: entry.description,
        standard: entry.standard,
        ref: entry.ref,
        producerPaths: sortStrings(entry.producerPaths as string[] || []),
      })),
      telemetry: (((surface.outputSurfaces as Record<string, unknown>)?.telemetry as Record<string, unknown>[]) || []).map((entry) => sortJson({
        id: entry.id,
        title: entry.title,
        description: entry.description,
        standard: entry.standard,
        ref: entry.ref,
        producerPaths: sortStrings(entry.producerPaths as string[] || []),
      })),
    }),
    sourceFileOutputCoverage: ((surface.sourceFileOutputCoverage as Record<string, unknown>[]) || []).map((entry) => sortJson({
      path: entry.path,
      refs: sortStrings(entry.refs as string[] || []),
    })),
    skillPaths: sortStrings(surface.skillPaths as string[] || []),
    requiredContextKeys: sortStrings(surface.requiredContextKeys as string[] || []),
    requiredRoles: sortStrings(surface.requiredRoles as string[] || []),
    requiredHandlers: sortStrings(surface.requiredHandlers as string[] || []),
    ownedStages: ((surface.ownedStages as Record<string, unknown>[]) || []).map((stage) => sortJson({
      stage: stage.stage,
      entrypoint: stage.entrypoint,
      scope: stage.scope,
    })),
    exportedContextKeys: normalizeObjectOfStringArrays(surface.exportedContextKeys as Record<string, string[]> || {}),
    roleSessionAssumptions: sortJson(surface.roleSessionAssumptions || {}),
    nonGoals: sortStrings(surface.nonGoals as string[] || []),
  }) as Record<string, unknown>;
}

export function stringifyCapabilityContractDocument(surface: Record<string, unknown>): string {
  return stringifySchemaDocument(exportCapabilityContractDocument(surface));
}

export function exportCapabilityManifestDocument(surface: Record<string, unknown>, definition: Record<string, unknown> = {}): Record<string, unknown> {
  const packageMetadata = definition?.packageMetadata as Record<string, unknown> || {};
  return sortJson({
    schemaVersion: "capability_manifest/v1",
    packageName: surface.packageName,
    capabilityId: surface.capabilityId,
    version: surface.version,
    title: surface.title,
    description: surface.description,
    packageRoot: String(definition?.packageRoot || "").trim(),
    manifestPath: String(definition?.manifestPath || "").trim(),
    contractPath: String(definition?.contractPath || surface.outputPath || "").trim(),
    sourcePath: surface.sourcePath,
    packageJsonPath: String(definition?.packageJsonPath || "").trim(),
    packageDescription: String(packageMetadata?.description || surface.description || "").trim(),
    exports: sortJson(packageMetadata?.exports || {}),
    publishedFiles: sortStrings(packageMetadata?.files as string[] || []),
    entrypoints: exportCapabilityContractDocument(surface).entrypoints,
    outputSurfaces: exportCapabilityContractDocument(surface).outputSurfaces,
    sourceFileOutputCoverage: exportCapabilityContractDocument(surface).sourceFileOutputCoverage,
    skillPaths: sortStrings(surface.skillPaths as string[] || []),
    requiredContextKeys: sortStrings(surface.requiredContextKeys as string[] || []),
    requiredRoles: sortStrings(surface.requiredRoles as string[] || []),
    requiredHandlers: sortStrings(surface.requiredHandlers as string[] || []),
    ownedStages: exportCapabilityContractDocument(surface).ownedStages,
    exportedContextKeys: normalizeObjectOfStringArrays(surface.exportedContextKeys as Record<string, string[]> || {}),
    roleSessionAssumptions: sortJson(surface.roleSessionAssumptions || {}),
    nonGoals: sortStrings(surface.nonGoals as string[] || []),
    discoveredSurfaces: sortJson({
      graphs: sortStrings(definition?.graphPaths as string[] || []),
      prompts: sortStrings(definition?.promptPaths as string[] || []),
      skills: sortStrings(definition?.skillPaths as string[] || surface.skillPaths as string[] || []),
      supportFiles: sortStrings(definition?.supportFilePaths as string[] || []),
      producerPaths: sortStrings(definition?.producerPaths as string[] || []),
    }),
  }) as Record<string, unknown>;
}

export function stringifyCapabilityManifestDocument(surface: Record<string, unknown>, definition: Record<string, unknown> = {}): string {
  return stringifySchemaDocument(exportCapabilityManifestDocument(surface, definition));
}
