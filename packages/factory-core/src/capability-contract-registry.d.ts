export interface CapabilityEntrypoint {
  id: string;
  title: string;
  description?: string;
  transport: "sync" | "async";
  kind: "graph" | "module";
  path: string;
}

export interface CapabilityOwnedStage {
  stage: string;
  entrypoint: string;
  scope: string;
}

export interface CapabilityOutputSurface {
  id: string;
  title: string;
  description?: string;
  standard: string;
  ref: string;
  producerPaths?: string[];
}

export interface CapabilitySourceFileOutputCoverage {
  path: string;
  refs?: string[];
}

export interface CapabilitySurfaceDefinition {
  packageName: string;
  capabilityId: string;
  version: string;
  title: string;
  description?: string;
  sourcePath: string;
  outputPath: string;
  reusableAcrossFactories?: boolean;
  privateGlueRequired?: boolean;
  entrypoints: CapabilityEntrypoint[];
  outputSurfaces?: {
    events?: CapabilityOutputSurface[];
    artifacts?: CapabilityOutputSurface[];
    telemetry?: CapabilityOutputSurface[];
  };
  sourceFileOutputCoverage?: CapabilitySourceFileOutputCoverage[];
  skillPaths?: string[];
  requiredContextKeys?: string[];
  requiredRoles?: string[];
  requiredHandlers?: string[];
  ownedStages?: CapabilityOwnedStage[];
  exportedContextKeys?: Record<string, string[]>;
  roleSessionAssumptions?: Record<string, unknown>;
  nonGoals?: string[];
}

export interface CapabilitySurface extends CapabilitySurfaceDefinition {}

export interface CapabilityManifestPackageMetadata {
  description?: string;
  exports?: Record<string, unknown>;
  files?: string[];
}

export interface CapabilityManifestDefinition {
  packageRoot: string;
  manifestPath: string;
  contractPath: string;
  packageJsonPath: string;
  packageMetadata?: CapabilityManifestPackageMetadata;
  graphPaths?: string[];
  promptPaths?: string[];
  skillPaths?: string[];
  supportFilePaths?: string[];
  producerPaths?: string[];
}

export function defineCapabilitySurface(definition: CapabilitySurfaceDefinition): CapabilitySurface;
export function exportCapabilityContractDocument(surface: CapabilitySurface): Record<string, unknown>;
export function stringifyCapabilityContractDocument(surface: CapabilitySurface): string;
export function exportCapabilityManifestDocument(
  surface: CapabilitySurface,
  definition: CapabilityManifestDefinition,
): Record<string, unknown>;
export function stringifyCapabilityManifestDocument(
  surface: CapabilitySurface,
  definition: CapabilityManifestDefinition,
): string;
