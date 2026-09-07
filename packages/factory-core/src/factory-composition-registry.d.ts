export type FactoryCompositionModel = "control_plane" | "thin_composition";
export type FactoryCompositionGraphOwner = "factory" | "shared";
export type FactoryCompositionGraphRole = "dispatch" | "supervisor" | "schedule" | "capability_binding" | "domain_policy";

export interface FactoryCompositionGraphBinding {
  id: string;
  path: string;
  owner: FactoryCompositionGraphOwner;
  role: FactoryCompositionGraphRole;
  capabilityPackage?: string | null;
}

export interface FactoryCompositionBootstrapSurface {
  readmePath: string | null;
  intentPath: string | null;
  createEvolveDocPath: string | null;
  conformanceReadmePath: string | null;
  initCommand: string;
}

export interface FactoryCompositionPolicySurface {
  configPath: string;
  policyPackDir: string | null;
  policyPackVersion: string | null;
  overrideKeys: string[];
  policyFiles: string[];
}

export interface FactoryCompositionArtifactDefaults {
  runsDir: string;
  trustDomain: string;
  trustRoles: string[];
  canonicalCheckoutPath: string | null;
  scheduledGraphs: string[];
}

export interface FactoryCompositionTelemetryDefaults {
  dispatchLatencySloSeconds: number | null;
  maintenanceIntervalSeconds: number | null;
  conformanceEntrypoint: string | null;
  conformanceRunsDir: string | null;
  benchmarkTelemetryWarnOnly: boolean;
  benchmarkTelemetryExemptions: string[];
}

export interface FactoryCompositionManifestDocument {
  schemaVersion: "factory_composition_manifest/v1";
  factoryId: string;
  compositionModel: FactoryCompositionModel;
  manifestPath: string;
  configPath: string;
  registryPath: string;
  dispatchGraphPath: string;
  supervisorGraphPath: string;
  graphBindings: FactoryCompositionGraphBinding[];
  bootstrap: FactoryCompositionBootstrapSurface;
  policy: FactoryCompositionPolicySurface;
  artifactDefaults: FactoryCompositionArtifactDefaults;
  telemetryDefaults: FactoryCompositionTelemetryDefaults;
  privateExecutionGluePaths: string[];
}

export declare function defineFactoryCompositionManifest(definition: FactoryCompositionManifestDocument): FactoryCompositionManifestDocument;
export declare function exportFactoryCompositionManifestDocument(manifest: FactoryCompositionManifestDocument): FactoryCompositionManifestDocument;
export declare function stringifyFactoryCompositionManifestDocument(manifest: FactoryCompositionManifestDocument): string;
export declare function renderFactoryCompositionRegistryMarkdown(
  entries: Array<Record<string, unknown>>,
  diagnostics: string[],
): string;
