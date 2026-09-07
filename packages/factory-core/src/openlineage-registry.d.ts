export type OpenLineageRunClass = {
  key: string;
  cloudEventSurfaceId: string;
  sourcePath: string;
  producerPaths: string[];
};

export type OpenLineageArtifactClass = {
  key: string;
  sourcePath: string;
  publisherPaths: string[];
};

export declare function normalizeOpenLineageProjection(value: unknown): unknown;
export declare function buildHatchRunLifecycleLineageProjection(event?: Record<string, unknown>): unknown;
export declare function buildReleaseRolloutLineageProjection(event?: Record<string, unknown>): unknown;
export declare function buildOciArtifactLineageDataset(args?: { artifactClassKey?: string; artifactRef?: string }): { namespace: string; name: string } | undefined;
export declare function defineOpenLineageRunClass(definition?: Partial<OpenLineageRunClass>): OpenLineageRunClass;
export declare function defineOpenLineageArtifactClass(definition?: Partial<OpenLineageArtifactClass>): OpenLineageArtifactClass;
export declare function exportOpenLineageRegistryDocument(args?: {
  runClasses?: OpenLineageRunClass[];
  artifactClasses?: OpenLineageArtifactClass[];
  diagnostics?: string[];
}): unknown;
export declare function stringifyOpenLineageRegistryDocument(document: unknown): string;
export declare function renderOpenLineageRegistryMarkdown(document: unknown): string;
